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
  const dir=await mkdtemp(join(tmpdir(),"field-customer-create-")),db=createClient({url:"file:"+join(dir,"test.db")});
  t.after(async()=>{db.close();try{await rm(dir,{recursive:true,force:true})}catch(error){if(process.platform!=="win32"||error.code!=="EBUSY")throw error}});
  await db.batch(SCHEMA,"write");
  for(const id of ["owner","owner2"])await db.execute({sql:"INSERT INTO field_users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,0,0)",args:[id,id,"unused","admin"]});
  const doc={menu:[],ingredients:{},sales:[],orders:[],expenses:[],closes:[],customers:[],settings:{},posRequestKeys:{}};
  await db.execute({sql:"UPDATE field_state SET document=? WHERE singleton=1",args:[JSON.stringify(doc)]});
  for(const [token,userId,csrf] of [["token-1","owner","csrf-1"],["token-2","owner2","csrf-2"]])await db.execute({sql:"INSERT INTO field_sessions VALUES(?,?,?,?)",args:[digest(token),userId,csrf,Date.now()+60000]});
  return {db,handler:createApi({db,origin})};
}
function req(token,csrf,body){return {method:"POST",query:{route:"customers"},headers:{origin,cookie:"field_session="+token,"x-csrf-token":csrf},body}}
async function send(handler,request){const res={writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=JSON.parse(body)}};await handler(request,res);return res}

test("real libSQL customer create replay leaves one customer even without phone",async t=>{
  const {db,handler}=await setup(t),body={requestKey:"customer-api-0001",name:"Somchai",phone:"",lineId:"somchai-line"};
  const first=await send(handler,req("token-1","csrf-1",body));
  assert.equal(first.status,201);assert.equal(first.body.ok,true);assert.equal(first.body.performedBy,"owner");
  const id=first.body.customer.id;assert.ok(id.startsWith("cus_"));
  const replay=await send(handler,req("token-1","csrf-1",body));
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.customer.id,id);

  const state=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  assert.equal(state.customers.length,1);assert.equal(state.customers[0].id,id);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_audit WHERE action='customer_create'")).rows[0].n),1);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_pos_requests WHERE request_key='customer-api-0001'")).rows[0].n),1);
});

test("customer create replay wins before duplicate-phone guard",async t=>{
  const {db,handler}=await setup(t),body={requestKey:"customer-api-0002",name:"Somying",phone:"0812345678",lineId:""};
  const first=await send(handler,req("token-1","csrf-1",body));
  assert.equal(first.status,201);
  const replay=await send(handler,req("token-1","csrf-1",body));
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.customer.id,first.body.customer.id);
  const state=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  assert.equal(state.customers.length,1);
});

test("customer durable key rejects changed payload and another actor",async t=>{
  const {db,handler}=await setup(t),body={requestKey:"customer-api-0003",name:"A",phone:"",lineId:""};
  assert.equal((await send(handler,req("token-1","csrf-1",body))).status,201);
  const changed=await send(handler,req("token-1","csrf-1",{...body,name:"B"}));
  assert.equal(changed.status,409);assert.equal(changed.body.error,"request_key_conflict");
  const actor=await send(handler,req("token-2","csrf-2",body));
  assert.equal(actor.status,409);assert.equal(actor.body.error,"request_key_conflict");
  const state=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  assert.equal(state.customers.length,1);
});

test("customer create requires request identity and phone duplicate remains authoritative",async t=>{
  const {db,handler}=await setup(t);
  const missing=await send(handler,req("token-1","csrf-1",{name:"A",phone:"",lineId:""}));
  assert.equal(missing.status,400);assert.equal(missing.body.error,"invalid_request_key");
  const first=await send(handler,req("token-1","csrf-1",{requestKey:"customer-api-0004",name:"A",phone:"0800000000",lineId:""}));
  assert.equal(first.status,201);
  const duplicate=await send(handler,req("token-1","csrf-1",{requestKey:"customer-api-0005",name:"B",phone:"0800000000",lineId:""}));
  assert.equal(duplicate.status,409);assert.equal(duplicate.body.error,"customer_phone_exists");
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_pos_requests")).rows[0].n),1);
});
