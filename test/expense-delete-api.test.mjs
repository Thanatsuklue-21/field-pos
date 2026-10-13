import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createClient} from "@libsql/client";
import {SCHEMA} from "../lib/schema.mjs";
import {createApi} from "../lib/api.mjs";
import {digest} from "../lib/security.mjs";
import {bangkokDate} from "../lib/time.mjs";

const origin="https://field.test";
async function setup(t){
  const dir=await mkdtemp(join(tmpdir(),"field-expdel-")),db=createClient({url:"file:"+join(dir,"test.db")});
  t.after(async()=>{db.close();try{await rm(dir,{recursive:true,force:true})}catch(error){if(process.platform!=="win32"||error.code!=="EBUSY")throw error}});
  await db.batch(SCHEMA,"write");
  for(const id of ["owner","owner2"])await db.execute({sql:"INSERT INTO field_users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,0,0)",args:[id,id,"unused","admin"]});
  const date=bangkokDate(),doc={
    menu:[],ingredients:{},sales:[],orders:[],closes:[],cashMovements:[],cashShifts:[],settings:{},posRequestKeys:{},
    expenses:[{id:"exp-1",date,time:1,category:"OTHER",description:"parking",amount:30,paymentMethod:"cash",sourceType:"MANUAL",createdBy:"owner"}]
  };
  await db.execute({sql:"UPDATE field_state SET document=? WHERE singleton=1",args:[JSON.stringify(doc)]});
  for(const [token,userId,csrf] of [["token-1","owner","csrf-1"],["token-2","owner2","csrf-2"]])await db.execute({sql:"INSERT INTO field_sessions VALUES(?,?,?,?)",args:[digest(token),userId,csrf,Date.now()+60000]});
  return {db,date,handler:createApi({db,origin})};
}
function req(token,csrf,expenseId,body){return {method:"DELETE",query:{route:"expenses/"+expenseId},headers:{origin,cookie:"field_session="+token,"x-csrf-token":csrf},body}}
async function send(handler,request){const res={writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=JSON.parse(body)}};await handler(request,res);return res}

test("real libSQL expense delete replay creates one accounting effect and one audit row",async t=>{
  const {db,date,handler}=await setup(t),body={requestKey:"expense-delete-api-0001",date,expectedAmount:30};
  const first=await send(handler,req("token-1","csrf-1","exp-1",body));
  assert.equal(first.status,200);assert.equal(first.body.ok,true);assert.equal(first.body.deleted,true);assert.equal(first.body.deletedBy,"owner");assert.equal(first.body.amount,30);

  const replay=await send(handler,req("token-1","csrf-1","exp-1",body));
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.expenseId,"exp-1");

  const state=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  assert.equal(state.expenses.length,0);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_audit WHERE action='expense_delete'")).rows[0].n),1);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_pos_requests WHERE request_key='expense-delete-api-0001'")).rows[0].n),1);
});

test("expense delete durable key rejects changed target amount and another actor",async t=>{
  const {db,date,handler}=await setup(t),body={requestKey:"expense-delete-api-0002",date,expectedAmount:30};
  assert.equal((await send(handler,req("token-1","csrf-1","exp-1",body))).status,200);
  const changedId=await send(handler,req("token-1","csrf-1","exp-2",body));
  assert.equal(changedId.status,409);assert.equal(changedId.body.error,"request_key_conflict");
  const changedAmount=await send(handler,req("token-1","csrf-1","exp-1",{...body,expectedAmount:31}));
  assert.equal(changedAmount.status,409);assert.equal(changedAmount.body.error,"request_key_conflict");
  const actor=await send(handler,req("token-2","csrf-2","exp-1",body));
  assert.equal(actor.status,409);assert.equal(actor.body.error,"request_key_conflict");
  const state=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  assert.equal(state.expenses.length,0);
});

test("committed expense deletion replays after record is gone and day is later closed",async t=>{
  const {db,date,handler}=await setup(t),body={requestKey:"expense-delete-api-0003",date,expectedAmount:30};
  const first=await send(handler,req("token-1","csrf-1","exp-1",body));assert.equal(first.status,200);
  const row=(await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0],doc=JSON.parse(row.document);doc.closes=[{id:"close-1",date}];
  await db.execute({sql:"UPDATE field_state SET document=? WHERE singleton=1",args:[JSON.stringify(doc)]});
  const replay=await send(handler,req("token-1","csrf-1","exp-1",body));
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.requestKey,body.requestKey);
});

test("new delete with stale confirmed amount is rejected before mutation",async t=>{
  const {db,date,handler}=await setup(t),body={requestKey:"expense-delete-api-0004",date,expectedAmount:31};
  const result=await send(handler,req("token-1","csrf-1","exp-1",body));
  assert.equal(result.status,409);assert.equal(result.body.error,"expense_target_changed");
  const state=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  assert.equal(state.expenses.length,1);
});


test("bodyless expense DELETE fails closed instead of bypassing durable identity",async t=>{
  const {db,handler}=await setup(t);
  const result=await send(handler,req("token-1","csrf-1","exp-1",undefined));
  assert.equal(result.status,400);
  assert.equal(result.body.error,"invalid_json");
  const state=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  assert.equal(state.expenses.length,1);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_audit WHERE action='expense_delete'")).rows[0].n),0);
});
