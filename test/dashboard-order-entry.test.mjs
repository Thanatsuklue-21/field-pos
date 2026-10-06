import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('dashboard exposes clear front-counter order entry shortcuts',async()=>{
  const dashboard=await read('app/dashboard/page.tsx');
  assert.match(dashboard,/href="\/pos"/);
  assert.match(dashboard,/รับออเดอร์/);
  assert.match(dashboard,/เลือกเมนู → ทวนรายการ → รับเงิน → ออกคิว/);
  assert.match(dashboard,/href="\/queue"/);
  assert.match(dashboard,/คิวที่ต้องทำ/);
  assert.match(dashboard,/href="\/orders"/);
  assert.match(dashboard,/รายการออเดอร์/);
});

test('mobile navigation calls POS order taking explicitly',async()=>{
  const i18n=await read('lib/i18n.ts');
  assert.match(i18n,/TH:\{pos:"รับออเดอร์"/);
  assert.match(i18n,/EN:\{pos:"Order"/);
});
