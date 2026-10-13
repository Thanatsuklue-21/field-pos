import test from 'node:test';
import assert from 'node:assert/strict';
import {loadBrowserModule,memoryStorage} from './helpers/load-browser-module.mjs';
const body={requestKey:'expense:test-0001',date:'2026-10-13',amount:30,category:'OTHER',description:'parking',paymentMethod:'cash',riskConfirmed:false};
const load=id=>loadBrowserModule('lib/expense-recovery.ts',{id});
const ack=intent=>({ok:true,expense:{id:'exp-1',createdBy:intent.actorId,...intent.body}});

test('expense identity is persisted before send and survives reload/lost response',async()=>{
  const first=await load('first'),store=memoryStorage();
  const intent=first.prepareExpenseIntent('owner',body,store);
  let sends=0;
  await assert.rejects(first.sendExpenseIntent(intent,async sent=>{
    assert.deepEqual(first.readExpenseIntent('owner',store).body,sent);
    sends++;
    throw Object.assign(new Error('network_unavailable'),{status:0});
  },store));
  const reload=await load('reload'),restored=reload.readExpenseIntent('owner',store);
  assert.deepEqual(restored,intent);
  const result=await reload.sendExpenseIntent(restored,async sent=>{sends++;assert.deepEqual(sent,body);return {...ack(restored),replayed:true}},store);
  assert.equal(result.replayed,true);
  assert.equal(sends,2);
  assert.equal(reload.readExpenseIntent('owner',store),null);
});

test('unresolved expense cannot be replaced with a new key or changed amount',async()=>{
  const api=await load('locked'),store=memoryStorage();
  const original=api.prepareExpenseIntent('owner',body,store);
  for(const changed of [{...body,requestKey:'expense:test-0002'},{...body,amount:31}]){
    assert.throws(()=>api.prepareExpenseIntent('owner',changed,store),{message:'pending_expense_exists'});
    assert.deepEqual(api.readExpenseIntent('owner',store),original);
  }
});

for(const scenario of ['empty','wrong-key','wrong-amount','wrong-actor'])test('inexact ACK '+scenario+' preserves recovery identity',async()=>{
  const api=await load(scenario),store=memoryStorage(),intent=api.prepareExpenseIntent('owner',body,store);
  const response=ack(intent);
  if(scenario==='empty')delete response.expense;
  if(scenario==='wrong-key')response.expense.requestKey='other-key';
  if(scenario==='wrong-amount')response.expense.amount=31;
  if(scenario==='wrong-actor')response.expense.createdBy='other-user';
  await assert.rejects(api.sendExpenseIntent(intent,async()=>response,store),{message:'expense_ack_unknown',status:0});
  assert.deepEqual(api.readExpenseIntent('owner',store),intent);
});

test('storage failure blocks send; corrupt data never becomes an empty queue',async()=>{
  const api=await load('storage');
  const denied={getItem:()=>null,setItem:()=>{throw new Error('quota')},removeItem:()=>{}};
  assert.throws(()=>api.prepareExpenseIntent('owner',body,denied),{message:'expense_recovery_unavailable'});
  assert.throws(()=>api.readExpenseIntent('owner',{...denied,getItem:()=>'{broken'}),{message:'expense_recovery_unavailable'});
});

test('server validation rejection releases editing but conflict and unknown errors retain identity',async()=>{
  const api=await load('rejected');
  for(const [message,status,retained] of [['drawer_cash_shortage',409,false],['day_closed',409,false],['request_key_conflict',409,true],['server_error',500,true],['network_unavailable',0,true]]){
    const store=memoryStorage(),intent=api.prepareExpenseIntent('owner',body,store);
    await assert.rejects(api.sendExpenseIntent(intent,async()=>{throw Object.assign(new Error(message),{status})},store));
    assert.equal(!!api.readExpenseIntent('owner',store),retained);
  }
});

test('expense recovery is isolated by actor',async()=>{
  const api=await load('actors'),store=memoryStorage();
  api.prepareExpenseIntent('owner',body,store);
  assert.equal(api.readExpenseIntent('staff',store),null);
});
