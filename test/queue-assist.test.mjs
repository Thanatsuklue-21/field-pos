import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('queue UI keeps base preparation inside the oldest FIFO queue only',async()=>{
  const ui=await read('app/queue/page.tsx');
  assert.match(ui,/sort\(\(a,b\)=>n\(a\.time\)-n\(b\.time\)\)/);
  assert.match(ui,/const first=orders\[0\]/);
  assert.match(ui,/เตรียมเฉพาะคิว \{first\.queueNo\} · ไม่ข้ามคิว/);
  assert.match(ui,/แผนเตรียมเบสของคิวนี้/);
  assert.match(ui,/คิวปัจจุบัน \+ แผนเบส \+ รายการเครื่องดื่ม อยู่ในหน้าจอเดียวสำหรับคนชง/);
  assert.doesNotMatch(ui,/orders\.slice\(0,3\)/);
  assert.doesNotMatch(ui,/เตรียมฐานรวม:/);
  assert.match(ui,/\(first\.prepGroups\|\|\[\]\)\.map/);
  assert.match(ui,/u\.name\+" "\+Number\(u\.perCup\.toFixed\(2\)\)/);
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
