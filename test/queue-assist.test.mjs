import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('queue UI focuses the oldest active order and only surfaces later same-menu batch opportunities',async()=>{
  const ui=await read('app/queue/page.tsx');
  assert.match(ui,/sort\(\(a,b\)=>Number\(a\.time/);
  assert.match(ui,/const current=orders\[0\]\|\|null/);
  assert.match(ui,/const waiting=orders\.slice\(1\)/);
  assert.match(ui,/item\.id===focus\.id/);
  assert.match(ui,/item\.variant===focus\.variant/);
  assert.match(ui,/ส่งมอบยังเรียง FIFO/);
});

test('queue selection marker persists through bootstrap and drives the guided current-task banner',async()=>{
  const api=await read('lib/api.mjs');
  const ui=await read('app/queue/page.tsx');
  assert.match(api,/prepSelected:!!x\.prepSelected/);
  assert.match(ui,/เริ่มทำเมนูนี้/);
  assert.match(ui,/กำลังทำ:/);
  assert.match(ui,/action:"select"/);
});

test('backend remains authoritative for FIFO notification and delivery',async()=>{
  const pos=await read('lib/pos-api.mjs');
  assert.match(pos,/fifo_violation/);
  assert.match(pos,/fifo\(\)\[0\]\?\.id!==order\.id/);
  assert.match(pos,/action==='notify'/);
  assert.match(pos,/action==='deliver'/);
});
