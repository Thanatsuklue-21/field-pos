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

test('queue actions consume compact write responses instead of blocking on a second bootstrap fetch',async()=>{
  const queue=await read('app/queue/page.tsx');
  assert.match(queue,/const applyState=/);
  assert.match(queue,/if\(!applyState\(r\)\)load\(\)\.catch/);
});
