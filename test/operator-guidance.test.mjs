import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('operator coach is embedded globally and auto-teaches the first device',async()=>{
  const shell=await read('components/app-shell.tsx');
  const coach=await read('components/operator-coach.tsx');
  assert.match(shell,/OperatorCoach/);
  assert.match(coach,/field-operator-coach-v1/);
  assert.match(coach,/localStorage\.getItem\(KEY\)!=="seen"/);
  assert.match(coach,/ใช้เป็นใน 1 นาที/);
  assert.match(coach,/FIELD SAFE FLOW · 60 SEC/);
});

test('operator coach teaches recognition-first guarded POS and FIFO production',async()=>{
  const coach=await read('components/operator-coach.tsx');
  assert.match(coach,/ทวนชื่อเมนู จำนวน และยอดกับลูกค้า/);
  assert.match(coach,/QR ต้องรอระบบยืนยัน/);
  assert.match(coach,/หยิบบัตรเลขที่ระบบแสดงให้ลูกค้า/);
  assert.match(coach,/ห้ามเลือกงานเอง/);
  assert.match(coach,/ทำบัตรแรกและงานที่กรอบสีทองชี้เท่านั้น/);
  assert.match(coach,/ลูกค้ารับของจริงแล้วจึงกด/);
  assert.match(coach,/ชงเสีย \/ ทำใหม่/);
});

test('coach controls are large enough for mobile operation',async()=>{
  const coach=await read('components/operator-coach.tsx');
  assert.ok((coach.match(/min-h-14/g)||[]).length>=1);
  assert.ok((coach.match(/min-h-12/g)||[]).length>=2);
});


test('payment is hard-gated until the bill has been reviewed with the customer',async()=>{
  const pos=await read('app/pos/page.tsx');
  assert.match(pos,/reviewConfirmed/);
  assert.match(pos,/setReviewConfirmed\(false\)/);
  assert.match(pos,/ระบบยังไม่เปิดรับเงิน · ต้องทวนบิลกับลูกค้าก่อน/);
  assert.match(pos,/กดหลังทวน: เมนู · จำนวน · ความหวาน · ยอด/);
  assert.match(pos,/!reviewConfirmed/);
});

test('pickup handoff is hard-gated behind visible order review',async()=>{
  const queue=await read('app/queue/page.tsx');
  assert.match(queue,/ดูรายการก่อนส่งมอบ/);
  assert.match(queue,/เทียบ “บัตร \{order\.pagerNo\}” \+ จำนวนแก้ว \+ รายการให้ตรง/);
  assert.match(queue,/ตรวจครบแล้ว · ลูกค้ารับแล้ว/);
  const review=queue.indexOf('reviewOpen&&<div');
  const deliver=queue.indexOf('onClick={()=>deliver(order.id)}');
  assert.ok(review>=0&&deliver>review);
});


test('checkout handler itself refuses unreviewed payment',async()=>{
  const pos=await read('app/pos/page.tsx');
  const checkout=pos.slice(pos.indexOf('async function checkout()'),pos.indexOf('function openPayment()'));
  assert.match(checkout,/if\(!reviewConfirmed\)/);
  assert.match(checkout,/ต้องทวนเมนู · จำนวน · ความหวาน · ยอดกับลูกค้าก่อนรับเงิน/);
});

test('handoff handler itself refuses delivery until the visible pickup review is open',async()=>{
  const queue=await read('app/queue/page.tsx');
  const start=queue.indexOf('async function deliver(');
  const deliver=queue.slice(start,queue.indexOf('const first=',start));
  assert.match(deliver,/pickupReviewId!==orderId/);
  assert.match(deliver,/ต้องตรวจเลขบัตร จำนวนแก้ว และรายการก่อนส่งมอบ/);
});


test('close day is exposed in bootstrap and proactively blocks order entry',async()=>{
  const api=await read('lib/api.mjs');
  const client=await read('lib/api-client.ts');
  const pos=await read('app/pos/page.tsx');
  assert.match(api,/operational:\{businessDate,dayClosed\}/);
  assert.match(client,/operational\?:\{businessDate:string;dayClosed:boolean\}/);
  assert.match(pos,/const salesClosed=!!data\?\.operational\?\.dayClosed/);
  assert.match(pos,/วันนี้ปิดยอดแล้ว · ระบบไม่อนุญาตให้รับออเดอร์เพิ่ม/);
  assert.match(pos,/เปิด Payment ไม่ได้จนกว่าจะเริ่มวันธุรกิจใหม่/);
});
