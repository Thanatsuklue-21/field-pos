import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCashCloseReview,buildAiControlSummary,validateCloseReview,classifyCashVariance,CASH_CONTROL_POLICY} from '../lib/domain/financial-control.mjs';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('blind recount mismatch blocks before expected cash is exposed',()=>{
  const r=buildCashCloseReview({openingCash:500,cashSales:1000,firstCount:1450,secondCount:1460});
  assert.equal(r.ok,false);
  assert.equal(r.code,'cash_recount_mismatch');
  assert.equal('expectedCash' in r,false);
});

test('matching recount returns expected cash and risk',()=>{
  const r=buildCashCloseReview({openingCash:500,cashSales:1000,cashIn:100,cashPaidOut:50,cashOut:100,firstCount:1450,secondCount:1450});
  assert.equal(r.ok,true);
  assert.equal(r.expectedCash,1450);
  assert.equal(r.variance,0);
  assert.equal(r.level,'OK');
  assert.equal(r.reasonRequired,false);
});

test('cash variance thresholds require owner confirmation from 100 baht',()=>{
  assert.equal(classifyCashVariance(-10),'LOW');
  assert.equal(classifyCashVariance(-20),'MEDIUM');
  assert.equal(classifyCashVariance(-100),'HIGH');
  assert.equal(classifyCashVariance(-500),'CRITICAL');
  const r=buildCashCloseReview({openingCash:500,cashSales:1000,firstCount:1300,secondCount:1300});
  assert.equal(r.variance,-200);
  assert.equal(r.reasonRequired,true);
  assert.equal(r.ownerConfirmRequired,true);
});

test('close review expires and becomes stale when expected cash changes',()=>{
  const base={id:'r1',status:'ready',date:'2026-10-13',createdAt:1000,countedCash:1000,expectedCash:1000,variance:0};
  assert.equal(validateCloseReview({review:base,date:'2026-10-13',countedCash:1000,expectedCash:1000,variance:0,now:1000+CASH_CONTROL_POLICY.reviewTtlMs-1}).ok,true);
  assert.equal(validateCloseReview({review:base,date:'2026-10-13',countedCash:1000,expectedCash:1000,variance:0,now:1000+CASH_CONTROL_POLICY.reviewTtlMs+1}).code,'close_day_review_expired');
  assert.equal(validateCloseReview({review:base,date:'2026-10-13',countedCash:1000,expectedCash:1100,variance:-100,now:2000}).code,'close_day_review_stale');
});

test('AI control summary prioritizes pending money and open orders',()=>{
  const doc={
    ingredients:{milk:{name:'Milk',qty:20,safetyStock:100,unit:'g'}},
    sales:[{id:'s1',date:'2026-10-13',status:'paid'}],
    orders:[{id:'o1',status:'making',saleIds:['s1']}],
    paymentSessions:[{id:'p1',date:'2026-10-13',status:'collecting'}],
    cashMovements:[{id:'c1',date:'2026-10-13',type:'CASH_OUT',amount:800,reason:'safe drop'}]
  };
  const r=buildAiControlSummary({doc,date:'2026-10-13',auditRows:[]});
  assert.equal(r.level,'CRITICAL');
  assert.equal(r.metrics.pendingPayments,1);
  assert.equal(r.metrics.openOrders,1);
  assert.equal(r.metrics.lowStock,1);
  assert.equal(r.recommendations[0].priority,'P0');
});

test('API and close UI enforce the reviewed close-day path',async()=>{
  const api=await read('lib/api.mjs');
  const control=await read('lib/domain/financial-control.mjs');
  const close=await read('app/close/page.tsx');
  const shell=await read('components/app-shell.tsx');
  assert.match(api,/\/api\/control-center/);
  assert.match(api,/\/api\/close-day\/review/);
  assert.match(api,/validateCloseReview/);
  assert.match(control,/close_day_review_stale/);
  assert.match(api,/cash_variance_reason_required/);
  assert.match(api,/cash_variance_owner_confirmation_required/);
  assert.match(api,/ownerConfirmRequired:assessment\.ownerConfirmRequired/);
  assert.match(close,/นับเงินสด 2 รอบโดยไม่ดูยอดระบบ/);
  assert.match(close,/ตรวจยอดก่อนปิดวัน/);
  assert.match(close,/reviewId:review\.id/);
  assert.match(shell,/\/control/);
});
