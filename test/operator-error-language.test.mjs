import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {operatorErrorFallback} from "../lib/operator-error-language.mjs";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("unknown backend codes become safe next-action Thai instead of leaking to operators",()=>{
  const unknown=operatorErrorFallback("opaque_backend_code","การปิดวัน");
  assert.match(unknown,/ยังทำการปิดวันไม่สำเร็จ/);
  assert.match(unknown,/รีเฟรชและตรวจสถานะเดิม/);
  assert.doesNotMatch(unknown,/opaque_backend_code/);

  const network=operatorErrorFallback("network_unavailable","คิว");
  assert.match(network,/เน็ตขาดการเชื่อมต่อ/);
  assert.match(network,/ตรวจรายการเดิมก่อนทำซ้ำ/);

  const permission=operatorErrorFallback("report_permission_required","รายงาน");
  assert.match(permission,/ไม่มีสิทธิ์/);
  assert.match(permission,/เจ้าของร้าน/);
});

test("queue orders and close day use operator-safe fallback instead of raw error codes",async()=>{
  const queue=await read("app/queue/page.tsx");
  const orders=await read("app/orders/page.tsx");
  const close=await read("app/close/page.tsx");
  assert.match(queue,/operatorErrorFallback\(code,"คิว"\)/);
  assert.match(orders,/operatorErrorFallback\(code,"การแก้ไขบิล"\)/);
  assert.match(close,/operatorErrorFallback\(code,"รายการเงินสดในลิ้นชัก"\)/);
  assert.match(close,/operatorErrorFallback\(code,"การปิดวัน"\)/);\n  assert.match(close,/setMsg\(closeDayError\(e\.message\)\)/);
});

test("operator-facing recovery and close-day copy avoids engineering jargon",async()=>{
  const orders=await read("app/orders/page.tsx");
  const close=await read("app/close/page.tsx");
  for(const phrase of [
    "OWNER PAYMENT RECOVERY",
    "PromptPay protected",
    "Payment Recovery",
    "High-Risk Action",
    "CASH DRAWER CONTROL",
    "Server ตรวจเฉพาะรายการที่ขึ้น Cloud แล้ว",
    "Blind Count 2 รอบ",
    "AI Assessment"
  ]){
    assert.equal(orders.includes(phrase),false,"orders leaks "+phrase);
    assert.equal(close.includes(phrase),false,"close leaks "+phrase);
  }
  assert.match(orders,/เจ้าของร้าน · รายการรับเงินค้าง/);
  assert.match(orders,/ตรวจรายการรับเงินค้าง/);
  assert.match(close,/นับเงินสด 2 รอบโดยไม่ดูยอดระบบ/);
  assert.match(close,/เงินสดที่ควรมี/);
  assert.match(close,/ยืนยันรายการเงินสดจำนวนสูง/);
});

test("close-day review never renders internal evidence codes to the owner",async()=>{
  const close=await read("app/close/page.tsx");
  assert.doesNotMatch(close,/review\.evidence\.map\(\(x:any\)=>x\.code\)/);
  assert.match(close,/ตรวจประกอบจาก \{review\.evidence\.length\} ปัจจัย/);
});
