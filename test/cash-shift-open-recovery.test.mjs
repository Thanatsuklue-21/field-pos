import test from "node:test";
import assert from "node:assert/strict";
import {loadBrowserModule,memoryStorage} from "./helpers/load-browser-module.mjs";

const body={requestKey:"start-day-test-0001",date:"2026-10-14",openingCash:500};
const load=id=>loadBrowserModule("lib/cash-shift-open-recovery.ts",{id});
const ack=intent=>({
  ok:true,
  requestKey:intent.body.requestKey,
  performedBy:intent.actorId,
  shift:{
    id:"shift-1",
    requestKey:intent.body.requestKey,
    openedBy:intent.actorId,
    date:intent.body.date,
    openingCash:intent.body.openingCash,
    status:"open"
  }
});

test("start-day identity persists before send and exact replay clears only after ACK",async()=>{
  const first=await load("first"),store=memoryStorage(),intent=first.prepareCashShiftOpenIntent("owner",body,store);
  let sends=0;
  await assert.rejects(first.sendCashShiftOpenIntent(intent,async sent=>{
    sends++;assert.deepEqual(sent,body);assert.deepEqual(first.readCashShiftOpenIntent("owner",store),intent);
    throw Object.assign(new Error("network_unavailable"),{status:0});
  },store));
  assert.deepEqual(first.readCashShiftOpenIntent("owner",store),intent);

  const reload=await load("reload"),restored=reload.readCashShiftOpenIntent("owner",store);
  const result=await reload.sendCashShiftOpenIntent(restored,async sent=>{
    sends++;assert.deepEqual(sent,body);return {...ack(restored),replayed:true};
  },store);
  assert.equal(result.replayed,true);
  assert.equal(sends,2);
  assert.equal(reload.readCashShiftOpenIntent("owner",store),null);
});

test("unresolved start-day intent cannot be replaced with another key date or opening cash",async()=>{
  const api=await load("locked"),store=memoryStorage(),original=api.prepareCashShiftOpenIntent("owner",body,store);
  for(const changed of [
    {...body,requestKey:"start-day-test-0002"},
    {...body,date:"2026-10-15"},
    {...body,openingCash:600}
  ]){
    assert.throws(()=>api.prepareCashShiftOpenIntent("owner",changed,store),{message:"pending_cash_shift_open_exists"});
    assert.deepEqual(api.readCashShiftOpenIntent("owner",store),original);
  }
});

for(const scenario of ["empty","wrong-key","wrong-actor","wrong-date","wrong-amount"])test("inexact start-day ACK "+scenario+" retains recovery",async()=>{
  const api=await load(scenario),store=memoryStorage(),intent=api.prepareCashShiftOpenIntent("owner",body,store);
  const response=ack(intent);
  if(scenario==="empty")delete response.shift;
  if(scenario==="wrong-key")response.shift.requestKey="other-key";
  if(scenario==="wrong-actor")response.shift.openedBy="other";
  if(scenario==="wrong-date")response.shift.date="2026-10-15";
  if(scenario==="wrong-amount")response.shift.openingCash=999;
  await assert.rejects(api.sendCashShiftOpenIntent(intent,async()=>response,store),{message:"cash_shift_open_ack_unknown",status:0});
  assert.deepEqual(api.readCashShiftOpenIntent("owner",store),intent);
});

test("explicit pre-commit start-day rejection clears intent while conflict or unknown retains it",async()=>{
  const api=await load("errors");
  for(const [message,status,retained] of [
    ["business_date_changed",409,false],
    ["cash_shift_already_opened",409,false],
    ["day_already_closed",409,false],
    ["invalid_opening_cash",400,false],
    ["admin_required",403,false],
    ["request_key_conflict",409,true],
    ["server_error",500,true],
    ["network_unavailable",0,true]
  ]){
    const store=memoryStorage(),intent=api.prepareCashShiftOpenIntent("owner",body,store);
    await assert.rejects(api.sendCashShiftOpenIntent(intent,async()=>{throw Object.assign(new Error(message),{status})},store));
    assert.equal(!!api.readCashShiftOpenIntent("owner",store),retained,message);
  }
});

test("start-day storage failure blocks send and corrupt data is never treated as empty",async()=>{
  const api=await load("storage");
  const denied={getItem:()=>null,setItem:()=>{throw new Error("quota")},removeItem:()=>{}};
  assert.throws(()=>api.prepareCashShiftOpenIntent("owner",body,denied),{message:"cash_shift_open_recovery_unavailable"});
  assert.throws(()=>api.readCashShiftOpenIntent("owner",{...denied,getItem:()=>"{broken"}),{message:"cash_shift_open_recovery_unavailable"});
});
