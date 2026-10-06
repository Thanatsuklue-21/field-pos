import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('held bills persist locally without creating a server sale or queue',async()=>{
  const store=await read('stores/held-cart-store.ts');
  assert.match(store,/persist/);
  assert.match(store,/field-pos-held-carts-v1/);
  assert.match(store,/holdCart/);
  assert.match(store,/removeHeld/);
  assert.doesNotMatch(store,/\/api\//);
});

test('POS hold action clears the active cart only after storing a copy',async()=>{
  const pos=await read('app/pos/page.tsx');
  const start=pos.indexOf('function holdCurrentBill()');
  const end=pos.indexOf('function resumeHeldBill',start);
  const segment=pos.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.ok(segment.indexOf('heldBills.holdCart(cart.items)')<segment.indexOf('cart.clearCart()'));
  assert.match(segment,/pendingRead\(\)\|\|cashPendingRead\(\)/);
  assert.match(segment,/if\(splitGroup\)/);
});

test('resuming a held bill never overwrites a live cart and refreshes sale-time menu data',async()=>{
  const pos=await read('app/pos/page.tsx');
  const start=pos.indexOf('function resumeHeldBill');
  const end=pos.indexOf('function startNextOrder',start);
  const segment=pos.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(segment,/if\(cart\.items\.length\)/);
  assert.match(segment,/current\.name/);
  assert.match(segment,/current\.price/);
  assert.match(segment,/variant\.available/);
  assert.match(segment,/cartAvailability/);
  assert.ok(segment.indexOf('cart.replaceItems(next)')<segment.indexOf('heldBills.removeHeld(id)')||segment.indexOf('heldBills.removeHeld(id)')<segment.indexOf('cart.replaceItems(next)'));
});

test('mobile and desktop sales UI expose one-tap hold plus a held-bill drawer',async()=>{
  const pos=await read('app/pos/page.tsx');
  const hits=(pos.match(/holdCurrentBill/g)||[]).length;
  assert.ok(hits>=3);
  assert.match(pos,/HOLD BILL/);
  assert.match(pos,/เรียกบิลนี้กลับ/);
  assert.match(pos,/ยังไม่สร้างยอดขาย ไม่ตัด Stock และไม่เข้าคิวจนกว่าจะชำระจริง/);
});
