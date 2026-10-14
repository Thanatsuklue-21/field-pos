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
  const dir=await mkdtemp(join(tmpdir(),"field-customer-points-")),db=createClient({url:"file:"+join(dir,"test.db")});
  t.after(async()=>{db.close();try{await rm(dir,{recursive:true,force:true})}catch(error){if(process.platform!=="win32"||error.code!=="EBUSY")throw error}});
  await db.batch(SCHEMA,"write");
  for(const id of ["owner","owner2"])await db.execute({sql:"INSERT INTO field_users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,0,0)",args:[id,id,"unused","admin"]});
  const doc={menu:[],ingredients:{},sales:[],orders:[],expenses:[],closes:[],customers:[{id:"cus-1",name:"A",phone:"",lineId:"",points:10,visits:0,totalSpend:0,lastVisit:0}],settings:{},posRequestKeys:{}};
  await db.execute({sql:"UPDATE field_state SET document=? WHERE singleton=1",args:[JSON.stringify(doc)]});
  for(const [token,userId,csrf] of [["token-1","owner","csrf-1"],["token-2","owner2","csrf-2"]])await db.execute({sql:"INSERT INTO field_sessions VALUES(?,?,?,?)",args:[digest(token),userId,csrf,Date.now()+60000]});
  return {db,handler:createApi({db,origin})};
}
function req(token,csrf,body){return {method:"PATCH",query:{route:"customers/cus-1"},headers:{origin,cookie:"field_session="+token,"x-csrf-token":csrf},body}}
async function send(handler,request){const res={writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=JSON.parse(body)}};await handler(request,res);return res}

test("real libSQL customer point replay applies exactly once",async t=>{
  const {db,handler}=await setup(t),body={requestKey:"points-api-0001",customerId:"cus-1",pointsDelta:1};
  const first=await send(handler,req("token-1","csrf-1",body));
  assert.equal(first.status,200);assert.equal(first.body.ok,true);assert.equal(first.body.pointsBefore,10);assert.equal(first.body.pointsAfter,11);assert.equal(first.body.performedBy,"owner");

  const replay=await send(handler,req("token-1","csrf-1",body));
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.pointsAfter,11);

  const state=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  assert.equal(state.customers[0].points,11);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_audit WHERE action='customer_points_adjust'")).rows[0].n),1);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_pos_requests WHERE request_key='points-api-0001'")).rows[0].n),1);
});

test("customer point durable key rejects changed delta and another actor",async t=>{
  const {db,handler}=await setup(t),body={requestKey:"points-api-0002",customerId:"cus-1",pointsDelta:-1};
  assert.equal((await send(handler,req("token-1","csrf-1",body))).status,200);
  const changed=await send(handler,req("token-1","csrf-1",{...body,pointsDelta:1}));
  assert.equal(changed.status,409);assert.equal(changed.body.error,"request_key_conflict");
  const actor=await send(handler,req("token-2","csrf-2",body));
  assert.equal(actor.status,409);assert.equal(actor.body.error,"request_key_conflict");
  const state=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  assert.equal(state.customers[0].points,9);
});

test("points adjustment requires durable request identity",async t=>{
  const {handler}=await setup(t);
  const missing=await send(handler,req("token-1","csrf-1",{customerId:"cus-1",pointsDelta:1}));
  assert.equal(missing.status,400);assert.equal(missing.body.error,"invalid_request_key");
  const mismatch=await send(handler,req("token-1","csrf-1",{requestKey:"points-api-0003",customerId:"cus-other",pointsDelta:1}));
  assert.equal(mismatch.status,400);assert.equal(mismatch.body.error,"invalid_customer_points_request");
});
