import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {shouldRetainExpensePending,validateExpenseAck,validatePendingExpense} from "../lib/expense-recovery.mjs";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("expense recovery validates exact durable request shape",()=>{
  const row={body:{requestKey:"expense-key-0001",date:"2026-10-11",amount:25,category:"OTHER",description:"parking",paymentMethod:"cash"},createdAt:1};
  assert.equal(validatePendingExpense(row),row);
  for(const bad of [
    null,
    {body:null,createdAt:1},
    {body:{requestKey:"x",date:"2026-10-11",amount:25,category:"OTHER",description:"",paymentMethod:"cash"},createdAt:1},
    {body:{requestKey:"expense-key-0001",date:"bad-date",amount:25,category:"OTHER",description:"",paymentMethod:"cash"},createdAt:1},
    {body:{requestKey:"expense-key-0001",date:"2026-10-11",amount:0,category:"OTHER",description:"",paymentMethod:"cash"},createdAt:1},
    {body:{requestKey:"expense-key-0001",date:"2026-10-11",amount:25,category:"",description:"",paymentMethod:"cash"},createdAt:1},
    {body:{requestKey:"expense-key-0001",date:"2026-10-11",amount:25,category:"OTHER",description:1,paymentMethod:"cash"},createdAt:1},
    {body:{requestKey:"expense-key-0001",date:"2026-10-11",amount:25,category:"OTHER",description:"",paymentMethod:""},createdAt:1},
    {body:{requestKey:"expense-key-0001",date:"2026-10-11",amount:25,category:"OTHER",description:"",paymentMethod:"cash"},createdAt:0}
  ]) assert.throws(()=>validatePendingExpense(bad),/expense_recovery_corrupt/);
});

test("expense pending is retained only for ambiguous transport/server outcomes",()=>{
  for(const error of [
    Object.assign(new Error("network"),{status:0}),
    Object.assign(new Error("timeout"),{status:408}),
    Object.assign(new Error("too_early"),{status:425}),
    Object.assign(new Error("rate"),{status:429}),
    Object.assign(new Error("server"),{status:503})
  ]) assert.equal(shouldRetainExpensePending(error),true);
  for(const status of [400,401,403,404,409,422]){
    assert.equal(shouldRetainExpensePending(Object.assign(new Error("rejected"),{status})),false);
  }
});

test("expense recovery clears only after exact server acknowledgement",()=>{
  const body={requestKey:"expense-ack-0001",date:"2026-10-11",amount:35,category:"UTILITY",description:"water",paymentMethod:"cash"};
  const good={ok:true,expense:{...body,id:"exp-1"}};
  assert.equal(validateExpenseAck(good,body),good);
  for(const bad of [
    null,
    {},
    {ok:false,expense:{...body,id:"exp-1"}},
    {ok:true,expense:{...body,id:"exp-1",requestKey:"other"}},
    {ok:true,expense:{...body,id:"exp-1",date:"2026-10-12"}},
    {ok:true,expense:{...body,id:"exp-1",amount:36}},
    {ok:true,expense:{...body,id:"exp-1",category:"OTHER"}},
    {ok:true,expense:{...body,id:"exp-1",description:"other"}},
    {ok:true,expense:{...body,id:"exp-1",paymentMethod:"bank"}}
  ]) assert.throws(()=>validateExpenseAck(bad,body),/expense_unconfirmed/);
});

test("shared expense client persists exact Bangkok-dated request before send and Expenses replays it on reconnect",async()=>{
  const ui=await read("app/expenses/page.tsx");
  const client=await read("lib/expense-client.ts");
  assert.match(client,/timeZone:"Asia\/Bangkok"/);
  assert.match(ui,/requestKey:crypto\.randomUUID\(\),date:currentBusinessDate\(\)/);
  assert.match(ui,/description:description\.trim\(\)\.slice\(0,240\)/);
  assert.match(client,/writePendingExpense\(body\)/);
  assert.match(client,/body:JSON\.stringify\(pending\.body\)/);
  assert.ok(client.indexOf("writePendingExpense(body)")<client.indexOf("api<any>(\"/api/expenses\""));
  assert.ok(client.indexOf("validateExpenseAck(response,pending.body)")<client.indexOf("clearPendingExpense()"));
  assert.match(ui,/window\.addEventListener\("online",onOnline\)/);
  assert.match(ui,/window\.addEventListener\("focus",onFocus\)/);
  assert.match(ui,/document\.addEventListener\("visibilitychange",onVisible\)/);
  assert.match(ui,/expenseRecoveryRef/);
  assert.match(ui,/sendExpenseDurably\(session\.csrf,pending\.body\)/);
});

test("expense backend replays same request key before closed-day rejection and rejects conflicting reuse",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("if(path==='/api/expenses'&&method==='POST')");
  const end=api.indexOf("const expenseMatch=path.match",start);
  const block=api.slice(start,end);
  assert.match(block,/requestKey=String\(b\.requestKey\|\|''\)/);
  assert.match(block,/doc\.expenses\.find\(x=>String\(x\.requestKey\|\|''\)===requestKey\)/);
  assert.ok(block.indexOf("const replay=doc.expenses.find")<block.indexOf("day_closed"));
  assert.match(block,/request_key_conflict/);
  assert.match(block,/requestKey,date,time:now/);
  assert.match(block,/replayed:true/);
});
