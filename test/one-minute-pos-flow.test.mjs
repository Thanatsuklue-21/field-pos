import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("novice payment flow reveals tender controls only after bill review",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.ok(pos.includes('const tenderUnlocked=reviewConfirmed||promptRecoveryActive'));
  assert.ok(pos.includes('const paymentStage=!tenderUnlocked?1:'));
  assert.ok(pos.includes('{tenderUnlocked&&<div className="mt-4 rounded-2xl bg-slate-100 p-1">'));
  assert.ok(pos.includes('{tenderUnlocked&&method==="cash"&&<>'));
  assert.ok(pos.includes('{tenderUnlocked&&<div className="sticky bottom-0'));
  assert.ok(pos.includes("ตอนนี้ทำแค่อย่างเดียว: ทวนบิล"));
});

test("pending PromptPay recovery can still show payment UI without forcing a second review",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.ok(pos.includes('const promptRecoveryActive=method==="promptpay"&&!!prompt'));
  assert.ok(pos.includes('const tenderUnlocked=reviewConfirmed||promptRecoveryActive'));
});

test("payment progress reflects the current task instead of static decoration",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.ok(pos.includes('active=paymentStage===step'));
  assert.ok(pos.includes('done=paymentStage>step'));
  assert.ok(pos.includes('[["1","ทวนรายการ"],["2","เลือกวิธีจ่าย"],["3","ยืนยันรับเงิน"]]'));
});

test("routine sale copy tells new cashiers they can ignore advanced options",async()=>{
  const pos=await read("app/pos/page.tsx"),coach=await read("components/operator-coach.tsx");
  assert.ok(pos.includes("ขายทั่วไปไม่ต้องเปิดส่วนนี้"));
  assert.ok(coach.includes("ขายปกติจำแค่ 3 อย่าง: เลือกเมนู → ทวนบิล → รับเงิน"));
  assert.ok(coach.includes("ขายทั่วไปไม่ต้องเปิด “ตัวเลือกเพิ่มเติม”"));
});

test("menu search has a clear action and never leaves a novice on a blank grid",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.ok(pos.includes('aria-label="ล้างคำค้นหา"'));
  assert.ok(pos.includes("ไม่พบเมนูตามที่ค้นหา"));
  assert.ok(pos.includes("ดูเมนูทั้งหมด"));
  assert.ok(pos.includes('setQ("");setCat("ทั้งหมด")'));
});

test("POS direct controls use touch-friendly sizing",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.ok(!pos.includes("h-9 w-9"));
  assert.ok(!pos.includes("min-h-9"));
});
