import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
test('server validates client business date against Bangkok date for direct and split checkouts',async()=>{const api=await read('lib/api.mjs'),pos=await read('lib/pos-api.mjs');const matches=api.match(/serverDate=bangkokDate\(now\)/g)||[];assert.ok(matches.length>=2);assert.match(pos,/business_date_changed/);assert.match(pos,/body\.serverDate/);});
test('close day blocks while payments or customer orders are still open and routes operators to correction flows',async()=>{const api=await read('lib/api.mjs');assert.match(api,/close_day_pending_payments/);assert.match(api,/close_day_open_orders/);const ui=await read('app/close/page.tsx');assert.match(ui,/window\.confirm/);assert.match(ui,/ไป Payment Recovery/);assert.match(ui,/window\.location\.assign\("\/orders"\)/);assert.match(ui,/ไปจัดการคิว/);assert.match(ui,/window\.location\.assign\("\/queue"\)/);assert.match(ui,/ไปหน้า Stock/);assert.match(ui,/window\.location\.assign\("\/stock"\)/);});

test('close day requires blind double count review and stores reconciliation fields',async()=>{const api=await read('lib/api.mjs'),ui=await read('app/close/page.tsx');assert.match(api,/counted_cash_required/);assert.match(api,/\/api\/close-day\/review/);assert.match(api,/validateCloseReview/);assert.match(api,/reconcileCash/);assert.match(api,/expectedCash/);assert.match(api,/cashVariance/);assert.match(ui,/เงินสดที่นับได้จริง/);assert.match(ui,/Blind Count 2 รอบ/);assert.match(ui,/Expected Drawer/);assert.match(ui,/Cash Variance/);});


test('close day fails closed on unresolved device-local recovery including critical writes',async()=>{
  const ui=await read('app/close/page.tsx'),preflight=await read('lib/close-day-device-preflight.ts'),storage=await read('lib/offline-db.ts');
  assert.match(ui,/readCloseDayDevicePreflight/);
  assert.match(ui,/await refreshDevicePreflight\(\)/);
  assert.match(ui,/devicePreflight\?\.ok===false/);
  assert.match(preflight,/offlineCashListStrict/);
  assert.match(preflight,/listCriticalWriteIntents/);
  assert.match(preflight,/critical_write_unknown/);
  assert.match(storage,/offline_storage_unavailable/);
});

test('cash drawer movement uses durable identity and exact client recovery',async()=>{
  const api=await read('lib/api.mjs'),ui=await read('app/close/page.tsx');
  const start=api.indexOf("if(path==='/api/cash-shift/movements'&&method==='POST')");
  const end=api.indexOf("if(path==='/api/close-day/review'&&method==='POST')",start);
  assert.ok(start>=0&&end>start);
  const block=api.slice(start,end);
  assert.match(block,/requestKey/);
  assert.match(block,/replayDurableRequest/);
  assert.match(block,/rememberDurableRequestStatement/);
  assert.match(block,/cashDrawerMovement/);
  assert.match(ui,/prepareCriticalWriteIntent/);
  assert.match(ui,/sendCriticalWriteIntent/);
  assert.match(ui,/ตรวจผลรายการเดิม/);
});
