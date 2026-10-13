import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("new operator sees one guided sales path instead of the full back office",async()=>{
  const shell=await read("components/app-shell.tsx"),coach=await read("components/operator-coach.tsx"),pos=await read("app/pos/page.tsx");
  assert.ok(shell.includes('const primaryMobile=["/pos"]'));
  assert.ok(shell.includes("เมนูอื่น"));
  assert.ok(coach.includes("คู่มือ 1 นาที"));
  assert.ok(coach.includes("เลือกเมนู → ทวนบิล → รับเงิน"));
  assert.ok(pos.includes("คิว / งานร้าน"));
});

test("ordinary payment exposes cash and QR first while preserving advanced methods",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.ok(pos.includes("ขายทั่วไปใช้ 2 ปุ่มนี้"));
  assert.ok(pos.includes("วิธีอื่น · โอน / บัตร / เดลิเวอรี"));
  for(const method of ["เงินสด","QR พร้อมเพย์","โอนธนาคาร","บัตร","เดลิเวอรี"])assert.ok(pos.includes(method));
});

test("single operator is guided into FIFO production after successful online payment",async()=>{
  const pos=await read("app/pos/page.tsx"),guide=await read("lib/pos-guidance.mjs");
  assert.ok(pos.includes("ไปทำคิว {lastSale.queueNo}"));
  assert.ok(pos.includes("รับออเดอร์ถัดไปก่อน"));
  assert.ok(pos.includes("ทำคิวนี้ก่อนตาม FIFO"));
  assert.ok(guide.includes('actionLabel:canQueue?"ไปทำคิว "'));
});
