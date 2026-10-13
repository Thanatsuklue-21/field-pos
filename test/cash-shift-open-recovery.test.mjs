import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createClient} from "@libsql/client";
import {SCHEMA} from "../lib/schema.mjs";
import {createApi} from "../lib/api.mjs";
import {digest} from "../lib/security.mjs";
import {validateCashShiftOpenAck,validatePendingCashShiftOpen} from "../lib/cash-shift-open-recovery.mjs";

const origin="https://field.test";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

async function setup(t){
  const dir=await mkdtemp(join(tmpdir(),"field-start-day-"));
  const db=createClient({url:"file:"+join(dir,"test.db")});
  t.after(async()=>{
    db.close();
    try{await rm(dir,{recursive:true,force:true})}
    catch(error){if(process.platform!=="win32"||error.code!=="EBUSY")throw error}
  });
  await db.batch(SCHEMA,"write");
  await db.execute({sql:"INSERT INTO field_users(id,username,password_hash,role,created_at,updated_at) VALUES('owner','owner','unused','admin',0,0)",args:[]});
  await db.execute({sql:"UPDATE field_state SET document=? WHERE singleton=1",args:[JSON.stringify({menu:[],ingredients:{},sales:[],orders:[],expenses:[],cashShifts:[],cashMovements:[],closes:[]})]});
  const token="start-day-token";
  await db.execute({sql:"INSERT INTO field_sessions VALUES(?,?,?,?)",args:[digest(token),"owner","csrf",Date.now()+60000]});
  return {db,token,handler:createApi({db,origin})};
}
async function send(handler,token,body){
  const res={writeHead(status,headers){this.status=status;this.headers=headers},end(payload){this.body=JSON.parse(payload)}};
  await handler({method:"POST",query:{route:["cash-shift","open"]},headers:{origin,cookie:"field_session="+token,"x-csrf-token":"csrf"},body},res);
  return res;
}

test("start day request replays the exact shift after a lost response",async t=>{
  const {db,token,handler}=await setup(t);
  const body={requestKey:"start-day-0001",openingCash:500};
  const first=await send(handler,token,body);
  assert.equal(first.status,201);assert.equal(first.body.replayed,false);
  const replay=await send(handler,token,body);
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);
  assert.equal(replay.body.shift.id,first.body.shift.id);
  const state=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  assert.equal(state.cashShifts.length,1);
  assert.equal(state.cashShifts[0].requestKey,body.requestKey);
  assert.equal(state.cashShifts[0].openingCash,500);
});

test("start day request key cannot be reused with different opening cash",async t=>{
  const {token,handler}=await setup(t);
  await send(handler,token,{requestKey:"start-day-0002",openingCash:500});
  const conflict=await send(handler,token,{requestKey:"start-day-0002",openingCash:600});
  assert.equal(conflict.status,409);
  assert.equal(conflict.body.error,"request_key_conflict");
});

test("start day recovery record and ack require exact mutation identity",()=>{
  const body={requestKey:"start-day-0003",openingCash:750};
  const pending={body,createdAt:1};
  assert.equal(validatePendingCashShiftOpen(pending),pending);
  const ack={ok:true,shift:{...body,id:"shift_1",date:"2026-10-13",status:"open"}};
  assert.equal(validateCashShiftOpenAck(ack,body),ack);
  for(const bad of [
    {ok:true,shift:{...ack.shift,requestKey:"other-key"}},
    {ok:true,shift:{...ack.shift,openingCash:751}},
    {ok:false,shift:ack.shift}
  ]) assert.throws(()=>validateCashShiftOpenAck(bad,body),/cash_shift_open_unconfirmed/);
});

test("Close page and POS Today use the same durable start-day client",async()=>{
  const close=await read("app/close/page.tsx");
  const hub=await read("components/pos-operations-hub.tsx");
  const client=await read("lib/cash-shift-client.ts");
  assert.match(close,/sendCashShiftOpenDurably\(session\.csrf,body\)/);
  assert.match(close,/readPendingCashShiftOpen\(\)/);
  assert.match(hub,/sendCashShiftOpenDurably\(session\.csrf/);
  assert.match(hub,/readPendingCashShiftOpen\(\)/);
  assert.match(hub,/เปิดร้านวันนี้/);
  assert.match(hub,/เงินสดตั้งต้น/);
  assert.match(client,/validateCashShiftOpenAck/);
  assert.match(client,/clearPendingCashShiftOpen\(\)/);
});

test("start-day endpoint gets bounded timeout only after durable recovery exists",async()=>{
  const client=await read("lib/api-client.ts");
  const recovery=await read("lib/cash-shift-open-recovery.mjs");
  assert.match(client,/RECOVERABLE_WRITE_PATHS[\s\S]*"\/api\/cash-shift\/open"/);
  assert.match(recovery,/CASH_SHIFT_OPEN_PENDING_KEY/);
  assert.match(recovery,/shouldRetainCashShiftOpenPending/);
});


test("legacy stale PWA can still open one shift without requestKey during rollout",async t=>{
  const {token,handler}=await setup(t);
  const first=await send(handler,token,{openingCash:400});
  assert.equal(first.status,201);
  assert.equal(first.body.shift.requestKey,null);
  const second=await send(handler,token,{openingCash:400});
  assert.equal(second.status,409);
  assert.equal(second.body.error,"cash_shift_already_opened");
});
