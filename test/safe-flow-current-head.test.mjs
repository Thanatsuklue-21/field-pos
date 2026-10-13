import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("POS payment is hard-gated until the operator reviews the bill",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/reviewConfirmed/);
  assert.match(pos,/ทวนบิลกับลูกค้าก่อนรับเงิน/);
  assert.match(pos,/กดหลังทวนบิลกับลูกค้าแล้ว/);
  assert.match(pos,/ระบบยังไม่เปิดรับเงิน · ต้องทวนบิลกับลูกค้าก่อน/);
  const checkout=pos.slice(pos.indexOf("async function checkout()"),pos.indexOf("function openPayment()"));
  assert.match(checkout,/if\(!reviewConfirmed\)/);
  assert.match(checkout,/ต้องทวนเมนู · จำนวน · ความหวาน · ยอดกับลูกค้าก่อนรับเงิน/);
  assert.match(pos,/disabled=\{busy\|\|!reviewConfirmed\|\|salesClosed/);
});

test("bill review is invalidated when payment context changes",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/if\(payOpen\)setReviewConfirmed\(false\)/);
  for(const term of ["payableQty","netPayable","method","customerId","redeemPoints","splitBill","deliveryPlatform"])assert.match(pos,new RegExp(term));
});

test("POS bootstrap exposes close-day state and blocks new sale entry proactively",async()=>{
  const api=await read("lib/api.mjs");
  const client=await read("lib/api-client.ts");
  const pos=await read("app/pos/page.tsx");
  assert.match(api,/operational:\{businessDate,dayClosed\}/);
  assert.match(client,/operational\?:\{businessDate:string;dayClosed:boolean\}/);
  assert.match(pos,/const salesClosed=!!data\?\.operational\?\.dayClosed/);
  assert.match(pos,/วันนี้ปิดยอดแล้ว/);
  assert.match(pos,/disabled=\{!x\.available\|\|salesClosed\}/);
  assert.match(pos,/disabled=\{!canAdd\|\|salesClosed\}/);
});

test("pickup handoff requires visible order review",async()=>{
  const queue=await read("app/queue/page.tsx");
  const start=queue.indexOf("async function deliver(");
  const end=queue.indexOf("const first=",start);
  const block=queue.slice(start,end);
  assert.match(block,/pickupReviewId!==orderId/);
  assert.match(block,/ต้องตรวจเลขบัตร จำนวนแก้ว และรายการก่อนส่งมอบ/);
  assert.match(queue,/ดูรายการก่อนส่งมอบ/);
  assert.match(queue,/ตรวจครบแล้ว · ลูกค้ารับแล้ว/);
  assert.match(queue,/เทียบ “บัตร \{order\.pagerNo\}” \+ จำนวนแก้ว \+ รายการให้ตรง/);
});

test("one-minute coach teaches only POS and Queue and yields during transactions",async()=>{
  const shell=await read("components/app-shell.tsx");
  const coach=await read("components/operator-coach.tsx");
  const pos=await read("app/pos/page.tsx");
  assert.match(shell,/OperatorCoach/);
  assert.match(coach,/field-operator-coach-v3:/);
  assert.match(coach,/KEY_PREFIX\+mode/);
  assert.match(coach,/localStorage\.getItem\(seenKey\)!=="seen"/);
  assert.match(coach,/ใช้เป็นใน 1 นาที/);
  assert.match(coach,/งานขายส่วนใหญ่จบจากหน้าเดียว/);
  assert.match(coach,/ทำบัตรแรกก่อนเสมอ/);
  assert.match(coach,/field:transaction-busy/);
  assert.match(pos,/field:transaction-busy/);
  assert.match(pos,/busy\|\|payOpen/);
});
