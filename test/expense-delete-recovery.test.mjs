import test from "node:test";
import assert from "node:assert/strict";
import {loadBrowserModule,memoryStorage} from "./helpers/load-browser-module.mjs";

const body={requestKey:"expense-delete-test-0001",expenseId:"exp-1",date:"2026-10-13",expectedAmount:30};
const load=id=>loadBrowserModule("lib/expense-delete-recovery.ts",{id});
const ack=intent=>({ok:true,deleted:true,requestKey:intent.body.requestKey,expenseId:intent.body.expenseId,date:intent.body.date,amount:intent.body.expectedAmount,deletedBy:intent.actorId});

test("expense delete intent persists before send and survives lost response/reload",async()=>{
  const first=await load("first"),store=memoryStorage(),intent=first.prepareExpenseDeleteIntent("owner",body,store);
  let sends=0;
  await assert.rejects(first.sendExpenseDeleteIntent(intent,async sent=>{
    sends++;assert.deepEqual(sent,body);assert.deepEqual(first.readExpenseDeleteIntent("owner",store),intent);
    throw Object.assign(new Error("network_unavailable"),{status:0});
  },store));
  assert.deepEqual(first.readExpenseDeleteIntent("owner",store),intent);

  const reload=await load("reload"),restored=reload.readExpenseDeleteIntent("owner",store);
  const result=await reload.sendExpenseDeleteIntent(restored,async sent=>{sends++;assert.deepEqual(sent,body);return {...ack(restored),replayed:true}},store);
  assert.equal(result.replayed,true);assert.equal(sends,2);assert.equal(reload.readExpenseDeleteIntent("owner",store),null);
});

test("unresolved delete cannot target another expense amount or request key",async()=>{
  const api=await load("locked"),store=memoryStorage(),original=api.prepareExpenseDeleteIntent("owner",body,store);
  for(const changed of [
    {...body,requestKey:"expense-delete-test-0002"},
    {...body,expenseId:"exp-2"},
    {...body,expectedAmount:31}
  ]){
    assert.throws(()=>api.prepareExpenseDeleteIntent("owner",changed,store),{message:"pending_expense_delete_exists"});
    assert.deepEqual(api.readExpenseDeleteIntent("owner",store),original);
  }
});

for(const scenario of ["empty","wrong-key","wrong-id","wrong-date","wrong-amount","wrong-actor"])test("inexact expense delete ACK "+scenario+" retains recovery",async()=>{
  const api=await load(scenario),store=memoryStorage(),intent=api.prepareExpenseDeleteIntent("owner",body,store);
  const response=ack(intent);
  if(scenario==="empty")response.deleted=false;
  if(scenario==="wrong-key")response.requestKey="other-key";
  if(scenario==="wrong-id")response.expenseId="exp-2";
  if(scenario==="wrong-date")response.date="2026-10-12";
  if(scenario==="wrong-amount")response.amount=31;
  if(scenario==="wrong-actor")response.deletedBy="other";
  await assert.rejects(api.sendExpenseDeleteIntent(intent,async()=>response,store),{message:"expense_delete_ack_unknown",status:0});
  assert.deepEqual(api.readExpenseDeleteIntent("owner",store),intent);
});

test("explicit pre-commit delete rejection releases intent while conflict and unknown retain it",async()=>{
  const api=await load("errors");
  for(const [message,status,retained] of [
    ["expense_not_found",404,false],["expense_target_changed",409,false],["day_closed",409,false],["system_expense_read_only",409,false],
    ["request_key_conflict",409,true],["server_error",500,true],["network_unavailable",0,true]
  ]){
    const store=memoryStorage(),intent=api.prepareExpenseDeleteIntent("owner",body,store);
    await assert.rejects(api.sendExpenseDeleteIntent(intent,async()=>{throw Object.assign(new Error(message),{status})},store));
    assert.equal(!!api.readExpenseDeleteIntent("owner",store),retained,message);
  }
});

test("expense delete storage failure blocks send and corrupt data is never empty",async()=>{
  const api=await load("storage");
  const denied={getItem:()=>null,setItem:()=>{throw new Error("quota")},removeItem:()=>{}};
  assert.throws(()=>api.prepareExpenseDeleteIntent("owner",body,denied),{message:"expense_delete_recovery_unavailable"});
  assert.throws(()=>api.readExpenseDeleteIntent("owner",{...denied,getItem:()=>"{broken"}),{message:"expense_delete_recovery_unavailable"});
});
