import test from 'node:test';
import assert from 'node:assert/strict';
import {buildStockIntegritySummary} from '../lib/domain/stock-integrity.mjs';
import {buildAiSupervisorSnapshot} from '../lib/domain/ai-supervisor.mjs';
import {filterAiSupervisorSnapshot} from '../lib/ai-supervisor-server.mjs';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('repeated manual stock adjustments become a review signal without mutating ledger',()=>{
  const tx=[
    {id:'a1',ingredient_id:'matcha',tx_type:'ADJUSTMENT',qty_delta:-2,unit:'g',reason:'count',actor_id:'u1'},
    {id:'a2',ingredient_id:'matcha',tx_type:'ADJUSTMENT',qty_delta:-1,unit:'g',reason:'count',actor_id:'u1'},
    {id:'a3',ingredient_id:'matcha',tx_type:'ADJUSTMENT',qty_delta:1,unit:'g',reason:'count',actor_id:'u1'}
  ];
  const before=structuredClone(tx);
  const r=buildStockIntegritySummary({transactions:tx,ingredients:{matcha:{name:'Matcha',unit:'g'}}});
  assert.ok(r.signals.some(x=>x.code==='REPEATED_STOCK_ADJUSTMENT'&&x.level==='HIGH'));
  assert.ok(r.signals.some(x=>x.code==='REPEATED_MANUAL_STOCK_BY_ACTOR'));
  assert.equal(r.metrics.adjustments,3);
  assert.deepEqual(tx,before);
});

test('manual adjustment without reason is always reviewable',()=>{
  const r=buildStockIntegritySummary({transactions:[{id:'a1',ingredient_id:'milk',tx_type:'ADJUSTMENT',qty_delta:-50,unit:'g',reason:''}]});
  assert.ok(r.signals.some(x=>x.code==='STOCK_ADJUSTMENT_MISSING_REASON'));
  assert.equal(r.metrics.missingAdjustmentReasons,1);
});

test('high waste ratio is detected only after meaningful sale usage',()=>{
  const high=buildStockIntegritySummary({transactions:[
    {ingredient_id:'matcha',tx_type:'SALE',qty_delta:-100,unit:'g'},
    {ingredient_id:'matcha',tx_type:'WASTE',qty_delta:-30,unit:'g'}
  ],ingredients:{matcha:{name:'Matcha'}}});
  assert.ok(high.signals.some(x=>x.code==='HIGH_WASTE_RATIO'));
  const small=buildStockIntegritySummary({transactions:[
    {ingredient_id:'matcha',tx_type:'SALE',qty_delta:-10,unit:'g'},
    {ingredient_id:'matcha',tx_type:'WASTE',qty_delta:-4,unit:'g'}
  ],ingredients:{matcha:{name:'Matcha'}}});
  assert.equal(small.signals.some(x=>x.code==='HIGH_WASTE_RATIO'),false);
});

test('normal sale and small waste pattern stays quiet',()=>{
  const r=buildStockIntegritySummary({transactions:[
    {ingredient_id:'milk',tx_type:'SALE',qty_delta:-1000,unit:'g'},
    {ingredient_id:'milk',tx_type:'WASTE',qty_delta:-20,unit:'g'},
    {ingredient_id:'milk',tx_type:'VOID_REVERSAL',qty_delta:100,unit:'g',reason:'customer cancel'}
  ]});
  assert.equal(r.signals.length,0);
});

test('AI supervisor exposes aggregate stock integrity but staff evidence is redacted',()=>{
  const stockTransactions=[
    {id:'a1',ingredient_id:'matcha',tx_type:'ADJUSTMENT',qty_delta:-2,reason:'count',actor_id:'employee'},
    {id:'a2',ingredient_id:'matcha',tx_type:'ADJUSTMENT',qty_delta:-2,reason:'count',actor_id:'employee'},
    {id:'a3',ingredient_id:'matcha',tx_type:'ADJUSTMENT',qty_delta:-2,reason:'count',actor_id:'employee'}
  ];
  const snap=buildAiSupervisorSnapshot({doc:{ingredients:{matcha:{name:'Matcha',qty:100}}},audit:[],stockTransactions,date:'2026-10-13',now:1});
  assert.equal(snap.metrics.stockAdjustments,3);
  assert.ok(snap.alerts.some(x=>x.id==='ledger-stock-adjustment-pattern'));
  assert.ok(snap.stockIntegrityEvidence.length>0);
  const filtered=filterAiSupervisorSnapshot(snap,{role:'staff',permissions:{stock:true,order:false,queue:false,report:false}});
  assert.equal(filtered.metrics.stockAdjustments,3);
  assert.deepEqual(filtered.stockIntegrityEvidence,[]);
  assert.ok(filtered.alerts.some(x=>x.area==='stock'));
});

test('server analysis queries today stock ledger and control center renders stock evidence',async()=>{
  const server=await read('lib/ai-supervisor-server.mjs'),api=await read('lib/api.mjs'),ui=await read('app/control/page.tsx');
  assert.match(server,/FROM field_stock_transactions WHERE created_at>=\? AND created_at<\?/);
  assert.match(api,/stockTransactions:stock\.rows/);
  assert.match(ui,/Stock Adjust/);
  assert.match(ui,/Waste/);
  assert.match(ui,/stockIntegrity/);
});
