import test from "node:test";
import assert from "node:assert/strict";
import {loadBrowserModule,memoryStorage} from "./helpers/load-browser-module.mjs";

const voidBody={requestKey:"void-test-0001",saleId:"s-1",reason:"ลูกค้ายกเลิก",riskConfirmed:true,expectedDate:"2026-10-13",expectedAmount:55};
const refundBody={requestKey:"refund-test-0001",saleId:"s-2",reason:"คืนเงินลูกค้า",riskConfirmed:true,manualConfirmed:false,manualReference:"",expectedDate:"2026-10-13",expectedRefundAmount:55,expectedSaleIds:["s-2"]};
const load=id=>loadBrowserModule("lib/order-mutation-recovery.ts",{id});
const voidAck=intent=>({ok:true,action:"void",requestKey:intent.body.requestKey,performedBy:intent.actorId,saleId:intent.body.saleId,date:intent.body.expectedDate,voidAmount:intent.body.expectedAmount,stockRestored:true});
const refundAck=intent=>({ok:true,action:"refund",requestKey:intent.body.requestKey,performedBy:intent.actorId,saleId:intent.body.saleId,date:intent.body.expectedDate,refundAmount:intent.body.expectedRefundAmount,saleIds:intent.body.expectedSaleIds,stockRestored:false});

test("VOID intent survives lost response and reload then clears only exact ACK",async()=>{
  const first=await load("void-first"),store=memoryStorage(),intent=first.prepareOrderMutationIntent("owner","void",voidBody,{purpose:"edit_cash"},store);
  await assert.rejects(first.sendOrderMutationIntent(intent,async()=>{throw Object.assign(new Error("network_unavailable"),{status:0})},store));
  assert.deepEqual(first.readOrderMutationIntent("owner",store),intent);
  const reload=await load("void-reload"),restored=reload.readOrderMutationIntent("owner",store);
  const result=await reload.sendOrderMutationIntent(restored,async(op,body)=>{assert.equal(op,"void");assert.deepEqual(body,voidBody);return {...voidAck(restored),replayed:true}},store);
  assert.equal(result.replayed,true);assert.equal(reload.readOrderMutationIntent("owner",store),null);assert.equal(restored.meta.purpose,"edit_cash");
});

test("Refund intent survives lost response and uses the same sale group snapshot",async()=>{
  const api=await load("refund"),store=memoryStorage(),intent=api.prepareOrderMutationIntent("owner","refund",refundBody,undefined,store);
  await assert.rejects(api.sendOrderMutationIntent(intent,async()=>{throw Object.assign(new Error("network_unavailable"),{status:0})},store));
  const restored=api.readOrderMutationIntent("owner",store);
  const result=await api.sendOrderMutationIntent(restored,async(op,body)=>{assert.equal(op,"refund");assert.deepEqual(body.expectedSaleIds,["s-2"]);return refundAck(restored)},store);
  assert.equal(result.action,"refund");assert.equal(api.readOrderMutationIntent("owner",store),null);
});

test("one unresolved order mutation blocks replacing VOID with Refund or a changed payload",async()=>{
  const api=await load("locked"),store=memoryStorage(),original=api.prepareOrderMutationIntent("owner","void",voidBody,undefined,store);
  for(const [op,body] of [["refund",refundBody],["void",{...voidBody,reason:"เปลี่ยนเหตุผล"}]]){
    assert.throws(()=>api.prepareOrderMutationIntent("owner",op,body,undefined,store),{message:"pending_order_mutation_exists"});
    assert.deepEqual(api.readOrderMutationIntent("owner",store),original);
  }
});

for(const scenario of ["wrong-key","wrong-actor","wrong-sale","wrong-date","wrong-amount"])test("inexact VOID ACK "+scenario+" retains recovery",async()=>{
  const api=await load("void-"+scenario),store=memoryStorage(),intent=api.prepareOrderMutationIntent("owner","void",voidBody,undefined,store),response=voidAck(intent);
  if(scenario==="wrong-key")response.requestKey="other";
  if(scenario==="wrong-actor")response.performedBy="other";
  if(scenario==="wrong-sale")response.saleId="s-other";
  if(scenario==="wrong-date")response.date="2026-10-12";
  if(scenario==="wrong-amount")response.voidAmount=56;
  await assert.rejects(api.sendOrderMutationIntent(intent,async()=>response,store),{message:"order_mutation_ack_unknown",status:0});
  assert.ok(api.readOrderMutationIntent("owner",store));
});

test("Refund ACK must preserve the exact sale group and amount",async()=>{
  const api=await load("refund-ack"),store=memoryStorage(),intent=api.prepareOrderMutationIntent("owner","refund",refundBody,undefined,store);
  for(const response of [{...refundAck(intent),saleIds:["s-2","s-3"]},{...refundAck(intent),refundAmount:56}]){
    await assert.rejects(api.sendOrderMutationIntent(intent,async()=>response,store),{message:"order_mutation_ack_unknown",status:0});
    assert.ok(api.readOrderMutationIntent("owner",store));
  }
});

test("authoritative pre-commit rejection clears intent while conflict and unknown retain it",async()=>{
  const api=await load("errors");
  for(const [message,status,retained] of [
    ["void_after_production_started",409,false],["refund_target_changed",409,false],["refund_closed_day",409,false],
    ["request_key_conflict",409,true],["server_error",500,true],["network_unavailable",0,true]
  ]){
    const operation=message.startsWith("void")?"void":"refund",body=operation==="void"?voidBody:refundBody,store=memoryStorage(),intent=api.prepareOrderMutationIntent("owner",operation,body,undefined,store);
    await assert.rejects(api.sendOrderMutationIntent(intent,async()=>{throw Object.assign(new Error(message),{status})},store));
    assert.equal(!!api.readOrderMutationIntent("owner",store),retained,message);
  }
});

test("unreadable order mutation recovery fails closed",async()=>{
  const api=await load("storage");
  const denied={getItem:()=>null,setItem:()=>{throw new Error("quota")},removeItem:()=>{}};
  assert.throws(()=>api.prepareOrderMutationIntent("owner","void",voidBody,undefined,denied),{message:"order_mutation_recovery_unavailable"});
  assert.throws(()=>api.readOrderMutationIntent("owner",{...denied,getItem:()=>"{broken"}),{message:"order_mutation_recovery_unavailable"});
});
