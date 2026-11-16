import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

// Owner-approved 2026-11-16: a solo operator may take the next order while a
// PromptPay QR waits for the bank (Krungsri notifications arrive 30-60 s late).

test('parking requires a server-side QR (session + charge), a known pending status and no split flow',async()=>{
  const pos=await read('app/pos/page.tsx');
  const fn=pos.slice(pos.indexOf('function parkPendingPrompt'),pos.indexOf('async function cancelParkedPrompt'));
  assert.match(fn,/if\(!p\|\|p\.parked\|\|!p\.sessionId\|\|!p\.paymentReference\|\|p\.checkoutMode==="split_bill"\|\|splitGroup\)return/);
  assert.match(fn,/String\(prompt\?\.status\|\|""\)\.toLowerCase\(\)!=="pending"\)return/);
  // The parked bill keeps its own cart snapshot; only then is the live cart cleared.
  assert.ok(fn.indexOf('pendingWrite({...p,parked:true')<fn.indexOf('cart.clearCart()'));
});

test('a parked bill completing in the background never touches the new order',async()=>{
  const pos=await read('app/pos/page.tsx');
  const helper=pos.slice(pos.indexOf('function completePrompt'),pos.indexOf('function parkPendingPrompt'));
  assert.match(helper,/if\(p\.parked\)\{finishSale\(r,\{\.\.\.opts,background:true\}\);return\}/);
  const fin=pos.slice(pos.indexOf('function finishSale'),pos.indexOf('function availabilityMessage'));
  const bg=fin.slice(fin.indexOf('if(opts.background)'),fin.indexOf('return;',fin.indexOf('if(opts.background)')));
  assert.doesNotMatch(bg,/clearCart|setPayOpen|setLastSale|setReceived/);
  assert.match(bg,/announcePayment/);
});

test('only one QR at a time; cash stays available while a QR is parked',async()=>{
  const pos=await read('app/pos/page.tsx');
  assert.match(pos,/if\(unresolvedPrompt\?\.parked&&method==="promptpay"\)\{/);
  assert.match(pos,/\(online\?promptConfig\?\.ready!==true:!offlineQrId\)\|\|netPayable<=0\|\|!!parkedRecord/);
});

test('parked QR keeps polling every 2 s, never reopens the sheet, and expiry is announced',async()=>{
  const pos=await read('app/pos/page.tsx');
  assert.match(pos,/if\(!online\|\|!parkedRecord\)return;/);
  const rec=pos.slice(pos.indexOf('async function recoverPending'),pos.indexOf('function errorText'));
  assert.match(rec,/if\(p\.parked\)\{setParkedStatus\(st\);return\}/);
  assert.match(rec,/QR ฿"\+formatBaht\(p\.total\)\+" หมดเวลา · ยังไม่ได้รับเงิน/);
  assert.match(rec,/if\(p\?\.parked\)return;/);
});

test('cancelling a parked QR releases the reservation and restores cups only into an empty cart',async()=>{
  const pos=await read('app/pos/page.tsx');
  const fn=pos.slice(pos.indexOf('async function cancelParkedPrompt'),pos.indexOf('async function finalizePending'));
  assert.ok(fn.indexOf('cancelPendingReservation(p)')<fn.indexOf('pendingClear()'));
  assert.match(fn,/if\(!useCartStore\.getState\(\)\.items\.length&&data\)/);
});

test('background PromptPay reconcile never runs while checkout is still opening the QR (field report 2026-11-16)',async()=>{
  const {readFile}=await import('node:fs/promises');
  const pos=await readFile(new URL('../app/pos/page.tsx',import.meta.url),'utf8');
  assert.match(pos,/const tick=\(\)=>\{if\(checkoutInFlightRef\.current\)return;const p=pendingRead\(\);if\(p&&!p\.parked\)recoverPending\(\)/);
  const rec=pos.slice(pos.indexOf('async function recoverPending(){'),pos.indexOf('async function recoverPending(){')+200);
  assert.match(rec,/if\(checkoutInFlightRef\.current\)return;/);
  assert.match(pos,/if\(promptReconcileRef\.current\)\{setResult\("กำลังตรวจ QR เดิม/);
});
