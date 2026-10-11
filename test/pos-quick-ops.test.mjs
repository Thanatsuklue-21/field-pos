import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("POS opens Quick Ops in-place instead of routing away for common checks",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/import PosQuickOps from "@\/components\/pos-quick-ops"/);
  assert.match(pos,/quickOpsOpen/);
  assert.match(pos,/setQuickOpsOpen\(true\)/);
  assert.match(pos,/>งานร้าน<\/button>/);
  assert.match(pos,/<PosQuickOps session=\{session\} open=\{quickOpsOpen\}/);
  const buttonStart=pos.indexOf('onClick={()=>setQuickOpsOpen(true)}');
  const buttonBlock=pos.slice(Math.max(0,buttonStart-250),buttonStart+450);
  assert.doesNotMatch(buttonBlock,/router\.push/);
});

test("Quick Ops keeps queue orders and expense on three focused tabs with full-page fallbacks",async()=>{
  const ui=await read("components/pos-quick-ops.tsx");
  for(const label of ["คิวตอนนี้","ออเดอร์ล่าสุด","รายจ่ายด่วน"])assert.match(ui,new RegExp(label));
  assert.match(ui,/api<any>\("\/api\/pos\/queue"\)/);
  assert.match(ui,/api<any>\("\/api\/pos\/history"\)/);
  assert.match(ui,/go\("\/queue"\)/);
  assert.match(ui,/go\("\/orders"\)/);
  assert.match(ui,/go\("\/expenses"\)/);
  assert.match(ui,/งานร้านโดยไม่ออกจาก POS/);
});

test("Quick expense reuses the same durable client contract as the full Expenses page",async()=>{
  const quick=await read("components/pos-quick-ops.tsx");
  const expenses=await read("app/expenses/page.tsx");
  const client=await read("lib/expense-client.ts");
  assert.match(quick,/sendExpenseDurably\(session\.csrf,body\)/);
  assert.match(expenses,/sendExpenseDurably\(session\.csrf,body\)/);
  assert.match(quick,/readPendingExpense\(\)/);
  assert.match(expenses,/readPendingExpense\(\)/);
  assert.match(client,/EXPENSE_PENDING_KEY/);
  assert.match(client,/validateExpenseAck\(response,pending\.body\)/);
  assert.ok(client.indexOf("validateExpenseAck(response,pending.body)")<client.indexOf("clearPendingExpense()"));
});

test("Quick Ops preserves transaction and offline safety",async()=>{
  const pos=await read("app/pos/page.tsx");
  const quick=await read("components/pos-quick-ops.tsx");
  assert.match(pos,/disabled=\{busy\|\|payOpen\} onClick=\{\(\)=>setQuickOpsOpen\(true\)\}/);
  assert.match(pos,/writeBlocked=\{busy\|\|payOpen\}/);
  assert.match(quick,/disabled=\{session\.offline\|\|writeBlocked\|\|expenseBusy/);
  assert.match(quick,/Quick Ops ใช้ข้อมูล Cloud/);
  assert.match(quick,/session\.offline\|\|expenseRecoveryRef\.current/);
});

test("Quick Ops uses a mobile bottom sheet and desktop side drawer without replacing the POS page",async()=>{
  const ui=await read("components/pos-quick-ops.tsx");
  assert.match(ui,/fixed inset-0 z-\[90\]/);
  assert.match(ui,/absolute inset-x-0 bottom-0/);
  assert.match(ui,/sm:static sm:h-full/);
  assert.match(ui,/sm:w-\[430px\]/);
  assert.match(ui,/soft-scroll/);
  assert.match(ui,/max-h-\[88dvh\]/);
});

test("shared expense business date remains explicitly Asia Bangkok",async()=>{
  const client=await read("lib/expense-client.ts");
  assert.match(client,/timeZone:"Asia\/Bangkok"/);
  assert.match(client,/currentBusinessDate/);
  const expenses=await read("app/expenses/page.tsx");
  const quick=await read("components/pos-quick-ops.tsx");
  assert.match(expenses,/date:currentBusinessDate\(\)/);
  assert.match(quick,/date:currentBusinessDate\(\)/);
});
