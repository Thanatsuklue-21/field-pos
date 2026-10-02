import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('POS shows live cash change and closes payment modal after success',async()=>{
  const pos=await read('app/pos/page.tsx');
  assert.match(pos,/เงินทอน/);
  assert.match(pos,/setPayOpen\(false\)/);
  assert.match(pos,/ชำระเงินสำเร็จ/);
  assert.match(pos,/ไปคิวผลิต/);
});

test('POS hides zero-price menus and reconciles stale persisted cart items',async()=>{
  const pos=await read('app/pos/page.tsx');
  assert.match(pos,/Number\(x\.price\)>0/);
  assert.match(pos,/cart\.replaceItems\(next\)/);
  assert.match(pos,/menu_unavailable/);
  assert.match(pos,/ราคาเป็น 0/);
});

test('checkout response carries authoritative bill totals and change',async()=>{
  const api=await read('lib/pos-api.mjs');
  assert.match(api,/billNo:sale\.billNo/);
  assert.match(api,/total:sale\.total/);
  assert.match(api,/received:sale\.received/);
  assert.match(api,/change:sale\.change/);
});

test('POS writes no longer return the entire state document',async()=>{
  const api=await read('lib/pos-api.mjs');
  const checkout=api.slice(api.indexOf('export async function checkoutPos'),api.indexOf('export async function voidSale'));
  const queue=api.slice(api.indexOf('export async function queuePosAction'));
  assert.doesNotMatch(checkout,/state:doc/);
  assert.doesNotMatch(queue,/state:doc/);
  assert.match(queue,/orders:queueOrdersView\(doc\)/);
});

test('active zero-price products are blocked and POS bootstrap marks them unavailable',async()=>{
  const api=await read('lib/api.mjs');
  assert.match(api,/price_required_before_enable/);
  assert.match(api,/enabled:!!m\.enabled&&Number\(m\.price\)>0/);
});

test('navigation reuses a short-lived authenticated session',async()=>{
  const client=await read('lib/api-client.ts');
  const shell=await read('components/app-shell.tsx');
  const gate=await read('components/auth-gate.tsx');
  assert.match(client,/SESSION_TTL_MS=30_000/);
  assert.match(client,/getSessionCached/);
  assert.match(shell,/getSessionCached\(\)/);
  assert.match(gate,/getSessionCached\(\)/);
});

test('ordinary cards avoid expensive backdrop blur while navigation can stay frosted',async()=>{
  const css=await read('app/globals.css');
  const glass=css.slice(css.indexOf('.glass{'),css.indexOf('.frosted{'));
  assert.doesNotMatch(glass,/backdrop-filter/);
  assert.match(css,/\.frosted\{/);
  assert.match(css,/backdrop-filter:blur\(14px\)/);
});

test('queue actions consume compact write responses and only fall back to bootstrap when a response is incomplete',async()=>{
  const queue=await read('app/queue/page.tsx');
  assert.match(queue,/const applyState=/);
  assert.match(queue,/const updatedOrders=applyState\(r\)\|\|\[\]/);
  assert.match(queue,/load\(\)\.catch\(\(\)=>\{\}\)/);
});


test('payment success makes the physical pager card visually dominant',async()=>{
  const pos=await read('app/pos/page.tsx');
  assert.match(pos,/หยิบบัตรให้ลูกค้า/);
  assert.match(pos,/text-4xl font-black/);
  assert.match(pos,/บัตร \{lastSale\.pager/);
});

test('queue keeps the physical Bluetooth pager obvious in the guided flow',async()=>{
  const queue=await read('app/queue/page.tsx');
  assert.match(queue,/บัตร \{current\.pagerNo/);
  assert.match(queue,/เครื่องเรียกคิว Bluetooth/);
  assert.match(queue,/กดเครื่องเรียกแล้ว \/ ปิด/);
  assert.match(queue,/setCallPrompt/);
  assert.match(queue,/notifyCustomer/);
});

test('cold-start schema checks are batched instead of one Turso request per DDL statement',async()=>{
  const db=await read('lib/db.mjs');
  assert.match(db,/db\.batch\(SCHEMA\.map/);
  assert.match(db,/for\(const sql of SCHEMA\)await db\.execute\(sql\)/);
});

test('checkout accounting and state writes use transaction batching with test-safe fallback',async()=>{
  const posApi=await read('lib/pos-api.mjs');
  assert.match(posApi,/async function txBatch/);
  assert.match(posApi,/typeof tx\.batch==='function'/);
  const accounting=posApi.slice(posApi.indexOf('async function writeSaleAccounting'),posApi.indexOf('function buildItems'));
  assert.match(accounting,/statements\.push/);
  assert.match(accounting,/await txBatch\(tx,statements\)/);
  const save=posApi.slice(posApi.indexOf('async function saveState'),posApi.indexOf('function activeOrders'));
  assert.match(save,/await txBatch\(tx,\[/);
});

test('cash checkout skips the redundant replay read while PromptPay still replays before provider verification',async()=>{
  const api=await read('lib/api.mjs');
  const seg=api.slice(api.indexOf("if(path==='/api/pos/checkout'"),api.indexOf("if(path==='/api/pos/queue'"));
  const prompt=seg.indexOf("if(String(b.payment||'')==='promptpay')");
  assert.ok(prompt>=0);
  assert.ok(seg.indexOf('getPosRequestReplay',prompt)>=prompt);
  assert.equal(seg.slice(0,prompt).includes('getPosRequestReplay'),false);
  assert.ok(seg.indexOf('getPosRequestReplay')<seg.indexOf('getPromptPayCharge'));
  assert.match(seg,/FIELD_METRIC pos_checkout_ms=/);
});


test('queue production flow is a guided one-action state machine',async()=>{
  const queue=await read('app/queue/page.tsx');
  assert.doesNotMatch(queue,/ทำถัดไป/);
  assert.match(queue,/เริ่มทำเมนูนี้/);
  assert.match(queue,/กำลังทำ:/);
  assert.match(queue,/เสร็จแก้ว /);
  assert.match(queue,/เมนูถัดไป:/);
  assert.match(queue,/action:"notify"/);
  assert.match(queue,/action:"deliver"/);
  assert.match(queue,/ส่งมอบครบทั้งบิล/);
  assert.match(queue,/เรียกลูกค้ามารับที่เสร็จแล้ว/);
});


test('guided queue keeps only the current FIFO order actionable while later orders are summaries',async()=>{
  const queue=await read('app/queue/page.tsx');
  assert.match(queue,/const current=orders\[0\]\|\|null/);
  assert.match(queue,/const waiting=orders\.slice\(1\)/);
  assert.match(queue,/คิวถัดไป/);
  assert.match(queue,/เตรียมพร้อมได้ แต่ส่งมอบยังเรียง FIFO/);
});

test('multi-cup menu uses one action position that progresses cup counts',async()=>{
  const queue=await read('app/queue/page.tsx');
  assert.match(queue,/activeQty>1\?"เสร็จแก้ว "/);
  assert.match(queue,/completeUnit\(current,activeIndex\)/);
  assert.match(queue,/selectItem\(current,activeIndex\)/);
});
