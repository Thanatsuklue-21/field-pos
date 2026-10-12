import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("cashier safety alerts use plain Thai instead of system jargon",async()=>{
  const pos=await read("app/pos/page.tsx");
  for(const text of [
    "ต้องตรวจรายการชำระเดิมก่อนรับเงินใหม่",
    "หยุดรับเงินชั่วคราว",
    "ตรวจออเดอร์ล่าสุด",
    "ตรวจแล้ว · ล้างข้อมูลค้างในเครื่อง",
    "ต้องตรวจสต็อก",
    "เลขออเดอร์ระบบ",
    "ตรวจประวัติสต็อกและนับของจริงก่อนยืนยัน",
    "พักบิล"
  ]) assert.match(pos,new RegExp(text));
  for(const old of ["CRITICAL ·","FAIL CLOSED","STOCK CHECK","HOLD BILL"])
    assert.doesNotMatch(pos,new RegExp(old));
});

test("plain-language alerts do not change payment recovery state handling",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/recoveryIntegrityIssue&&/);
  assert.match(pos,/clearCorruptRecovery/);
  assert.match(pos,/cashRecoveryReview&&/);
  assert.match(pos,/acknowledgeStockReview\(review\.requestKey\)/);
  assert.match(pos,/setOpsInitialTab\("orders"\)/);
  assert.match(pos,/setOpsInitialTab\("stock"\)/);
});
