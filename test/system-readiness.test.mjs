import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSystemReadiness} from '../lib/domain/system-readiness.mjs';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

const goodDoc=()=>({
  ingredients:{matcha:{qty:1000,unit:'g'},milk:{qty:10000,unit:'g'}},
  menu:[{id:'m1',name:'Latte',enabled:true,variants:[{label:'100%',recipe:{items:{matcha:5,milk:110}}}]}],
  sales:[{id:'s1',date:'2026-10-13',status:'paid',total:55,payment:'cash',payments:[{method:'cash',amount:55}]}],
  orders:[{id:'o1',status:'returned',saleIds:['s1']}],
  paymentSessions:[],
  expenses:[],
  cashMovements:[],
  cashShifts:[{id:'shift1',date:'2026-10-13',status:'open',openingCash:500}],
  closes:[],
  cycleCountProposals:[]
});

test('system readiness is READY for clean operational state',()=>{
  const r=buildSystemReadiness({doc:goodDoc(),date:'2026-10-13',stockTransactions:[]});
  assert.equal(r.status,'READY');
  assert.equal(r.summary.blocked,0);
  assert.ok(r.score>=90);
});

test('system readiness blocks invalid stock, recipes, payments and accounting mismatches',()=>{
  const doc=goodDoc();
  doc.ingredients.matcha.qty=-1;
  doc.menu[0].variants[0].recipe.items.ghost=5;
  doc.paymentSessions.push({id:'p1',date:'2026-10-13',status:'collecting'});
  doc.sales[0].payments=[{method:'cash',amount:50}];
  const r=buildSystemReadiness({doc,date:'2026-10-13',stockTransactions:[]});
  assert.equal(r.status,'BLOCKED');
  for(const id of ['stock_balance','menu_recipe','payments','accounting']){
    assert.equal(r.checks.find(x=>x.id===id)?.status,'BLOCKED',id);
  }
  assert.ok(r.nextActions.some(x=>x.priority==='P0'));
});

test('system readiness warns on unfinished queue, no shift, owner approval and severe stock signal',()=>{
  const doc=goodDoc();
  doc.orders[0].status='making';
  doc.cashShifts=[];
  doc.cycleCountProposals=[{id:'cc1',date:'2026-10-13',status:'pending'}];
  const stockTransactions=[
    {id:'w1',ingredient_id:'matcha',tx_type:'SALE',qty_delta:-10,unit:'g',created_at:1},
    {id:'w2',ingredient_id:'matcha',tx_type:'WASTE',qty_delta:-10,unit:'g',reason:'spill',created_at:2}
  ];
  const r=buildSystemReadiness({doc,date:'2026-10-13',stockTransactions});
  assert.equal(r.status,'WARN');
  assert.equal(r.checks.find(x=>x.id==='queue')?.status,'WARN');
  assert.equal(r.checks.find(x=>x.id==='cash_shift')?.status,'WARN');
  assert.equal(r.checks.find(x=>x.id==='owner_approvals')?.status,'WARN');
});

test('control center exposes readiness checks and AI summary action',async()=>{
  const api=await read('lib/api.mjs'),ui=await read('app/control/page.tsx');
  assert.match(api,/buildSystemReadiness/);
  assert.match(api,/analysis\.readiness=readiness/);
  assert.match(ui,/System Readiness/);
  assert.match(ui,/ให้ AI สรุปความพร้อม/);
  assert.match(ui,/READY/);
  assert.match(ui,/BLOCKED/);
});
