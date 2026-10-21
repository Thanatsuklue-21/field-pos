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
test('real libSQL set master receives 50 sets and replays without duplicate stock',async t=>{
 const {db,handler}=await setup(t),create={requestKey:'set-master-0001',name:'Hot cup and lid',unit:'set',safetyStock:0,costKind:'other',wasteMargin:0};
 const master=await send(handler,req('token-1','csrf-1',create));assert.equal(master.status,201);
 const body={requestKey:'set-receipt-0001',ingredientId:master.body.ingredient.id,type:'PURCHASE',unit:'set',packageQty:1,packageUnit:'แพ็ก',packSize:50,packSizeUnit:'set',purchaseCost:200};
 const request=()=>({...req('token-1','csrf-1',body),query:{route:'stock/transactions'}});
 assert.equal((await send(handler,request())).status,201);assert.equal((await send(handler,request())).status,200);
 const state=JSON.parse((await db.execute('SELECT document FROM field_state WHERE singleton=1')).rows[0].document);
 assert.equal(state.ingredients[body.ingredientId].qty,50);assert.equal(state.ingredients[body.ingredientId].unit,'set');
 assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_stock_transactions WHERE request_key='set-receipt-0001'")).rows[0].n),1);
});
async function setup(t){
  const dir=await mkdtemp(join(tmpdir(),"field-stock-master-create-")),db=createClient({url:"file:"+join(dir,"test.db")});
  t.after(async()=>{db.close();try{await rm(dir,{recursive:true,force:true})}catch(error){if(process.platform!=="win32"||error.code!=="EBUSY")throw error}});
  await db.batch(SCHEMA,"write");
  for(const id of ["owner","owner2"])await db.execute({sql:"INSERT INTO field_users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,0,0)",args:[id,id,"unused","admin"]});
  const doc={menu:[],ingredients:{},sales:[],orders:[],expenses:[],closes:[],settings:{},posRequestKeys:{}};
  await db.execute({sql:"UPDATE field_state SET document=? WHERE singleton=1",args:[JSON.stringify(doc)]});
  for(const [token,userId,csrf] of [["token-1","owner","csrf-1"],["token-2","owner2","csrf-2"]])await db.execute({sql:"INSERT INTO field_sessions VALUES(?,?,?,?)",args:[digest(token),userId,csrf,Date.now()+60000]});
  return {db,handler:createApi({db,origin})};
}
function req(token,csrf,body){return {method:"POST",query:{route:"stock/ingredients"},headers:{origin,cookie:"field_session="+token,"x-csrf-token":csrf},body}}
async function send(handler,request){const res={writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=JSON.parse(body)}};await handler(request,res);return res}

test("real libSQL stock master create replay creates exactly one ingredient",async t=>{
  const {db,handler}=await setup(t),body={requestKey:"ingredient-api-0001",name:"Matcha",unit:"g",safetyStock:100,costKind:"powder",wasteMargin:0};
  const first=await send(handler,req("token-1","csrf-1",body));
  assert.equal(first.status,201);assert.equal(first.body.ok,true);assert.equal(first.body.performedBy,"owner");assert.equal(first.body.ingredient.name,"Matcha");
  const id=first.body.ingredient.id;

  const replay=await send(handler,req("token-1","csrf-1",body));
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.ingredient.id,id);

  const state=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  assert.equal(Object.keys(state.ingredients).length,1);assert.equal(state.ingredients[id].name,"Matcha");
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_audit WHERE action='stock_ingredient_create'")).rows[0].n),1);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_pos_requests WHERE request_key='ingredient-api-0001'")).rows[0].n),1);
});

test("stock master durable key rejects changed payload and another actor",async t=>{
  const {db,handler}=await setup(t),body={requestKey:"ingredient-api-0002",name:"Fresh Milk",unit:"ml",safetyStock:1000,costKind:"milk",wasteMargin:0};
  assert.equal((await send(handler,req("token-1","csrf-1",body))).status,201);
  const changed=await send(handler,req("token-1","csrf-1",{...body,safetyStock:1200}));
  assert.equal(changed.status,409);assert.equal(changed.body.error,"request_key_conflict");
  const actor=await send(handler,req("token-2","csrf-2",body));
  assert.equal(actor.status,409);assert.equal(actor.body.error,"request_key_conflict");
  const state=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  assert.equal(Object.keys(state.ingredients).length,1);
});

test("stock master create requires request identity and preserves supported waste margin",async t=>{
  const {handler}=await setup(t);
  const missing=await send(handler,req("token-1","csrf-1",{name:"Syrup",unit:"ml",safetyStock:100,costKind:"syrup",wasteMargin:.08}));
  assert.equal(missing.status,400);assert.equal(missing.body.error,"invalid_request_key");

  const body={requestKey:"ingredient-api-0003",name:"Syrup",unit:"ml",safetyStock:100,costKind:"syrup",wasteMargin:.08};
  const created=await send(handler,req("token-1","csrf-1",body));
  assert.equal(created.status,201);assert.equal(created.body.ingredient.wasteMargin,.08);
});
