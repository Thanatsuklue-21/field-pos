import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("open and close day use guided in-app confirmations instead of browser confirm",async()=>{
  const ui=await read("app/close/page.tsx");
  assert.doesNotMatch(ui,/window\.confirm/);
  assert.match(ui,/open-shift-review-title/);
  assert.match(ui,/close-day-review-title/);
  assert.match(ui,/ตรวจอีกครั้งก่อนเปิดร้าน/);
  assert.match(ui,/ขั้นตอนสุดท้าย/);
  assert.match(ui,/ยืนยันเปิดร้าน/);
  assert.match(ui,/ยืนยันปิดวัน/);
});

test("open shift review persists identity only after final in-app confirmation",async()=>{
  const ui=await read("app/close/page.tsx");
  const openStart=ui.indexOf("async function openShift()");
  const confirmStart=ui.indexOf("async function confirmOpenShift()",openStart);
  const openBlock=ui.slice(openStart,confirmStart);
  const confirmBlock=ui.slice(confirmStart,ui.indexOf("function movementError",confirmStart));
  assert.match(openBlock,/setOpenShiftReview\(\{date:businessDate,openingCash:opening\}\)/);
  assert.doesNotMatch(openBlock,/prepareCashShiftOpenIntent/);
  assert.match(confirmBlock,/readCashShiftOpenIntent/);
  assert.match(confirmBlock,/businessDate!==candidate\.date\|\|currentOpening!==candidate\.openingCash\|\|shift/);
  assert.ok(confirmBlock.indexOf("prepareCashShiftOpenIntent")<confirmBlock.indexOf("submitOpenShiftIntent"));
});

test("close day guided review keeps first and final device preflight separated by human confirmation",async()=>{
  const ui=await read("app/close/page.tsx");
  const closeStart=ui.indexOf("async function close()");
  const confirmStart=ui.indexOf("async function confirmCloseDay()",closeStart);
  const closeBlock=ui.slice(closeStart,confirmStart);
  const confirmBlock=ui.slice(confirmStart,ui.indexOf("const movementAmountNumber",confirmStart));
  assert.match(closeBlock,/const local=await refreshDevicePreflight\(\)/);
  assert.match(closeBlock,/setCloseDayReview\(\{/);
  assert.doesNotMatch(closeBlock,/prepareCloseDayWriteIntent/);
  assert.match(confirmBlock,/const finalLocal=await refreshDevicePreflight\(\)/);
  assert.match(confirmBlock,/review\.id\)!==candidate\.reviewId/);
  assert.ok(confirmBlock.indexOf("finalLocal=await refreshDevicePreflight()")<confirmBlock.indexOf("prepareCloseDayWriteIntent"));
});

test("guided close review explains irreversible accounting effects with touch-sized actions",async()=>{
  const ui=await read("app/close/page.tsx");
  assert.match(ui,/หลังยืนยัน ระบบจะปิดวันและล็อกผลกระทบยอดวันนี้/);
  assert.match(ui,/รายการ Offline \/ รับเงิน \/ Stock \/ Refund ค้างใหม่/);
  assert.match(ui,/เงินทอนตั้งต้น/);
  assert.match(ui,/จำนวนนี้ไม่ใช่ยอดขาย/);
  assert.match(ui,/data-open-shift-confirm/);
  assert.match(ui,/data-close-day-confirm/);
  assert.match(ui,/min-h-12/);
});
