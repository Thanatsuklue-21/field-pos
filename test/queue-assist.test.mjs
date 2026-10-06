import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('queue UI keeps base preparation inside the oldest FIFO queue only',async()=>{
  const ui=await read('app/queue/page.tsx');
  assert.match(ui,/sort\(\(a,b\)=>n\(a\.time\)-n\(b\.time\)\)/);
  assert.match(ui,/const first=orders\[0\]/);
  assert.match(ui,/เบสเดียวกัน \{n\(group\.qty\)\} แก้ว/);
  assert.match(ui,/ใช้กับ:/);
  assert.match(ui,/สรุปเบสที่ทำร่วมกัน \+ รายการเครื่องดื่ม/);
  assert.doesNotMatch(ui,/orders\.slice\(0,3\)/);
  assert.doesNotMatch(ui,/เตรียมฐานรวม:/);
  assert.match(ui,/\(first\.prepGroups\|\|\[\]\)\.map/);
  assert.match(ui,/สูตรเต็มจอ/);
  assert.match(ui,/h-\[100dvh\]/);
  assert.match(ui,/สูตรกันลืม/);
  assert.match(ui,/สูตรต่อ 1 แก้ว/);
  assert.match(ui,/recipeUsage/);
  assert.doesNotMatch(ui,/\+" = "\+Number\(u\.qty/);
  assert.doesNotMatch(ui,/รวมสำหรับคิวนี้:/);
  assert.doesNotMatch(ui,/พิจารณาเฉพาะ 3 คิวแรก/);
});

test('queue selection marker is explicit and persists through queue snapshot',async()=>{
  const api=await read('lib/pos-api.mjs');
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
