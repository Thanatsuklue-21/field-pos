import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('POS shows live cash change and closes payment modal after success',async()=>{
  const pos=await read('app/pos/page.tsx');
  assert.match(pos,/เงินทอน/);
  assert.match(pos,/setPayOpen\(false\)/);
  assert.match(pos,/ชำระเงินสำเร็จ/);
  assert.match(pos,/ไปทำคิว \{lastSale\.queueNo\}/);
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

test('queue shows pager number and one guided production action',async()=>{
  const queue=await read('app/queue/page.tsx');
  assert.match(queue,/บัตรเรียกคิว/);
  assert.match(queue,/บัตรผลิตปัจจุบัน/);
  assert.match(queue,/ทำ \{task\.item\.name\} ครบ/);
  assert.match(queue,/ทำตอนนี้/);
  assert.match(queue,/text-4xl font-black/);
  assert.doesNotMatch(queue,/recommendedTask/);
  assert.doesNotMatch(queue,/selectedTask/);
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
  const accounting=posApi.slice(posApi.indexOf('function saleAccountingStatements'),posApi.indexOf('function buildItems'));
  assert.match(accounting,/statements\.push/);
  assert.match(posApi,/async function writeSaleAccounting\(tx,ctx\)\{return txBatch\(tx,saleAccountingStatements\(ctx\)\)\}/);
  const save=posApi.slice(posApi.indexOf('function stateSaveStatements'),posApi.indexOf('function activeOrders'));
  assert.match(save,/prepared\.statements/);
  assert.match(save,/await txBatch\(tx,prepared\.statements\)/);
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


test('queue production flow is one guided base at a time without early-pickup branching',async()=>{
  const queue=await read('app/queue/page.tsx');
  assert.match(queue,/หมวดงาน \/ Base เดียวกัน/);
  assert.match(queue,/activeBase/);
  assert.match(queue,/ทำ \{task\.item\.name\} ครบ/);
  assert.doesNotMatch(queue,/action:"call_item"/);
  assert.doesNotMatch(queue,/รับเมนูนี้ก่อน/);
  assert.match(queue,/เรียกบัตร \{first\.pagerNo\}/);
  assert.match(queue,/ลูกค้ารับแล้ว/);
});

test('queue reads a compact snapshot and renders order production details',async()=>{
  const queue=await read('app/queue/page.tsx'),api=await read('lib/api.mjs'),posApi=await read('lib/pos-api.mjs');
  assert.match(queue,/api<QueueSnapshot\|RevisionUnchanged>\("\/api\/pos\/queue"/);
  assert.doesNotMatch(queue,/api<Bootstrap>\("\/api\/pos\/bootstrap"\)/);
  assert.match(api,/path==='\/api\/pos\/queue'&&method==='GET'/);
  assert.match(api,/getQueueSnapshot/);
  assert.match(posApi,/price:x\.price/);
  assert.match(queue,/รายการรวมในบัตรนี้/);
  assert.match(queue,/หมวดงาน \/ Base เดียวกัน/);
  assert.doesNotMatch(queue,/ยอดรวม ฿/);
});

test('POS and Queue polls short-circuit unchanged state by revision',async()=>{
  const pos=await read('app/pos/page.tsx'),queue=await read('app/queue/page.tsx'),api=await read('lib/api.mjs'),posApi=await read('lib/pos-api.mjs'),client=await read('lib/api-client.ts');
  assert.match(pos,/X-Field-Revision/);
  assert.match(queue,/X-Field-Revision/);
  assert.match(api,/x-field-revision/);
  assert.match(api,/CASE WHEN revision=\? THEN NULL ELSE document END AS document/);
  assert.match(posApi,/CASE WHEN revision=\? THEN NULL ELSE document END AS document/);
  assert.match(posApi,/unchanged:true/);
  assert.match(api,/unchanged:true/);
  assert.match(client,/data\?\.unchanged!==true/);
  const bootstrap=api.slice(api.indexOf("if(path==='/api/pos/bootstrap'"),api.indexOf("const menuImageReadMatch",api.indexOf("if(path==='/api/pos/bootstrap'")));
  assert.doesNotMatch(bootstrap,/const orders=/);
  assert.doesNotMatch(bootstrap,/availabilityStock:availability\.stock,orders/);
});

test('queue view reuses lookup maps instead of rescanning menus sales and prep bases per item',async()=>{
  const api=await read('lib/pos-api.mjs');
  assert.match(api,/function buildQueueLookup/);
  assert.match(api,/menuById:new Map/);
  assert.match(api,/saleById:new Map/);
  assert.match(api,/prepBaseById:new Map/);
  assert.match(api,/const lookup=buildQueueLookup\(doc\)/);
});

test('queue actions use optimistic feedback and delivery has a visible fixed toast',async()=>{
  const queue=await read('app/queue/page.tsx');
  assert.match(queue,/const optimistic=/);
  assert.match(queue,/pulse\("กำลังส่งมอบ/);
  assert.match(queue,/ส่งมอบ .*เรียบร้อยแล้ว/);
  assert.match(queue,/fixed bottom-\[76px\]/);
  assert.match(queue,/busyRef\.current=true/);
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


test('order items preserve sale-time price while production queue hides commercial pricing',async()=>{
  const api=await read('lib/pos-api.mjs'),queue=await read('app/queue/page.tsx');
  assert.match(api,/price:x\.price,readyQty:0,calledQty:0,addedAt:now/);
  assert.ok((api.match(/qty:x\.qty,price:x\.price,readyQty:0,calledQty:0/g)||[]).length>=2);
  assert.match(api,/function saleTimeItemPrice/);
  assert.doesNotMatch(queue,/ราคาไม่พบ/);
  assert.doesNotMatch(queue,/ยอดรวม ฿/);
});

test('mobile operational pages use compact density while preserving touch actions',async()=>{
  const shell=await read('components/app-shell.tsx'),pos=await read('app/pos/page.tsx'),queue=await read('app/queue/page.tsx'),stock=await read('app/stock/page.tsx'),orders=await read('app/orders/page.tsx');
  assert.match(shell,/min-w-\[54px\]/);
  assert.match(pos,/min-h-\[154px\]/);
  assert.match(pos,/bottom-\[70px\]/);
  assert.match(queue,/h-full overflow-y-auto overscroll-contain p-2\.5 pb-28/);
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
  assert.match(pos,/\{selectedQty\} × ฿\{i\.price\.toFixed\(0\)\}/);
  assert.match(pos,/cart\.removeItem\(i\.key\)/);
  assert.match(pos,/updateCartQuantity\(i\.key,i\.qty-1\)/);
  assert.match(pos,/updateCartQuantity\(i\.key,i\.qty\+1\)/);
  assert.match(pos,/\{splitBill\?"บิลนี้":"รวม"\} \{payableQty\} แก้ว/);
  assert.match(pos,/max-h-\[94vh\]/);
});


test('payment modal stays above mobile navigation with sticky confirm and exact-cash shortcut',async()=>{
  const pos=await read('app/pos/page.tsx');
  assert.match(pos,/z-\[90\]/);
  assert.match(pos,/max-h-\[calc\(100dvh-1rem\)\]/);
  assert.match(pos,/sticky bottom-0 z-10/);
  assert.match(pos,/รับพอดี ฿\{netPayable\.toFixed\(0\)\}/);
  assert.match(pos,/setReceived\(String\(netPayable\)\)/);
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


test('split-person flow retains one group queue between payments',async()=>{
  const pos=await read('app/pos/page.tsx'),api=await read('lib/pos-api.mjs');
  assert.match(pos,/field-pos-split-group-v1/);
  assert.match(pos,/targetOrderId:splitGroup\?\.orderId\|\|undefined/);
  assert.match(pos,/ลูกค้ากลุ่มนี้ใช้คิว/);
  assert.match(pos,/การจ่ายคนถัดไปจะใช้คิวและบัตรเรียกเดิมอัตโนมัติ/);
  assert.match(api,/paymentGroupId=target\?\.paymentGroupId\|\|'pg-'/);
  assert.match(api,/targetOrderId:target\?\.id\|\|null/);
  assert.match(api,/target\.saleIds=\[\.\.\.\(target\.saleIds/);
});


test('queue groups duplicate lines and exposes grouped bases without recipe detail',async()=>{
  const queue=await read('app/queue/page.tsx'),api=await read('lib/pos-api.mjs');
  assert.match(api,/function normalizeQueueItems/);
  assert.match(api,/function prepGroupsView/);
  assert.match(api,/function prepCompatibilityKey/);
  assert.match(api,/MATCHA BASE/);
  assert.match(api,/compatibilityKey/);
  assert.match(queue,/compatibilityKey/);
  assert.match(queue,/baseTitle/);
  assert.match(queue,/หมวดงาน \/ Base เดียวกัน/);
  assert.match(queue,/category\.baseGroups\.map/);
  assert.match(api,/for\(const o of activeOrders\(doc\)\)/);
  assert.match(api,/target\.items=normalizeQueueItems/);
  assert.match(api,/const queueLookup=buildQueueLookup\(doc\)/);
  assert.match(api,/order\.items=normalizeQueueItems\(doc,order,queueLookup\)/);
  assert.doesNotMatch(queue,/สูตรต่อ 1 แก้ว/);
  assert.doesNotMatch(queue,/recipeUsage/);
  assert.match(api,/recipeUsage:recipeUsageView/);
  assert.match(api,/fifo_violation/);
});

test('CRM redemption makes the payment UI use net payable for cash and PromptPay',async()=>{
  const pos=await read('app/pos/page.tsx');
  assert.match(pos,/pointsRedeemValue/);
  assert.match(pos,/maxRedeemPoints/);
  assert.match(pos,/crmDiscount/);
  assert.match(pos,/netPayable/);
  assert.match(pos,/pointsRedeemed:redeemPoints/);
  assert.match(pos,/รับพอดี ฿\{netPayable\.toFixed\(0\)\}/);
  assert.match(pos,/cashReceived<netPayable/);
  assert.match(pos,/ส่วนลดสมาชิก/);
  assert.match(pos,/ใช้ได้สูงสุด/);
});


test('queue production view centers one pager card with order summary and grouped bases',async()=>{
  const queue=await read('app/queue/page.tsx');
  assert.match(queue,/ทำออเดอร์ \/ รันบัตร/);
  assert.match(queue,/บัตรผลิตปัจจุบัน/);
  assert.match(queue,/รายการรวมในบัตรนี้/);
  assert.match(queue,/หมวดงาน \/ Base เดียวกัน/);
  assert.match(queue,/ขั้นตอนปัจจุบัน/);
  assert.match(queue,/บัตรถัดไป/);
  assert.match(queue,/รอลูกค้ารับ/);
  assert.match(queue,/activeBase/);
  assert.match(queue,/baseTitle/);
  assert.doesNotMatch(queue,/ดูสูตร \/ Base/);
  assert.doesNotMatch(queue,/สูตรกันลืม/);
  assert.doesNotMatch(queue,/ดูบิล \/ ย้อนรายการ/);
  assert.doesNotMatch(queue,/ดูภาพรวม/);
  assert.doesNotMatch(queue,/ดูรายการ \/ แก้ไขออเดอร์/);
});

test('queue mobile card keeps pager identity and production metadata readable',async()=>{
  const queue=await read('app/queue/page.tsx');
  assert.match(queue,/บัตรเรียกคิว/);
  assert.match(queue,/text-4xl font-black/);
  assert.match(queue,/ลำดับ \{first\.queueNo\}/);
  assert.match(queue,/firstCupCount/);
  assert.match(queue,/firstRemaining/);
});

test('queue hydrates from a short-lived snapshot cache before background sync',async()=>{
  const queue=await read('app/queue/page.tsx'),cache=await read('lib/queue-cache.ts');
  assert.match(queue,/readQueueSnapshotCache<QueueSnapshot>/);
  assert.match(queue,/writeQueueSnapshotCache/);
  assert.match(cache,/TTL_MS=30_000/);
  assert.match(cache,/sessionStorage/);
  assert.match(queue,/กำลังซิงก์/);
});

test('payment success prioritizes queue prefetch before noncritical refreshes',async()=>{
  const pos=await read('app/pos/page.tsx');
  const warm=pos.indexOf('warmQueueSnapshot();');
  const bootstrap=pos.indexOf('window.setTimeout(()=>load(true)');
  const customers=pos.indexOf('window.setTimeout(()=>loadCustomers()');
  assert.ok(warm>0&&bootstrap>warm&&customers>bootstrap);
  assert.match(pos,/router\.prefetch\("\/queue"\)/);
  assert.match(pos,/api<any>\("\/api\/pos\/queue"\)/);
  assert.match(pos,/writeQueueSnapshotCache/);
});


test('solo operator daily flow keeps sales and production as separate focused screens',async()=>{
  const shell=await read('components/app-shell.tsx'),pos=await read('app/pos/page.tsx'),queue=await read('app/queue/page.tsx'),close=await read('app/close/page.tsx');
  assert.match(shell,/\["\/pos","\/queue","\/stock","\/expenses","\/close","\/orders","\/settings"\]/);
  assert.match(pos,/ไปทำคิว \{lastSale\.queueNo\}/);
  assert.match(pos,/รับลูกค้าคนถัดไป/);
  assert.match(queue,/PRODUCTION RUN/);
  assert.match(queue,/ทำออเดอร์ \/ รันบัตร/);
  assert.doesNotMatch(queue,/router\.push\("\/orders/);
  assert.doesNotMatch(queue,/router\.push\("\/pos/);
  assert.match(close,/OPEN \/ CLOSE DAY/);
  assert.match(close,/เปิดร้านวันนี้/);
  assert.match(close,/ปิดร้านวันนี้/);
});

test('queue grouped base progress remains visible while cache schema protects snapshots',async()=>{
  const queue=await read('app/queue/page.tsx'),api=await read('lib/pos-api.mjs'),cache=await read('lib/queue-cache.ts');
  assert.match(queue,/category\.pendingQty/);
  assert.match(queue,/base\.pendingQty/);
  assert.match(queue,/ครบแล้ว/);
  assert.match(queue,/หมวดงาน \/ Base เดียวกัน/);
  assert.match(api,/pendingQty:g\.pendingQty/);
  assert.match(api,/qty:total,pendingQty:pending/);
  assert.match(cache,/SCHEMA_VERSION=3/);
  assert.match(cache,/field-pos-queue-snapshot-v3/);
});

test('queue guides one production category and compatible base inside the pager card',async()=>{
  const queue=await read('app/queue/page.tsx'),api=await read('lib/pos-api.mjs');
  assert.match(queue,/ขั้นตอนปัจจุบัน/);
  assert.match(queue,/หมวดงาน \/ Base เดียวกัน/);
  assert.match(queue,/activeCategory/);
  assert.match(queue,/activeBase/);
  assert.match(queue,/baseTitle/);
  assert.doesNotMatch(queue,/RECIPE REMINDER/);
  assert.doesNotMatch(queue,/สูตรต่อ 1 แก้ว/);
  assert.match(api,/a\.compatibilityKey\.localeCompare\(b\.compatibilityKey\)/);
});

test('queue mobile page uses a single primary scroll surface so bottom content remains reachable',async()=>{
  const queue=await read('app/queue/page.tsx');
  assert.match(queue,/soft-scroll h-full overflow-y-auto overscroll-contain/);
  assert.match(queue,/pb-28/);
  const main=queue.slice(queue.indexOf('return <section'));
  assert.doesNotMatch(main,/min-h-0 flex-1 overflow-y-auto/);
  assert.doesNotMatch(main,/max-h-\[132px\].*overflow-y-auto/);
  assert.doesNotMatch(main,/h-\[100dvh\]/);
});

test('queue production card advances past called orders while pickup cards remain visible',async()=>{
  const queue=await read('app/queue/page.tsx');
  const view=queue.slice(queue.indexOf('function QueueView'));
  assert.ok(view.includes('const first=orders.find(order=>!orderCalled(order));'));
  assert.ok(!view.includes('const first=orders[0]'));
  assert.ok(view.includes('const waitingPickup=orders.filter(orderCalled);'));
  assert.ok(view.includes('รอลูกค้ารับ'));
  assert.ok(view.includes('ลูกค้ารับแล้ว'));
});

test('queue removes secondary detail overlays and keeps all production details on the pager card',async()=>{
  const queue=await read('app/queue/page.tsx');
  assert.doesNotMatch(queue,/detailOrderId/);
  assert.doesNotMatch(queue,/showOrderOverview/);
  assert.doesNotMatch(queue,/prepPlanOpen/);
  assert.doesNotMatch(queue,/RECIPE REMINDER/);
  assert.match(queue,/รายการรวมในบัตรนี้/);
  assert.match(queue,/หมวดงาน \/ Base เดียวกัน/);
});

test('queue screen contains only production and handoff actions',async()=>{
 const queue=await read('app/queue/page.tsx'),orders=await read('app/orders/page.tsx'),pos=await read('app/pos/page.tsx');
 assert.doesNotMatch(queue,/รับออเดอร์ใหม่/);
 assert.doesNotMatch(queue,/ดูบิล \/ ย้อนรายการ/);
 assert.doesNotMatch(queue,/ดูรายการ \/ แก้ไขออเดอร์/);
 assert.match(queue,/ชงเสีย \/ ทำใหม่/);
 assert.match(queue,/เรียกบัตร/);
 assert.match(queue,/ลูกค้ารับแล้ว/);
 assert.ok(orders.includes('ไปคิวครัว'));
 assert.ok(!pos.includes('setTimeout(()=>setLastSale(null),8000)'));
});



test('safe GET requests are bounded and coalesced while writes remain single-attempt',async()=>{
  const client=await read('lib/api-client.ts');
  assert.match(client,/GET_TIMEOUT_MS=8_000/);
  assert.match(client,/const getInFlight=new Map/);
  assert.match(client,/const key=getRequestKey\(path,init\),existing=getInFlight\.get\(key\)/);
  assert.match(client,/controller=method==="GET"&&!init\.signal\?new AbortController\(\):null/);
  assert.match(client,/if\(method==="GET"\)\{/);
  assert.match(client,/return executeApi<T>\(path,init,method\);/);
  assert.doesNotMatch(client,/retry/i);
});


test('called pickup cards can reopen order details before handoff',async()=>{
  const queue=await read('app/queue/page.tsx');
  assert.match(queue,/pickupDetailId/);
  assert.match(queue,/ดูรายการ/);
  assert.match(queue,/ซ่อนรายการ/);
  assert.match(queue,/pickupVariantLabel/);
  assert.match(queue,/หวานปกติ 100%/);
  assert.match(queue,/หวานน้อย 50%/);
  assert.match(queue,/ไม่หวาน 0%/);
  assert.match(queue,/setPickupDetailId\(order\.id\)/);
  assert.match(queue,/ลูกค้ารับแล้ว/);
});
