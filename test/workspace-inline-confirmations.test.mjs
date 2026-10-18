import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("daily workspace no longer uses browser-native confirms for routine operator actions",async()=>{
  const ui=await read("components/pos-daily-workspace.tsx");
  assert.doesNotMatch(ui,/window\.confirm/);
  assert.match(ui,/role="alertdialog" aria-label="ยืนยันชงเสียและทำใหม่"/);
  assert.match(ui,/role="alertdialog" aria-label="ยืนยันเงินตั้งต้นเปิดร้าน"/);
});

test("waste confirmation is bound to the exact current queue item before stock mutation",async()=>{
  const ui=await read("components/pos-daily-workspace.tsx");
  assert.match(ui,/wasteConfirm.*orderId:string;itemIndex:number;itemId:string;itemName:string/);
  assert.match(ui,/wasteConfirm\.orderId===order\.id/);
  assert.match(ui,/wasteConfirm\.itemIndex===currentPrepTask\.index/);
  assert.match(ui,/wasteConfirm\.itemId===String\(currentPrepTask\.item\.id\|\|""\)/);
  assert.match(ui,/ระบบจะหักวัตถุดิบเพิ่มตามสูตร บันทึก WASTE/);
  assert.match(ui,/runQueueProductionAction\(order,currentPrepTask\.item,currentPrepTask\.index,"waste_remake"\)\.finally\(\(\)=>setWasteConfirm\(null\)\)/);
});

test("start-day confirmation stages and revalidates opening cash before durable intent creation",async()=>{
  const ui=await read("components/pos-daily-workspace.tsx");
  assert.match(ui,/setStartDayConfirmAmount\(amount\)/);
  assert.match(ui,/async function confirmStartDay\(\)/);
  const start=ui.indexOf("async function confirmStartDay");
  const end=ui.indexOf("function quickExpenseError",start);
  const block=ui.slice(start,end);
  assert.match(block,/readCashShiftOpenIntent\(session\.user\.id\)/);
  assert.match(block,/const date=String\(expenseData\?\.businessDate\|\|""\)/);
  assert.match(block,/const amount=Number\(startDayConfirmAmount\)/);
  assert.match(block,/prepareCashShiftOpenIntent/);
  assert.ok(block.indexOf("readCashShiftOpenIntent")<block.indexOf("prepareCashShiftOpenIntent"));
  assert.match(ui,/ยอดนี้จะถูกล็อกสำหรับกระทบยอดทั้งวัน/);
  assert.match(ui,/>กลับไปแก้ยอด<\/button>/);
  assert.match(ui,/>ยืนยันเปิดร้าน<\/button>/);
});

test("closing the workspace discards only staged UI confirmations, never durable recovery intents",async()=>{
  const ui=await read("components/pos-daily-workspace.tsx");
  const start=ui.indexOf("if(!open){");
  const block=ui.slice(start,start+350);
  assert.match(block,/setWasteConfirm\(null\)/);
  assert.match(block,/setStartDayConfirmAmount\(null\)/);
  assert.doesNotMatch(block,/clearExpenseIntent|clearCashShiftOpenIntent|localStorage\.removeItem/);
});
