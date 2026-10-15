import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createClient} from "@libsql/client";
import {SCHEMA} from "../lib/schema.mjs";
import {createApi} from "../lib/api.mjs";
import {digest} from "../lib/security.mjs";

const origin="https://field.test";
async function setup(t){
  const dir=await mkdtemp(join(tmpdir(),"field-recipe-durable-")),db=createClient({url:"file:"+join(dir,"test.db")});
  t.after(async()=>{db.close();try{await rm(dir,{recursive:true,force:true})}catch(error){if(process.platform!=="win32"||error.code!=="EBUSY")throw error}});
  await db.batch(SCHEMA,"write");
  for(const id of ["owner","owner2"])await db.execute({sql:"INSERT INTO field_users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,0,0)",args:[id,id,"unused","admin"]});
  const doc={
    ingredients:{
      matcha:{name:"Matcha",unit:"g",qty:1000,unitCost:1,costStatus:"CONFIRMED",costKind:"powder",wasteMargin:0,archived:false},
      water:{name:"Water",unit:"g",qty:5000,unitCost:0.01,costStatus:"CONFIRMED",costKind:"water",wasteMargin:0,archived:false}
    },
    menu:[
      {id:"menu-1",name:"Test Latte",category:"OTHER",price:90,enabled:false,archived:false,variants:[{label:"Standard",recipe:{items:{matcha:4,water:170}}}]},
      {id:"pure-matcha",name:"Pure Matcha",category:"MATCHA",price:80,enabled:false,archived:false,variants:[{label:"Standard",recipe:{items:{matcha:4,water:170}}}]}
    ],
    sales:[],orders:[],expenses:[],closes:[],recipeComments:[],settings:{},posRequestKeys:{}
  };
  await db.execute({sql:"UPDATE field_state SET document=? WHERE singleton=1",args:[JSON.stringify(doc)]});
  for(const [token,userId,csrf] of [["token-1","owner","csrf-1"],["token-2","owner2","csrf-2"]])await db.execute({sql:"INSERT INTO field_sessions VALUES(?,?,?,?)",args:[digest(token),userId,csrf,Date.now()+60000]});
  return {db,handler:createApi({db,origin})};
}
function req(route,token,csrf,body){return {method:"POST",query:{route},headers:{origin,cookie:"field_session="+token,"x-csrf-token":csrf},body}}
async function send(handler,request){const res={writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=JSON.parse(body)}};await handler(request,res);return res}

test("recipe publish exact replay creates one version and returns the original version id",async t=>{
  const {db,handler}=await setup(t),body={requestKey:"recipe-api-publish-01",operation:"publish",menuId:"menu-1",variant:"Standard",items:{matcha:5,water:180}};
  const first=await send(handler,req("admin/recipes/publish","token-1","csrf-1",body));
  assert.equal(first.status,201);assert.equal(first.body.ok,true);assert.equal(first.body.operation,"publish");assert.equal(first.body.performedBy,"owner");
  const replay=await send(handler,req("admin/recipes/publish","token-1","csrf-1",body));
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.id,first.body.id);assert.equal(replay.body.version,first.body.version);

  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_recipe_versions WHERE menu_id='menu-1'")).rows[0].n),1);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_audit WHERE action='recipe_publish'")).rows[0].n),1);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_pos_requests WHERE request_key='recipe-api-publish-01'")).rows[0].n),1);
  const state=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document),variant=state.menu.find(x=>x.id==="menu-1").variants[0];
  assert.equal(variant.recipeVersion,first.body.version);assert.deepEqual(variant.recipe.items,{matcha:5,water:180});
});

test("recipe publish durable key rejects changed payload and another actor",async t=>{
  const {db,handler}=await setup(t),body={requestKey:"recipe-api-publish-02",operation:"publish",menuId:"menu-1",variant:"Standard",items:{matcha:5,water:180}};
  assert.equal((await send(handler,req("admin/recipes/publish","token-1","csrf-1",body))).status,201);
  const changed=await send(handler,req("admin/recipes/publish","token-1","csrf-1",{...body,items:{matcha:6,water:180}}));
  assert.equal(changed.status,409);assert.equal(changed.body.error,"request_key_conflict");
  const actor=await send(handler,req("admin/recipes/publish","token-2","csrf-2",body));
  assert.equal(actor.status,409);assert.equal(actor.body.error,"request_key_conflict");
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_recipe_versions WHERE menu_id='menu-1'")).rows[0].n),1);
});

test("approved reconcile exact replay wins after legacy drift has already been consumed",async t=>{
  const {db,handler}=await setup(t),body={requestKey:"recipe-api-reconcile-01",operation:"reconcile",updateId:"pure-matcha-2026-10-12-5-180"};
  const first=await send(handler,req("admin/recipes/reconcile","token-1","csrf-1",body));
  assert.equal(first.status,201);assert.equal(first.body.operation,"reconcile");assert.equal(first.body.menuId,"pure-matcha");
  const replay=await send(handler,req("admin/recipes/reconcile","token-1","csrf-1",body));
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.id,first.body.id);assert.equal(replay.body.version,first.body.version);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_recipe_versions WHERE menu_id='pure-matcha'")).rows[0].n),1);
  const state=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document),variant=state.menu.find(x=>x.id==="pure-matcha").variants[0];
  assert.equal(variant.recipeVersion,first.body.version);assert.deepEqual(variant.recipe.items,{matcha:5,water:180});
});

test("recipe comment create exact replay leaves one R&D note",async t=>{
  const {db,handler}=await setup(t),body={requestKey:"recipe-api-comment-01",operation:"commentCreate",menuId:"menu-1",variant:"Standard",authorType:"owner",authorName:"owner",text:"balanced"};
  const first=await send(handler,req("admin/recipes/comments","token-1","csrf-1",body));
  assert.equal(first.status,201);assert.equal(first.body.operation,"commentCreate");
  const replay=await send(handler,req("admin/recipes/comments","token-1","csrf-1",body));
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.comment.id,first.body.comment.id);
  const state=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  assert.equal(state.recipeComments.length,1);assert.equal(state.recipeComments[0].id,first.body.comment.id);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_audit WHERE action='recipe_comment_create'")).rows[0].n),1);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_pos_requests WHERE request_key='recipe-api-comment-01'")).rows[0].n),1);
});

test("non-idempotent recipe POSTs require durable request identity",async t=>{
  const {handler}=await setup(t);
  for(const [route,body] of [
    ["admin/recipes/publish",{menuId:"menu-1",variant:"Standard",items:{matcha:5}}],
    ["admin/recipes/reconcile",{updateId:"pure-matcha-2026-10-12-5-180"}],
    ["admin/recipes/comments",{menuId:"menu-1",variant:"Standard",authorType:"owner",authorName:"owner",text:"good"}]
  ]){
    const res=await send(handler,req(route,"token-1","csrf-1",body));
    assert.equal(res.status,400);assert.equal(res.body.error,"invalid_request_key");
  }
});
