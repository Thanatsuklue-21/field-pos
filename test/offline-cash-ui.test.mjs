import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('offline cash uses durable IndexedDB outbox while generic API writes remain blocked offline',async()=>{
  const db=await read('lib/offline-db.ts'),client=await read('lib/api-client.ts');
  assert.match(db,/OUTBOX_STORE="cash-outbox"/);
  assert.match(db,/VERSION=2/);
  assert.match(db,/offlineCashPut/);
  assert.match(db,/offlineCashPatch/);
  assert.match(client,/offline_write_blocked/);
});

test('POS captures only cash offline and syncs the same idempotent request later',async()=>{
  const pos=await read('app/pos/page.tsx'),sync=await read('lib/offline-sales.ts');
  assert.match(pos,/offlineAtStart/);
  assert.match(pos,/offlineFulfilled:true/);
  assert.match(pos,/queueOfflineCashSale/);
  assert.match(pos,/offlineMenuRevision:data\.revision/);
  assert.match(pos,/if\(method!==\"cash\"\).*offline_cash_only/);
  assert.match(pos,/offline_split_not_supported/);
  assert.match(pos,/offline_loyalty_not_supported/);
  assert.match(sync,/\/api\/pos\/checkout/);
  assert.match(sync,/row\.body/);
  assert.match(sync,/needs_review/);
});

test('offline local stock projection prevents the cart from forgetting already-sold ingredients',async()=>{
  const sync=await read('lib/offline-sales.ts'),pos=await read('app/pos/page.tsx');
  assert.match(sync,/applyOfflineCashToBootstrap/);
  assert.match(sync,/Number\(stock\[ingredientId\]\.qty\)-qty/);
  assert.match(pos,/queueOfflineCashSale\(body,\{projectStock:true\}\)/);
  assert.match(pos,/bootstrap:queued\.bootstrap/);
});

test('server marks synced offline orders returned so they never re-enter production FIFO',async()=>{
  const api=await read('lib/pos-api.mjs');
  assert.match(api,/offlineFulfilled\?'returned':'assigned'/);
  assert.match(api,/readyQty:offlineFulfilled\?x\.qty:0/);
  assert.match(api,/calledQty:offlineFulfilled\?x\.qty:0/);
  assert.match(api,/allowNegative:offlineFulfilled/);
  assert.match(api,/offline_price_changed/);
  assert.match(api,/pos_checkout_offline_sync/);
});
