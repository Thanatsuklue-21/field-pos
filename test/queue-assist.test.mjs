import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('queue UI keeps base preparation inside the oldest FIFO queue only',async()=>{
  const ui=await read('app/queue/page.tsx');
  assert.match(ui,/sort\(\(a,b\)=>n\(a\.time\)-n\(b\.time\)\)/);
  assert.match(ui,/const first=orders\.find/);
  assert.match(ui,/function buildCategoryFlow/);
  assert.match(ui,/function baseTitle/);
  assert.match(ui,/BASE ปัจจุบัน · แสดงครั้งเดียว/);
  assert.match(ui,/รายการในคิว/);
  assert.doesNotMatch(ui,/ลำดับหมวดและ Base ของคิวนี้/);
  assert.doesNotMatch(ui,/orders\.slice\(0,3\)/);
  assert.doesNotMatch(ui,/เตรียมฐานรวม:/);
  assert.match(ui,/categoryFlow\.map/);
  assert.match(ui,/ดูสูตร \/ Base/);
  assert.match(ui,/h-\[100dvh\]/);
  assert.match(ui,/สูตรกันลืม/);
  assert.match(ui,/สูตรต่อ 1 แก้ว/);
  assert.match(ui,/overflow-y-auto overscroll-contain/);
  assert.doesNotMatch(ui,/return <section className="h-full overflow-hidden/);
  assert.match(ui,/recipeUsage/);
  assert.doesNotMatch(ui,/\+" = "\+Number\(u\.qty/);
  assert.doesNotMatch(ui,/รวมสำหรับคิวนี้:/);
  assert.doesNotMatch(ui,/พิจารณาเฉพาะ 3 คิวแรก/);
});

test('queue completion is one tap while legacy selection remains supported',async()=>{
  const api=await read('lib/pos-api.mjs');
  const ui=await read('app/queue/page.tsx');
  assert.match(api,/prepSelected:!!x\.prepSelected/);
  assert.match(ui,/"ทำ "\+recommendedTask\.item\.name\+" เสร็จแล้ว"/);
  assert.match(ui,/กำลังทำ/);
  assert.match(ui,/action:"complete_item"/);
  assert.match(ui,/prepSelected/);
});

test('backend preserves production FIFO independently of customer pickup',async()=>{
  const pos=await read('lib/pos-api.mjs');
  assert.match(pos,/fifo_violation/);
  assert.match(pos,/fifo\[0\]\?\.id!==order\.id/);
  assert.match(pos,/productionHead\?\.id!==order\.id/);
});
