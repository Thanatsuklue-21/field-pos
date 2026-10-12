import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAiControlSummary} from '../lib/domain/financial-control.mjs';
import {buildAiSupervisorSnapshot} from '../lib/domain/ai-supervisor.mjs';
import {filterAiSupervisorSnapshot} from '../lib/ai-supervisor-server.mjs';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('pending stock count proposals become P0 owner approvals',()=>{
  const doc={cycleCountProposals:[
    {id:'p1',date:'2026-10-13',status:'pending',submittedBy:'staff-1',submittedAt:100,adjustments:[{variance:-10}]},
    {id:'p2',date:'2026-10-12',status:'pending',submittedBy:'staff-2',submittedAt:90,adjustments:[{variance:5}]},
    {id:'p3',date:'2026-10-13',status:'approved',submittedBy:'staff-3',submittedAt:80,adjustments:[{variance:1}]}
  ],ingredients:{},sales:[],orders:[],paymentSessions:[],cashMovements:[]};
  const r=buildAiControlSummary({doc,date:'2026-10-13',auditRows:[],stockTransactions:[],now:200});
  assert.equal(r.metrics.pendingOwnerApprovals,1);
  assert.ok(r.signals.some(x=>x.code==='OWNER_APPROVAL_PENDING'&&x.level==='HIGH'));
  assert.ok(r.recommendations.some(x=>x.action==='REVIEW_OWNER_APPROVALS'&&x.priority==='P0'));
  assert.equal(r.evidence.pendingOwnerApprovals[0].id,'p1');
});

test('AI Supervisor shows owner approval only to admin, not staff',()=>{
  const doc={cycleCountProposals:[{id:'p1',date:'2026-10-13',status:'pending',submittedBy:'staff-1',submittedAt:100,adjustments:[{variance:-10}]}],ingredients:{},sales:[],orders:[],paymentSessions:[],cashMovements:[],expenses:[],closes:[],cashShifts:[]};
  const snapshot=buildAiSupervisorSnapshot({doc,audit:[],stockTransactions:[],date:'2026-10-13',now:200});
  assert.equal(snapshot.metrics.pendingOwnerApprovals,1);
  assert.ok(snapshot.alerts.some(x=>x.id==='owner-approval-pending'&&x.area==='approval'));
  const staff=filterAiSupervisorSnapshot(snapshot,{role:'staff',permissions:{stock:true,order:true,queue:true,report:true}});
  assert.equal(staff.alerts.some(x=>x.id==='owner-approval-pending'),false);
});

test('Control Center routes pending owner approvals to Stock',async()=>{
  const ui=await read('app/control/page.tsx');
  assert.match(ui,/REVIEW_OWNER_APPROVALS/);
  assert.match(ui,/รอ Owner อนุมัติ/);
  assert.match(ui,/pendingOwnerApprovals/);
});
