import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("close-day operator copy avoids engineering jargon while preserving explicit safety actions",async()=>{
  const ui=await read("app/close/page.tsx");
  for(const text of [
    "ระบบจะตรวจ request เดิมก่อน",
    "Server ยังไม่ยืนยัน",
    "ข้อมูล recovery ",
    "เก็บ request เดิมไว้",
    "Local Recovery ยังไม่เคลียร์",
    "มี Payment ค้าง",
    "Expected Drawer",
    "Cash Variance"
  ]) assert.equal(ui.includes(text),false,text);

  for(const text of [
    "มีรายการเงินสดเข้า/ออกก่อนหน้าที่ยังตรวจสอบไม่เสร็จ",
    "ห้ามกดซ้ำ",
    "มีการปิดวันครั้งก่อนที่ยังตรวจสอบไม่เสร็จ",
    "ห้ามกดปิดวันซ้ำ",
    "เงินสดที่ระบบคาด",
    "เงินสดที่นับได้",
    "ส่วนต่างเงินสด",
    "รายการรับชำระที่ต้องตรวจ"
  ]) assert.ok(ui.includes(text),text);
});

test("close-day still persists exact mutations and clears local evidence only after exact acknowledgement",async()=>{
  const ui=await read("app/close/page.tsx");
  const cashStart=ui.indexOf("async function sendCashMovement");
  const closeStart=ui.indexOf("async function sendCloseDay");
  const cashBlock=ui.slice(cashStart,closeStart);
  const closeBlock=ui.slice(closeStart,ui.indexOf("useEffect(()=>",closeStart));
  assert.ok(cashBlock.indexOf("cashMovementPendingWrite(body)")<cashBlock.indexOf('api<any>("/api/cash-shift/movements"'));
  assert.ok(cashBlock.indexOf("validateCashMovementAck(r,pending.body)")<cashBlock.indexOf("cashMovementPendingClear()"));
  assert.ok(closeBlock.indexOf("closeDayPendingWrite(body)")<closeBlock.indexOf('api<any>("/api/close-day"'));
  assert.ok(closeBlock.indexOf("validateCloseDayAck(r,pending.body)")<closeBlock.indexOf("closeDayPendingClear()"));
});

test("raw recovery identifiers and provider references are collapsed under admin details instead of dominating the close-day UI",async()=>{
  const ui=await read("app/close/page.tsx");
  assert.match(ui,/รายละเอียดสำหรับผู้ดูแล/);
  assert.match(ui,/<details className="mt-1 text-slate-500">/);
  assert.match(ui,/<details className="mt-2 text-slate-500">/);
  assert.match(ui,/p\.status==="requires_resolution"\?"ต้องตรวจสอบ":"กำลังรอผล"/);
  assert.match(ui,/บัตร \{p\.pager\|\|"—"\}/);
});
