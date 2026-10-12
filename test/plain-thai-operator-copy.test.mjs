import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("primary cashier flow uses plain Thai wording",async()=>{
  const pos=await read("app/pos/page.tsx");
  for(const text of [
    "ขายหน้าร้าน","รับออเดอร์","รายการที่กำลังขาย","ชำระเงิน",
    "สร้าง QR พร้อมเพย์","ยืนยันออเดอร์เดลิเวอรี","บันทึกเงินสดออฟไลน์","ยืนยันรับเงิน"
  ]) assert.ok(pos.includes(text),text);
  for(const text of [
    "POINT OF SALE","FIELD DRINKS","CURRENT ORDER","WAITING FOR PAYMENT...",
    "CREATE QR / PAY","CONFIRM DELIVERY ORDER","SAVE OFFLINE CASH","CONFIRM PAYMENT"
  ]) assert.ok(!pos.includes(text),text);
});

test("operator shell and work hub keep offline and daily guidance in Thai",async()=>{
  const shell=await read("components/app-shell.tsx");
  const hub=await read("components/pos-operations-hub.tsx");
  assert.ok(shell.includes("ออฟไลน์ · รับเงินสดเท่านั้น"));
  assert.ok(shell.includes("กำลังกลับหน้าขาย"));
  assert.ok(hub.includes("งานร้าน FIELD"));
  assert.ok(!shell.includes("OFFLINE MODE · CASH ONLY"));
  assert.ok(!hub.includes("FIELD OPERATIONS"));
});
