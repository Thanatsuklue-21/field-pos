import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAiSupervisorSnapshot} from '../lib/domain/ai-supervisor.mjs';
import {filterAiSupervisorSnapshot} from '../lib/ai-supervisor-server.mjs';

test('AI supervisor elevates payment, cash and stock risks without mutating state',()=>{
  const doc={
    settings:{aiSupervisor:{expenseReviewThreshold:500}},
    ingredients:{matcha:{name:'Matcha',qty:0,unit:'g',minStock:20},milk:{name:'Milk',qty:10,unit:'g',minStock:30}},
    sales:[{id:'s1',date:'2026-10-13',status:'paid',total:100},{id:'s2',date:'2026-10-13',status:'refunded',total:20}],
    orders:[{saleId:'s1',status:'making'}],
    expenses:[{date:'2026-10-13',amount:700}],
    paymentSessions:[{status:'pending'}],
    closes:[{date:'2026-10-13',cashVariance:-80}],
    cashShifts:[{date:'2026-10-13',status:'closed'}]
  };
  const before=structuredClone(doc);
  const s=buildAiSupervisorSnapshot({doc,audit:[{action:'refund_sale',actor_id:'u1',created_at:1}],date:'2026-10-13',now:2});
  assert.equal(s.health,'critical');
  assert.equal(s.metrics.pendingPayments,1);
  assert.equal(s.metrics.outOfStock,1);
  assert.equal(s.metrics.lowStock,1);
  assert.ok(s.alerts.some(x=>x.id==='cash-variance'));
  assert.ok(s.alerts.some(x=>x.id==='payment-pending'));
  assert.ok(s.alerts.some(x=>x.id==='expense-high'));
  assert.deepEqual(doc,before);
  assert.ok(s.policy.approval.includes('refund'));
  assert.ok(s.policy.never.includes('mark_unverified_payment_paid'));
});

test('AI supervisor stays quiet when core state is healthy',()=>{
  const doc={ingredients:{matcha:{name:'Matcha',qty:100,unit:'g',minStock:20}},sales:[],orders:[],expenses:[],closes:[],cashShifts:[]};
  const s=buildAiSupervisorSnapshot({doc,audit:[],date:'2026-10-13',now:1});
  assert.equal(s.health,'ok');
  assert.equal(s.alerts.length,0);
});


test('AI supervisor redacts financial and audit data for staff without report permission',()=>{
  const snapshot={health:'critical',topSeverity:'critical',alerts:[
    {id:'cash-variance',severity:'critical',area:'money',title:'cash',detail:'secret',href:'/close'},
    {id:'payment-pending',severity:'critical',area:'money',title:'payment',detail:'pending',href:'/pos'},
    {id:'stock-low',severity:'medium',area:'stock',title:'stock',detail:'low',href:'/stock'}
  ],metrics:{revenue:999,refundAmount:50,orders:2,openOrders:1,expenses:100,pendingPayments:1,outOfStock:0,lowStock:1,cashVariance:-20},auditSignals:[{action:'refund_sale',actorId:'employee-1',createdAt:1}],policy:{auto:[],approval:[],never:[]}};
  const filtered=filterAiSupervisorSnapshot(snapshot,{role:'staff',permissions:{order:true,stock:true,report:false,queue:false}});
  assert.equal(filtered.metrics.revenue,0);assert.equal(filtered.metrics.cashVariance,0);
  assert.equal(filtered.metrics.pendingPayments,1);assert.equal(filtered.metrics.lowStock,1);
  assert.deepEqual(filtered.auditSignals,[]);
  assert.equal(filtered.alerts.some(x=>x.id==='cash-variance'),false);
  assert.equal(filtered.alerts.some(x=>x.id==='payment-pending'),true);
});


test('global AI supervisor is mounted and financial actions remain human-approved',async()=>{
  const {readFile}=await import('node:fs/promises');
  const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
  const shell=await read('components/app-shell.tsx');
  const ui=await read('components/ai-supervisor.tsx');
  const server=await read('lib/ai-supervisor-server.mjs');
  assert.match(shell,/AiSupervisor session=\{session\}/);
  assert.match(ui,/เงินออก Refund Void Stock Adjustment และ Close Day ต้องยืนยันโดยคน/);
  assert.match(server,/\['navigate','refresh'\]/);
  assert.match(server,/gpt-6-luna/);
  assert.match(server,/gpt-6-sol/);
});

test('pending payment risk is scoped to the selected business date and includes resolution-required sessions',()=>{
  const doc={paymentSessions:[
    {id:'today',date:'2026-10-13',status:'requires_resolution'},
    {id:'old',date:'2026-10-12',status:'collecting'}
  ],ingredients:{},sales:[],orders:[],expenses:[],closes:[],cashShifts:[]};
  const s=buildAiSupervisorSnapshot({doc,audit:[],date:'2026-10-13',now:1});
  assert.equal(s.metrics.pendingPayments,1);
  assert.equal(s.alerts.some(x=>x.id==='payment-pending'),true);
});
