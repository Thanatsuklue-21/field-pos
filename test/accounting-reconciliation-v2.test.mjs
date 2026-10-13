import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildAccountingReconciliation} from '../lib/domain/accounting-reconciliation.mjs';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('reconciliation passes when paid sales equal payment totals',()=>{
  const doc={sales:[
    {id:'s1',date:'2026-10-13',status:'paid',total:80,payment:'cash',payments:[{method:'cash',amount:80}]},
    {id:'s2',date:'2026-10-13',status:'paid',total:120,payment:'split',payments:[{method:'cash',amount:50},{method:'promptpay',amount:70}]}
  ],expenses:[{id:'e1',date:'2026-10-13',amount:30,category:'UTILITY',paymentMethod:'cash'}],cashMovements:[{id:'m1',date:'2026-10-13',type:'CASH_IN',amount:100,reason:'เพิ่มเงินทอน'}]};
  const r=buildAccountingReconciliation({doc,date:'2026-10-13'});
  assert.equal(r.ok,true);assert.equal(r.level,'OK');assert.equal(r.totals.revenue,200);assert.equal(r.totals.paymentSum,200);assert.equal(r.totals.paymentTotals.cash,130);assert.equal(r.totals.paymentTotals.promptpay,70);
});

test('reconciliation blocks sale/payment mismatch',()=>{
  const doc={sales:[{id:'s1',date:'2026-10-13',status:'paid',total:80,payments:[{method:'cash',amount:60}]}]};
  const r=buildAccountingReconciliation({doc,date:'2026-10-13'});
  assert.equal(r.ok,false);assert.equal(r.level,'CRITICAL');assert.ok(r.blocking.some(x=>x.code==='SALE_PAYMENT_TOTAL_MISMATCH'));assert.ok(r.blocking.some(x=>x.code==='DAY_SALES_PAYMENT_MISMATCH'));
});

test('reconciliation detects refund, expense, drawer and duplicate integrity issues',()=>{
  const doc={
    sales:[{id:'r1',date:'2026-10-13',status:'refunded',total:100,refundAmount:50}],
    expenses:[{id:'e1',date:'2026-10-13',amount:20,category:'',paymentMethod:''},{id:'e1',date:'2026-10-13',amount:-1,category:'X',paymentMethod:'cash'}],
    cashMovements:[{id:'m1',date:'2026-10-13',type:'BAD',amount:0,reason:''}]
  };
  const r=buildAccountingReconciliation({doc,date:'2026-10-13'});
  assert.equal(r.ok,false);
  for(const code of ['REFUND_TOTAL_MISMATCH','REFUND_METHOD_MISSING','DUPLICATE_EXPENSE_ID'])assert.ok(r.findings.some(x=>x.code===code),code);
});

test('close-day review and final close are both server-gated by accounting reconciliation',async()=>{
  const api=await read('lib/api.mjs'),control=await read('app/control/page.tsx');
  const review=api.indexOf("if(path==='/api/close-day/review'");
  const close=api.indexOf("if(path==='/api/close-day'&&method==='POST')");
  assert.ok(review>0&&close>review);
  assert.match(api.slice(review,close),/buildAccountingReconciliation/);
  assert.match(api.slice(review,close),/accounting_reconciliation_failed/);
  assert.match(api.slice(close),/buildAccountingReconciliation/);
  assert.match(control,/Accounting Reconciliation/);
  assert.match(control,/RECONCILED/);
  assert.match(control,/FAILED/);
});
