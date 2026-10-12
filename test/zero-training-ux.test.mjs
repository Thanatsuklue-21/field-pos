import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=path=>readFile(new URL("../"+path,import.meta.url),"utf8");

test("POS exposes a three-step zero-training sales flow",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/const guidedStep=payOpen\?3:cart\.items\.length\?2:1/);
  assert.match(pos,/เลือกเมนู/);
  assert.match(pos,/ตรวจรายการ/);
  assert.match(pos,/รับเงิน/);
  assert.match(pos,/ระบบจะตรวจสต็อกให้อัตโนมัติ/);
  assert.match(pos,/ไปชำระเงิน/);
});

test("primary checkout stays focused on cash and PromptPay",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/ตัวเลือกเพิ่มเติม · แยกบิล \/ สมาชิก \/ ช่องทางอื่น/);
  assert.match(pos,/showMorePayment&&customers\.length>0/);
  assert.match(pos,/showMorePayment&&selectedCustomer&&redeemValue>0/);
  assert.match(pos,/showMorePayment&&<div className="mt-2 grid grid-cols-3/);
  assert.match(pos,/>เงินสด<\/button>/);
  assert.match(pos,/>PromptPay/);
});

test("cash checkout provides fast tender choices and human-readable CTA",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/const cashPresets=\[50,100,500,1000\]/);
  assert.match(pos,/รับเงินมาเท่าไร/);
  assert.match(pos,/รับ ฿\{amount\}/);
  assert.match(pos,/ยืนยันรับเงิน ฿/);
  assert.match(pos,/สร้าง QR เพื่อรับเงิน ฿/);
});

test("fresh payment opening cannot inherit hidden advanced payment state",async()=>{
  const pos=await read("app/pos/page.tsx");
  const start=pos.indexOf("function openPayment()");
  const end=pos.indexOf("\n\n  return <section",start);
  assert.ok(start>0&&end>start);
  const openPayment=pos.slice(start,end);
  assert.match(openPayment,/setMethod\("cash"\)/);
  assert.match(openPayment,/setReceived\(""\)/);
  assert.match(openPayment,/setManualPaymentReference\(""\)/);
  assert.match(openPayment,/setCustomerId\(""\)/);
  assert.match(openPayment,/setPointsRedeemed\(0\)/);
  assert.match(openPayment,/setSplitBill\(false\)/);
  assert.match(openPayment,/setShowMorePayment\(false\)/);
});

test("unexpected server codes are not shown raw to shop staff",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/ระบบยังทำรายการนี้ไม่ได้ กรุณาตรวจ Orders/);
  assert.doesNotMatch(pos,/promptpay_zero_total"[\s\S]{0,180}:\s*\n\s*code;/);
});

test("mobile navigation is limited to the core operating workflow",async()=>{
  const shell=await read("components/app-shell.tsx");
  assert.match(shell,/\["\/pos","\/queue","\/orders","\/close","\/settings"\]/);
  assert.doesNotMatch(shell,/\["\/pos","\/queue","\/stock","\/expenses","\/close","\/orders","\/settings"\]/);
});
