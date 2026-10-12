import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("POS gives a visible three-step selling flow without adding navigation",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/const guideStep=payOpen\?3:cartQty>0\?2:1/);
  assert.match(pos,/เลือกเมนู/);
  assert.match(pos,/ตรวจรายการ/);
  assert.match(pos,/รับชำระ/);
  assert.match(pos,/aria-label="ขั้นตอนการขาย"/);
  assert.match(pos,/role="status"/);
  assert.doesNotMatch(pos,/router\.push\([^\n]*guideStep/);
});

test("primary novice-facing POS actions use plain Thai wording",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/ตรวจรายการ \/ ชำระเงิน/);
  assert.match(pos,/ออเดอร์ปัจจุบัน/);
  assert.match(pos,/เลือกระดับความหวาน \/ สูตร/);
  assert.match(pos,/รับชำระเงิน ฿/);
  assert.match(pos,/ยอดรวม/);
});

test("guide advances only from real order and payment state",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/const cartQty=cart\.items\.reduce/);
  assert.match(pos,/const guideStep=payOpen\?3:cartQty>0\?2:1/);
  assert.match(pos,/guideStep===1\?"เลือกเครื่องดื่มจากรายการด้านล่าง"/);
  assert.match(pos,/guideStep===2\?"ตรวจรายการให้ถูกต้อง/);
  assert.match(pos,/รับชำระเงินตามยอด แล้วระบบจะออกคิวให้อัตโนมัติ/);
});

test("guided flow preserves existing durable checkout entry point",async()=>{
  const pos=await read("app/pos/page.tsx");
  const matches=[...pos.matchAll(/onClick=\{openPayment\}/g)];
  assert.ok(matches.length>=2);
  assert.match(pos,/function openPayment\(\)/);
  assert.match(pos,/paymentRecoveryIntegrityIssue\(\)/);
  assert.match(pos,/cartAvailability/);
});
