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
  const dir=await mkdtemp(join(tmpdir(),"field-product-master-create-")),db=createClient({url:"file:"+join(dir,"test.db")});
  t.after(async()=>{db.close();try{await rm(dir,{recursive:true,force:true})}catch(error){if(process.platform!=="win32"||error.code!=="EBUSY")throw error}});
  await db.batch(SCHEMA,"write");
  for(const id of ["owner","owner2"])await db.execute({sql:"INSERT INTO field_users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,0,0)",args:[id,id,"unused","admin"]});
  const doc={menu:[],ingredients:{},sales:[],orders:[],expenses:[],closes:[],settings:{},posRequestKeys:{}};
  await db.execute({sql:"UPDATE field_state SET document=? WHERE singleton=1",args:[JSON.stringify(doc)]});
  for(const [token,userId,csrf] of [["token-1","owner","csrf-1"],["token-2","owner2","csrf-2"]])await db.execute({sql:"INSERT INTO field_sessions VALUES(?,?,?,?)",args:[digest(token),userId,csrf,Date.now()+60000]});
  return {db,handler:createApi({db,origin})};
}
function req(token,csrf,body){return {method:"POST",query:{route:"admin/products"},headers:{origin,cookie:"field_session="+token,"x-csrf-token":csrf},body}}
async function send(handler,request){const res={writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=JSON.parse(body)}};await handler(request,res);return res}

const image="data:image/jpeg;base64,/9j/2Q==";

test("real libSQL product create replay keeps one Product ID and one image row",async t=>{
  const {db,handler}=await setup(t),body={requestKey:"product-api-0001",name:"Matcha Latte",category:"OTHER",prepBaseId:"",price:90,imageDataUrl:image};
  const first=await send(handler,req("token-1","csrf-1",body));
  assert.equal(first.status,201);assert.equal(first.body.ok,true);assert.equal(first.body.performedBy,"owner");
  assert.equal(first.body.product.name,"Matcha Latte");assert.equal(first.body.product.enabled,false);
  const id=first.body.product.id,imageUrl=first.body.product.image;
  assert.ok(id.startsWith("menu-"));assert.ok(imageUrl.startsWith("/api/menu-images/"+encodeURIComponent(id)+"?v="));

  const replay=await send(handler,req("token-1","csrf-1",body));
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.product.id,id);assert.equal(replay.body.product.image,imageUrl);

  const state=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  assert.equal(state.menu.length,1);assert.equal(state.menu[0].id,id);assert.equal(state.menu[0].image,imageUrl);
  assert.equal(Number((await db.execute({sql:"SELECT COUNT(*) AS n FROM field_menu_images WHERE menu_id=?",args:[id]})).rows[0].n),1);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_audit WHERE action='product_create'")).rows[0].n),1);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_pos_requests WHERE request_key='product-api-0001'")).rows[0].n),1);
});

test("product create durable key rejects changed payload and another actor",async t=>{
  const {db,handler}=await setup(t),body={requestKey:"product-api-0002",name:"Americano",category:"OTHER",prepBaseId:"",price:60,imageDataUrl:""};
  assert.equal((await send(handler,req("token-1","csrf-1",body))).status,201);
  const changed=await send(handler,req("token-1","csrf-1",{...body,price:65}));
  assert.equal(changed.status,409);assert.equal(changed.body.error,"request_key_conflict");
  const actor=await send(handler,req("token-2","csrf-2",body));
  assert.equal(actor.status,409);assert.equal(actor.body.error,"request_key_conflict");
  const state=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  assert.equal(state.menu.length,1);
});

test("product create requires request identity and validates image before any write",async t=>{
  const {db,handler}=await setup(t);
  const missing=await send(handler,req("token-1","csrf-1",{name:"Cocoa",category:"OTHER",prepBaseId:"",price:70,imageDataUrl:""}));
  assert.equal(missing.status,400);assert.equal(missing.body.error,"invalid_request_key");
  const badImage=await send(handler,req("token-1","csrf-1",{requestKey:"product-api-0003",name:"Cocoa",category:"OTHER",prepBaseId:"",price:70,imageDataUrl:"data:image/svg+xml;base64,PHN2Zy8+"}));
  assert.equal(badImage.status,400);assert.equal(badImage.body.error,"invalid_menu_image");
  const state=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  assert.equal(state.menu.length,0);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_menu_images")).rows[0].n),0);
});
