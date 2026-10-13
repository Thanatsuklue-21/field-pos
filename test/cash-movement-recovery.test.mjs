import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createClient} from "@libsql/client";
import {SCHEMA} from "../lib/schema.mjs";
import {createApi} from "../lib/api.mjs";
import {digest} from "../lib/security.mjs";
import {validateCashMovementAck,validatePendingCashMovement} from "../lib/cash-movement-recovery.mjs";

const origin="https://field.test";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

async function setup(t){
  const dir=await mkdtemp(join(tmpdir(),"field-cash-movement-"));
  const db=createClient({url:"file:"+join(dir,"test.db")});
  t.after(async()=>{
    db.close();
    try{await rm(dir,{recursive:true,force:true})}
    catch(error){if(process.platform!=="win32"||error.code!=="EBUSY")throw error}
  });
  await db.batch(SCHEMA,"write");
  await db.execute({sql:"INSERT INTO field_users(id,username,password_hash,role,created_at,updated_at) VALUES('owner','owner','unused','admin',0,0)",args:[]});
  await db.execute({sql:"UPDATE field_state SET document=? WHERE singleton=1",args:[JSON.stringify({menu:[],ingredients:{},sales:[],orders:[],expenses:[],cashShifts:[],cashMovements:[],closes:[]})]});
  const token="cash-movement-token";
  await db.execute({sql:"INSERT INTO field_sessions VALUES(?,?,?,?)",args:[digest(token),"owner","csrf",Date.now()+60000]});
  return {db,token,handler:createApi({db,origin})};
}
async function send(handler,token,route,body){
  const res={writeHead(status,headers){this.status=status;this.headers=headers},end(payload){this.body=JSON.parse(payload)}};
  await handler({method:"POST",query:{route},headers:{origin,cookie:"field_session="+token,"x-csrf-token":"csrf"},body},res);
  return res;
}

test("cash drawer movement requestKey prevents duplicate money movement after lost response",async t=>{
  const {db,token,handler}=await setup(t);
  assert.equal((await send(handler,token,"cash-shift/open",{requestKey:"open-for-cash-move-1",openingCash:500})).status,201);
  const body={requestKey:"cash-move-0001",type:"CASH_OUT",amount:100,reason:"เก็บเงินสดส่วนเกิน"};
  const first=await send(handler,token,"cash-shift/movements",body);
  assert.equal(first.status,201);assert.equal(first.body.replayed,false);
  const replay=await send(handler,token,"cash-shift/movements",body);
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);
  assert.equal(replay.body.movement.id,first.body.movement.id);
  const state=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  assert.equal(state.cashMovements.length,1);
  assert.equal(state.cashMovements[0].requestKey,body.requestKey);
  assert.equal(state.cashMovements[0].amount,100);
  assert.equal(replay.body.availableCash,400);
});

test("cash movement requestKey conflict fails closed",async t=>{
  const {token,handler}=await setup(t);
  await send(handler,token,"cash-shift/open",{requestKey:"open-for-cash-move-2",openingCash:500});
  await send(handler,token,"cash-shift/movements",{requestKey:"cash-move-0002",type:"CASH_IN",amount:50,reason:"เติมเงินทอน"});
  const conflict=await send(handler,token,"cash-shift/movements",{requestKey:"cash-move-0002",type:"CASH_IN",amount:60,reason:"เติมเงินทอน"});
  assert.equal(conflict.status,409);assert.equal(conflict.body.error,"request_key_conflict");
});

test("cash movement recovery record and ack require the exact mutation identity",()=>{
  const body={requestKey:"cash-move-0003",type:"CASH_OUT",amount:75,reason:"เก็บเงินสด"};
  const pending={body,createdAt:1};
  assert.equal(validatePendingCashMovement(pending),pending);
  const ack={ok:true,movement:{...body,id:"cashmv_1"}};
  assert.equal(validateCashMovementAck(ack,body),ack);
  for(const bad of [
    {ok:true,movement:{...body,requestKey:"other-key"}},
    {ok:true,movement:{...body,amount:76}},
    {ok:true,movement:{...body,type:"CASH_IN"}},
    {ok:false,movement:{...body}}
  ]) assert.throws(()=>validateCashMovementAck(bad,body),/cash_movement_unconfirmed/);
});

test("close-day UI persists exact cash movement before send and clears only after ack",async()=>{
  const ui=await read("app/close/page.tsx");
  const start=ui.indexOf("async function sendCashMovement");
  const end=ui.indexOf("useEffect(()=>",start);
  const block=ui.slice(start,end);
  assert.match(block,/cashMovementPendingWrite\(body\)/);
  assert.match(block,/JSON\.stringify\(pending\.body\)/);
  assert.match(block,/validateCashMovementAck\(r,pending\.body\)/);
  assert.ok(block.indexOf("cashMovementPendingWrite(body)")<block.indexOf('api<any>("/api/cash-shift/movements"'));
  assert.ok(block.indexOf("validateCashMovementAck(r,pending.body)")<block.indexOf("cashMovementPendingClear()"));
  assert.match(ui,/window\.addEventListener\("online",onOnline\)/);
  assert.match(ui,/window\.addEventListener\("focus",onFocus\)/);
  assert.match(ui,/visibilitychange/);
});

test("cash movement receives client timeout only after durable recovery exists",async()=>{
  const client=await read("lib/api-client.ts");
  const recovery=await read("lib/cash-movement-recovery.mjs");
  assert.match(client,/RECOVERABLE_WRITE_PATHS[\s\S]*"\/api\/cash-shift\/movements"/);
  assert.match(recovery,/CASH_MOVEMENT_PENDING_KEY/);
  assert.match(recovery,/shouldRetainCashMovementPending/);
});
