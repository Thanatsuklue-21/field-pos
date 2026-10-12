import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAiSupervisorSnapshot} from '../lib/domain/ai-supervisor.mjs';

test('AI supervisor elevates payment, cash and stock risks without mutating state',()=>{
  const doc={
    settings:{aiSupervisor:{expenseReviewThreshold:500}},
    ingredients:{matcha:{name:'Matcha',qty:0,unit:'g',minStock:20},milk:{name:'Milk',qty:10,unit:'g',minStock:30}},
    sales:[{date:'2026-10-13',status:'paid',total:100},{date:'2026-10-13',status:'refunded',total:20}],
    orders:[{date:'2026-10-13',status:'making'}],
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
