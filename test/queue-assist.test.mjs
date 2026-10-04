import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('queue UI keeps oldest-order guidance while batching shared prep bases across the first FIFO window',async()=>{
  const ui=await read('app/queue/page.tsx');
  assert.match(ui,/sort\(\(a,b\)=>n\(a\.time\)-n\(b\.time\)\)/);
  assert.match(ui,/const first=orders\[0\]/);
  assert.match(ui,/const window=orders\.slice\(0,3\)/);
  assert.match(ui,/prep\?\.compatibilityKey/);
  assert.match(ui,/prep\?\.batchMode==="NONE"/);
  assert.match(ui,/ทำเบสต่อเนื่อง/);
  assert.match(ui,/เตรียมฐานรวม:/);
  assert.match(ui,/พิจารณาเฉพาะ 3 คิวแรก/);
  assert.match(ui,/ห้ามเทรวม/);
  assert.match(ui,/FIFO/);
});

test('queue selection marker is explicit and persists through bootstrap',async()=>{
  const api=await read('lib/api.mjs');
  const ui=await read('app/queue/page.tsx');
  assert.match(api,/prepSelected:!!x\.prepSelected/);
  assert.match(ui,/รับทำเมนูนี้/);
  assert.match(ui,/กำลังทำ/);
  assert.match(ui,/action:"select"/);
  assert.match(ui,/prepSelected/);
});

test('backend remains authoritative for FIFO customer calls and final delivery',async()=>{
  const pos=await read('lib/pos-api.mjs');
  assert.match(pos,/fifo_violation/);
  assert.match(pos,/fifo\[0\]\?\.id!==order\.id/);
  assert.match(pos,/active\[0\]\?\.id!==order\.id/);
});
