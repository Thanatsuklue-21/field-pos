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


test('AI supervisor reuses Financial Control source for large cash movements',()=>{
  const doc={
    ingredients:{},
    sales:[],
    orders:[],
    expenses:[],
    closes:[],
    cashShifts:[],
    paymentSessions:[],
    cashMovements:[{id:'mv1',date:'2026-10-13',type:'CASH_OUT',amount:800,reason:'owner withdrawal'}]
  };
  const snapshot=buildAiSupervisorSnapshot({doc,audit:[],date:'2026-10-13',now:1});
  assert.ok(snapshot.alerts.some(x=>x.id==='large-cash-movement'));
});

test('Control Center can open the global AI Supervisor for focused analysis',async()=>{
  const {readFile}=await import('node:fs/promises');
  const ui=await readFile(new URL('../app/control/page.tsx',import.meta.url),'utf8');
  assert.match(ui,/field:ai-ask/);
  assert.match(ui,/ตรวจเงินกับ AI/);
  assert.match(ui,/ตรวจสต๊อก\/Flow/);
});


test('AI supervisor navigation is permission-aware and never sends staff into admin-only pages',()=>{
  const snapshot={
    health:'review',topSeverity:'high',
    alerts:[
      {id:'stock-adjust-pattern',severity:'high',area:'stock',title:'stock',detail:'adjustments',href:'/audit'},
      {id:'refund-void-pattern',severity:'high',area:'money',title:'refund',detail:'pattern',href:'/audit'}
    ],
    metrics:{revenue:0,refundAmount:0,orders:1,openOrders:0,expenses:0,pendingPayments:0,outOfStock:0,lowStock:1,cashVariance:0,stockAdjustments:3,wasteEvents:0,highWasteIngredients:0,voidReversals:0},
    auditSignals:[],stockIntegrityEvidence:[],
    policy:{auto:['navigate'],approval:[],never:[]}
  };
  const staff=filterAiSupervisorSnapshot(snapshot,{role:'staff',permissions:{order:true,stock:true,report:true,queue:false}});
  assert.equal(staff.alerts.find(x=>x.id==='stock-adjust-pattern')?.href,'/stock');
  assert.equal(staff.alerts.find(x=>x.id==='refund-void-pattern')?.href,'/orders');
  assert.ok(staff.policy.navigationHrefs.includes('/stock'));
  assert.ok(staff.policy.navigationHrefs.includes('/orders'));
  assert.equal(staff.policy.navigationHrefs.includes('/audit'),false);
  assert.equal(staff.policy.navigationHrefs.includes('/costs'),false);
});

test('AI supervisor admin navigation keeps full diagnostic destinations',()=>{
  const snapshot={health:'ok',topSeverity:'info',alerts:[],metrics:{},auditSignals:[],stockIntegrityEvidence:[],policy:{auto:['navigate'],approval:[],never:[]}};
  const admin=filterAiSupervisorSnapshot(snapshot,{role:'admin',permissions:{}});
  for(const href of ['/pos','/queue','/stock','/expenses','/close','/orders','/reports','/audit','/costs','/settings']){
    assert.ok(admin.policy.navigationHrefs.includes(href),href);
  }
});

test('AI model actions are filtered against the permission-scoped navigation list',async()=>{
  const {readFile}=await import('node:fs/promises');
  const server=await readFile(new URL('../lib/ai-supervisor-server.mjs',import.meta.url),'utf8');
  assert.match(server,/navigationHrefs=aiNavigationHrefs\(user\)/);
  assert.match(server,/safeAlertHref\(a,user,navigationSet\)/);
  assert.match(server,/allowedNavigation=new Set\(Array\.isArray\(snapshot\?\.policy\?\.navigationHrefs\)/);
  assert.match(server,/a\.type==='navigate'&&allowedNavigation\.has\(a\.href\)/);
  assert.doesNotMatch(server,/ALLOWED_HREFS/);
});


test('POS can lazy-mount AI supervisor and replay the explicit request that triggered it',async()=>{
  const {readFile}=await import('node:fs/promises');
  const shell=await readFile(new URL('../components/app-shell.tsx',import.meta.url),'utf8');
  const ui=await readFile(new URL('../components/ai-supervisor.tsx',import.meta.url),'utf8');
  assert.match(shell,/setAiRequest\(\{id:Date\.now\(\),message\}\)/);
  assert.match(shell,/setAiMounted\(true\)/);
  assert.match(ui,/setOpen\(true\)/);
  assert.match(ui,/setMessage\(initialRequest\.message\)/);
  assert.match(ui,/ask\(initialRequest\.message\)/);
});
