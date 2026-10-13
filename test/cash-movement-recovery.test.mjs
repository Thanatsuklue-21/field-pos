import test from "node:test";
import assert from "node:assert/strict";
import {loadBrowserModule,memoryStorage} from "./helpers/load-browser-module.mjs";

const body={requestKey:"cashmove-test-0001",date:"2026-10-13",type:"CASH_OUT",amount:120,reason:"เก็บเงินส่วนเกิน",riskConfirmed:false};
const load=id=>loadBrowserModule("lib/cash-movement-recovery.ts",{id});
const ack=intent=>({ok:true,availableCash:880,movement:{id:"cashmv-1",requestKey:intent.body.requestKey,createdBy:intent.actorId,date:intent.body.date,type:intent.body.type,amount:intent.body.amount,reason:intent.body.reason}});

test("cash drawer identity persists before send and exact replay clears only after ACK",async()=>{
  const first=await load("first"),store=memoryStorage(),intent=first.prepareCashMovementIntent("owner",body,store);
  let sends=0;
  await assert.rejects(first.sendCashMovementIntent(intent,async sent=>{
    sends++;assert.deepEqual(sent,body);assert.deepEqual(first.readCashMovementIntent("owner",store),intent);
    throw Object.assign(new Error("network_unavailable"),{status:0});
  },store));
  assert.deepEqual(first.readCashMovementIntent("owner",store),intent);

  const reload=await load("reload"),restored=reload.readCashMovementIntent("owner",store);
  const result=await reload.sendCashMovementIntent(restored,async sent=>{sends++;assert.deepEqual(sent,body);return {...ack(restored),replayed:true}},store);
  assert.equal(result.replayed,true);
  assert.equal(sends,2);
  assert.equal(reload.readCashMovementIntent("owner",store),null);
});

test("unresolved cash movement cannot be replaced with a new key or changed amount",async()=>{
  const api=await load("locked"),store=memoryStorage(),original=api.prepareCashMovementIntent("owner",body,store);
  for(const changed of [{...body,requestKey:"cashmove-test-0002"},{...body,amount:121}]){
    assert.throws(()=>api.prepareCashMovementIntent("owner",changed,store),{message:"pending_cash_movement_exists"});
    assert.deepEqual(api.readCashMovementIntent("owner",store),original);
  }
});

for(const scenario of ["empty","wrong-key","wrong-amount","wrong-actor"])test("inexact cash movement ACK "+scenario+" retains recovery",async()=>{
  const api=await load(scenario),store=memoryStorage(),intent=api.prepareCashMovementIntent("owner",body,store);
  const response=ack(intent);
  if(scenario==="empty")delete response.movement;
  if(scenario==="wrong-key")response.movement.requestKey="other-key";
  if(scenario==="wrong-amount")response.movement.amount=999;
  if(scenario==="wrong-actor")response.movement.createdBy="other";
  await assert.rejects(api.sendCashMovementIntent(intent,async()=>response,store),{message:"cash_movement_ack_unknown",status:0});
  assert.deepEqual(api.readCashMovementIntent("owner",store),intent);
});

test("explicit pre-commit rejection releases cash movement intent but conflict or unknown retains it",async()=>{
  const api=await load("errors");
  for(const [message,status,retained] of [
    ["drawer_cash_shortage",409,false],["business_date_changed",409,false],["cash_shift_not_open",409,false],
    ["request_key_conflict",409,true],["server_error",500,true],["network_unavailable",0,true]
  ]){
    const store=memoryStorage(),intent=api.prepareCashMovementIntent("owner",body,store);
    await assert.rejects(api.sendCashMovementIntent(intent,async()=>{throw Object.assign(new Error(message),{status})},store));
    assert.equal(!!api.readCashMovementIntent("owner",store),retained,message);
  }
});

test("cash movement storage failure blocks send and corrupt data is never treated as empty",async()=>{
  const api=await load("storage");
  const denied={getItem:()=>null,setItem:()=>{throw new Error("quota")},removeItem:()=>{}};
  assert.throws(()=>api.prepareCashMovementIntent("owner",body,denied),{message:"cash_movement_recovery_unavailable"});
  assert.throws(()=>api.readCashMovementIntent("owner",{...denied,getItem:()=>"{broken"}),{message:"cash_movement_recovery_unavailable"});
});
