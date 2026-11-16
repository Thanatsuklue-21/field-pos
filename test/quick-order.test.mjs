import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {moveOneUnitToVariant,quickAddVariant,shortVariantLabel} from '../lib/domain/quick-order.mjs';

const sweet=[{label:'100%',available:true},{label:'50%',available:true},{label:'0%',available:true}];

test('menu tap adds the normal-sweetness recipe directly',()=>{
  assert.equal(quickAddVariant(sweet).label,'100%');
  assert.equal(quickAddVariant([{label:'หวานน้อย'},{label:'หวานปกติ'}]).label,'หวานปกติ');
  assert.equal(quickAddVariant([{label:'Standard'},{label:'Extra shot'}]).label,'Standard');
});

test('size variants or an unavailable default still open the picker',()=>{
  assert.equal(quickAddVariant([{label:'S'},{label:'M'},{label:'L'}]),null);
  assert.equal(quickAddVariant([{label:'100%',available:false},{label:'50%',available:true}]),null);
  assert.equal(quickAddVariant([]),null);
  assert.equal(quickAddVariant([{label:'only',available:false}]),null);
});

test('short chip labels stay readable Thai',()=>{
  assert.deepEqual(['100%','50%','0%','Standard','L'].map(shortVariantLabel),['หวานปกติ','หวานน้อย','ไม่หวาน','มาตรฐาน','L']);
});

const line=(variant,qty)=>({key:'tea::'+variant,id:'tea',name:'ชาไทย',variant,price:55,qty});

test('changing sweetness moves exactly one cup and keeps total quantity and price',()=>{
  const items=[line('100%',2),{key:'latte::100%',id:'latte',name:'Latte',variant:'100%',price:60,qty:1}];
  const moved=moveOneUnitToVariant(items,'tea::100%','50%');
  assert.deepEqual(moved.map(i=>[i.key,i.qty]),[['tea::100%',1],['tea::50%',1],['latte::100%',1]]);
  const total=list=>list.reduce((s,i)=>s+i.qty*i.price,0);
  assert.equal(total(moved),total(items));
  assert.deepEqual(items.map(i=>i.qty),[2,1],'input not mutated');
});

test('moving into an existing line merges, single cup line is replaced, no-op is safe',()=>{
  const merged=moveOneUnitToVariant([line('100%',1),line('50%',1)],'tea::100%','50%');
  assert.deepEqual(merged.map(i=>[i.key,i.qty]),[['tea::50%',2]]);
  const single=moveOneUnitToVariant([line('100%',1)],'tea::100%','0%');
  assert.deepEqual(single.map(i=>[i.key,i.variant,i.qty]),[['tea::0%','0%',1]]);
  const same=[line('100%',1)];
  assert.equal(moveOneUnitToVariant(same,'tea::100%','100%'),same);
  assert.equal(moveOneUnitToVariant(same,'missing','50%'),same);
});

test('POS uses quick add, inline sweetness chips and a two-way payment handoff',async()=>{
  const pos=await readFile(new URL('../app/pos/page.tsx',import.meta.url),'utf8');
  assert.match(pos,/const quick=quickAddVariant\(product\.variants\)/);
  assert.match(pos,/moveOneUnitToVariant\(/);
  assert.match(pos,/data-sweetness-chip/);
  assert.match(pos,/data-handoff-next-order/);
  // Sweetness changes still go through the same stock check as any cart change.
  assert.match(pos,/function changeVariant[\s\S]{0,600}validateCartChange\(/);
});

test('workspace offers one-tap counter handoff next to the pager call',async()=>{
  const ws=await readFile(new URL('../components/pos-daily-workspace.tsx',import.meta.url),'utf8');
  assert.match(ws,/runQueueTailAction\(order,"handoff_now"\)/);
  assert.match(ws,/runQueueTailAction\(order,"call"\)/);
});

test('handing over the last queued drink returns the solo operator to the menu',async()=>{
  const ws=await readFile(new URL('../components/pos-daily-workspace.tsx',import.meta.url),'utf8');
  assert.match(ws,/if\(action==="handoff_now"&&Array\.isArray\(result\?\.orders\)&&result\.orders\.length===0\)\{setQueueFeedback\(""\);onClose\(\);return\}/);
});
