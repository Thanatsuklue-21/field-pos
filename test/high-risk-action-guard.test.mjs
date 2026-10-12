import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateHighRiskAction,validateHumanStockTransaction} from '../lib/domain/high-risk-action.mjs';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('refund and void require admin, reason and explicit confirmation',()=>{
  const admin={id:'owner',role:'admin'},staff={id:'staff',role:'staff'};
  assert.equal(evaluateHighRiskAction('REFUND',{user:staff,reason:'customer',confirmed:true}).code,'admin_required');
  assert.equal(evaluateHighRiskAction('REFUND',{user:admin,reason:'',confirmed:true}).code,'high_risk_reason_required');
  assert.equal(evaluateHighRiskAction('REFUND',{user:admin,reason:'customer',confirmed:false}).code,'high_risk_confirmation_required');
  assert.equal(evaluateHighRiskAction('VOID',{user:admin,reason:'wrong order',confirmed:true}).ok,true);
});

test('high value cash out requires explicit owner confirmation',()=>{
  const admin={id:'owner',role:'admin'};
  assert.equal(evaluateHighRiskAction('CASH_OUT',{user:admin,reason:'safe drop',amount:499,confirmed:false}).ok,true);
  assert.equal(evaluateHighRiskAction('CASH_OUT',{user:admin,reason:'safe drop',amount:500,confirmed:false}).code,'high_risk_confirmation_required');
  assert.equal(evaluateHighRiskAction('CASH_OUT',{user:admin,reason:'safe drop',amount:500,confirmed:true}).ok,true);
});

test('cycle count that changes balance is owner/admin only',()=>{
  assert.equal(evaluateHighRiskAction('CYCLE_COUNT_COMMIT',{user:{role:'staff'},confirmed:true}).code,'admin_required');
  assert.equal(evaluateHighRiskAction('CYCLE_COUNT_COMMIT',{user:{role:'admin'},confirmed:true}).ok,true);
});

test('generic human stock endpoint only accepts purchase and waste',()=>{
  for(const type of ['SALE','ADJUSTMENT','VOID_REVERSAL','REFUND_REVERSAL','OPENING_BALANCE']){
    assert.equal(validateHumanStockTransaction({user:{role:'admin'},body:{type,reason:'x'}}).code,'system_stock_transaction_type');
  }
  assert.equal(validateHumanStockTransaction({user:{role:'staff'},body:{type:'PURCHASE'}}).ok,true);
  assert.equal(validateHumanStockTransaction({user:{role:'staff'},body:{type:'WASTE',reason:'หก'}}).ok,true);
});

test('server and UI enforce high-risk guard contract',async()=>{
  const api=await read('lib/api.mjs'),orders=await read('app/orders/page.tsx'),close=await read('app/close/page.tsx'),stock=await read('app/stock/page.tsx');
  assert.match(api,/evaluateHighRiskAction\('REFUND'/);
  assert.match(api,/evaluateHighRiskAction\('VOID'/);
  assert.match(api,/evaluateHighRiskAction\('CASH_OUT'/);
  assert.match(api,/evaluateHighRiskAction\('CYCLE_COUNT_COMMIT'/);
  assert.match(orders,/riskConfirmed:true/);
  assert.match(close,/amount>=500/);
  assert.match(close,/riskConfirmed/);
  assert.match(stock,/นับสต๊อกจริง · Owner/);
});
