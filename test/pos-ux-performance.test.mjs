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


test('payment success makes the physical pager card visually dominant',async()=>{
  const pos=await read('app/pos/page.tsx');
  assert.match(pos,/หยิบบัตรให้ลูกค้า/);
  assert.match(pos,/text-4xl font-black/);
  assert.match(pos,/บัตร \{lastSale\.pager/);
});

test('queue shows pager number, guided active work, and Bluetooth reminder',async()=>{
  const queue=await read('app/queue/page.tsx');
  assert.match(queue,/บัตรเรียกคิว/);
  assert.match(queue,/รับทำเมนูนี้/);
  assert.match(queue,/กำลังทำ/);
  assert.match(queue,/ทำเสร็จ/);
  assert.match(queue,/เครื่องเรียกคิว Bluetooth/);
  assert.match(queue,/กดเครื่องเรียกแล้ว \/ ปิด/);
  assert.match(queue,/setCallPrompt/);
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


test('queue production flow is one guided task at a time with optional early pickup',async()=>{
  const queue=await read('app/queue/page.tsx');
  assert.doesNotMatch(queue,/ทำถัดไป/);
  assert.match(queue,/ลำดับงานแนะนำ/);
  assert.match(queue,/รับทำเมนูนี้/);
  assert.match(queue,/ทำเสร็จ/);
  assert.match(queue,/action:"call_item"/);
  assert.match(queue,/รับเมนูนี้ก่อน/);
  assert.match(queue,/รับทั้งหมด/);
  assert.match(queue,/ส่งมอบคิวนี้/);
});

test('queue reads a compact snapshot and renders priced order details',async()=>{
  const queue=await read('app/queue/page.tsx'),api=await read('lib/api.mjs'),posApi=await read('lib/pos-api.mjs');
  assert.match(queue,/api<QueueSnapshot>\("\/api\/pos\/queue"\)/);
  assert.doesNotMatch(queue,/api<Bootstrap>\("\/api\/pos\/bootstrap"\)/);
  assert.match(api,/path==='\/api\/pos\/queue'&&method==='GET'/);
  assert.match(api,/getQueueSnapshot/);
  assert.match(posApi,/price:saleTimeItemPrice\(doc,o,x\)/);
  assert.match(queue,/ยอดรวม ฿/);
  assert.match(queue,/ดูรายการ \/ แก้ไขออเดอร์/);
});

test('queue actions use optimistic feedback and delivery has a visible fixed toast',async()=>{
  const queue=await read('app/queue/page.tsx');
  assert.match(queue,/const optimistic=/);
  assert.match(queue,/pulse\("กำลังส่งมอบ/);
  assert.match(queue,/ส่งมอบ .*เรียบร้อยแล้ว/);
  assert.match(queue,/fixed bottom-\[76px\]/);
  assert.match(queue,/กำลังบันทึก\.\.\./);
});

test('cash order can be safely voided and loaded back into POS before production',async()=>{
  const orders=await read('app/orders/page.tsx'),pos=await read('app/pos/page.tsx'),api=await read('lib/api.mjs');
  assert.match(api,/productionStarted/);
  assert.match(api,/id:x\.id,name:x\.name/);
  assert.match(orders,/แก้ไข \/ ลด \/ เปลี่ยนเมนู/);
  assert.match(orders,/cart\.replaceItems/);
  assert.match(orders,/field-pos-edit-cash-v1/);
  assert.match(orders,/heldCash:s\.total/);
  assert.match(pos,/field-pos-edit-cash-v1/);
  assert.match(pos,/ยอดเงินสดจากบิลเดิม/);
});


test('order items preserve sale-time price across normal add-on and split flows',async()=>{
  const api=await read('lib/pos-api.mjs'),queue=await read('app/queue/page.tsx');
  assert.match(api,/price:x\.price,readyQty:0,calledQty:0,addedAt:now/);
  assert.ok((api.match(/qty:x\.qty,price:x\.price,readyQty:0,calledQty:0/g)||[]).length>=2);
  assert.match(api,/function saleTimeItemPrice/);
  assert.match(queue,/ราคาไม่พบ/);
});

test('mobile operational pages use compact density while preserving touch actions',async()=>{
  const shell=await read('components/app-shell.tsx'),pos=await read('app/pos/page.tsx'),queue=await read('app/queue/page.tsx'),stock=await read('app/stock/page.tsx'),orders=await read('app/orders/page.tsx');
  assert.match(shell,/min-w-\[54px\]/);
  assert.match(pos,/min-h-\[154px\]/);
  assert.match(pos,/bottom-\[70px\]/);
  assert.match(queue,/p-3 sm:p-5 md:p-7/);
  assert.match(stock,/p-3 sm:p-5 md:p-7/);
  assert.match(orders,/p-3 sm:p-5 md:p-7/);
});


test('payment modal reviews cart items prices quantities and sweetness before confirmation',async()=>{
  const pos=await read('app/pos/page.tsx');
  assert.match(pos,/รายการที่สั่ง/);
  assert.match(pos,/ทวนเมนู ราคา และระดับหวานก่อนรับเงิน/);
  assert.match(pos,/orderOptionLabel/);
  assert.match(pos,/หวานปกติ \(100%\)/);
  assert.match(pos,/หวานน้อย \(50%\)/);
  assert.match(pos,/ไม่หวาน \(0%\)/);
  assert.match(pos,/\{i\.qty\} × ฿\{i\.price\.toFixed\(0\)\}/);
  assert.match(pos,/cart\.removeItem\(i\.key\)/);
  assert.match(pos,/updateCartQuantity\(i\.key,i\.qty-1\)/);
  assert.match(pos,/updateCartQuantity\(i\.key,i\.qty\+1\)/);
  assert.match(pos,/รวม \{cart\.items\.reduce\(\(s,i\)=>s\+i\.qty,0\)\} แก้ว/);
  assert.match(pos,/max-h-\[94vh\]/);
});


test('payment modal stays above mobile navigation with sticky confirm and exact-cash shortcut',async()=>{
  const pos=await read('app/pos/page.tsx');
  assert.match(pos,/z-\[90\]/);
  assert.match(pos,/max-h-\[calc\(100dvh-1rem\)\]/);
  assert.match(pos,/sticky bottom-0 z-10/);
  assert.match(pos,/รับพอดี ฿\{cart\.getTotal\(\)\.toFixed\(0\)\}/);
  assert.match(pos,/setReceived\(String\(cart\.getTotal\(\)\)\)/);
  assert.match(pos,/รับเงินพอดียอด · กดยืนยันชำระได้เลย/);
});


test('separate-person bills keep unpaid drinks in cart and pay only selected quantities',async()=>{
  const pos=await read('app/pos/page.tsx');
  assert.match(pos,/แยกบิล \/ จ่ายแยกตามคน/);
  assert.match(pos,/splitSelection/);
  assert.match(pos,/payableItems/);
  assert.match(pos,/checkoutMode=splitBill\?"split_bill":"full"/);
  assert.match(pos,/subtractPaidCart/);
  assert.match(pos,/เหลือ .* แก้วในตะกร้า/);
});

test('mobile menu cards keep long names and prices aligned above checkout bar',async()=>{
  const pos=await read('app/pos/page.tsx');
  assert.match(pos,/overflow-auto pb-28 lg:pb-0/);
  assert.match(pos,/flex min-h-\[154px\] flex-col/);
  assert.match(pos,/flex flex-1 flex-col p-3/);
  assert.match(pos,/mt-auto pt-2 text-base font-semibold/);
});

test('cash checkout batches state and idempotency reads plus accounting state and audit writes',async()=>{
  const api=await read('lib/pos-api.mjs');
  const checkout=api.slice(api.indexOf('export async function checkoutPos'),api.indexOf('export async function voidSale'));
  assert.match(api,/function rememberStatement/);
  assert.match(api,/function stateSaveStatements/);
  assert.match(api,/function saleAccountingStatements/);
  assert.match(checkout,/const reads=await txBatch\(tx,/);
  assert.match(checkout,/writes\.push\(rememberStatement/);
  assert.match(checkout,/writes\.push\(\.\.\.stateWrite\.statements\)/);
  assert.match(checkout,/await txBatch\(tx,writes\)/);
});
