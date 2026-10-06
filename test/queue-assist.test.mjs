import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('queue UI keeps base preparation inside the oldest FIFO pager card only',async()=>{
  const ui=await read('app/queue/page.tsx');
  assert.match(ui,/sort\(\(a,b\)=>n\(a\.time\)-n\(b\.time\)\)/);
  assert.match(ui,/const first=orders\.find/);
  assert.match(ui,/function buildCategoryFlow/);
  assert.match(ui,/function baseTitle/);
  assert.match(ui,/บัตรผลิตปัจจุบัน/);
  assert.match(ui,/รายการรวมในบัตรนี้/);
  assert.match(ui,/หมวดงาน \/ Base เดียวกัน/);
  assert.match(ui,/categoryFlow\.map/);
  assert.match(ui,/overflow-y-auto overscroll-contain/);
  assert.doesNotMatch(ui,/ดูสูตร \/ Base/);
  assert.doesNotMatch(ui,/สูตรกันลืม/);
  assert.doesNotMatch(ui,/สูตรต่อ 1 แก้ว/);
  assert.doesNotMatch(ui,/recipeUsage/);
  assert.doesNotMatch(ui,/ดูบิล \/ ย้อนรายการ/);
});

test('queue completion is one tap while legacy selection remains supported',async()=>{
  const api=await read('lib/pos-api.mjs');
  const ui=await read('app/queue/page.tsx');
  assert.match(api,/prepSelected:!!x\.prepSelected/);
  assert.match(ui,/ทำ \{task\.item\.name\} ครบ/);
  assert.match(ui,/ทำตอนนี้/);
  assert.match(ui,/action:"complete_item"/);
  assert.match(ui,/prepSelected/);
});

test('backend preserves production FIFO independently of customer pickup',async()=>{
  const pos=await read('lib/pos-api.mjs');
  assert.match(pos,/fifo_violation/);
  assert.match(pos,/fifo\[0\]\?\.id!==order\.id/);
  assert.match(pos,/productionHead\?\.id!==order\.id/);
});
