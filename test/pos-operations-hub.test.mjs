import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("POS exposes one in-place operations hub instead of forcing routine page switching",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/PosOperationsHub/);
  assert.match(pos,/setOpsOpen\(true\)/);
  assert.match(pos,/>งานร้าน<\/button>/);
  assert.match(pos,/bootstrap=\{data\}/);
  assert.match(pos,/open=\{opsOpen\}/);
});

test("operations hub covers queue orders stock and quick expenses in one dialog",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  assert.match(hub,/role="dialog"/);
  for(const label of ["คิว","ออเดอร์","สต็อก","รายจ่าย"])assert.match(hub,new RegExp(label));
  assert.match(hub,/\/api\/pos\/queue/);
  assert.match(hub,/\/api\/pos\/history/);
  assert.match(hub,/bootstrap\?\.menu/);
  assert.match(hub,/เพิ่มค่าใช้จ่ายด่วน/);
  assert.match(hub,/อยู่หน้า POS ต่อ/);
});

test("quick expense inside POS reuses the same durable expense client as the full Expenses page",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  const expenses=await read("app/expenses/page.tsx");
  const client=await read("lib/expense-client.ts");
  assert.match(hub,/sendExpenseDurably\(session\.csrf,body\)/);
  assert.match(hub,/readPendingExpense\(\)/);
  assert.match(expenses,/sendExpenseDurably\(session\.csrf,body\)/);
  assert.match(expenses,/readPendingExpense\(\)/);
  assert.match(client,/EXPENSE_PENDING_KEY/);
  assert.match(client,/writePendingExpense\(body\)/);
  assert.match(client,/validateExpenseAck\(response,pending\.body\)/);
  assert.ok(client.indexOf("writePendingExpense(body)")<client.indexOf("api<any>(\"/api/expenses\""));
  const durable=client.slice(client.indexOf("export async function sendExpenseDurably"),client.indexOf("export function expenseErrorText"));\n  assert.ok(durable.indexOf("validateExpenseAck(response,pending.body)")<durable.indexOf("clearPendingExpense()"));
});

test("hub is permission-aware and keeps full pages as optional fallbacks",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  assert.match(hub,/session\.user\.permissions\?\.queue===true/);
  assert.match(hub,/session\.user\.permissions\?\.order===true/);
  assert.match(hub,/session\.user\.permissions\?\.stock===true/);
  assert.match(hub,/session\.user\.permissions\?\.report===true/);
  for(const href of ["/queue","/orders","/stock","/expenses"])assert.match(hub,new RegExp('href="'+href.replaceAll("/","\\/")+'"'));
});

test("hub remains fail-safe offline and does not mutate queue or stock from the compact view",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  assert.match(hub,/OFFLINE · ดูสถานะจากข้อมูลเมนู\/สต็อกที่ cache ไว้ได้/);
  assert.match(hub,/disabled=\{expenseBusy\|\|session\.offline/);
  assert.doesNotMatch(hub,/method:"POST"[\s\S]{0,120}\/api\/pos\/queue/);
  assert.doesNotMatch(hub,/method:"POST"[\s\S]{0,120}\/api\/stock/);
});


test("Operations Hub is a mobile bottom sheet and desktop side drawer",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  assert.match(hub,/flex items-end bg-black\/30/);
  assert.match(hub,/max-h-\[88dvh\]/);
  assert.match(hub,/rounded-t-\[28px\]/);
  assert.match(hub,/sm:items-stretch sm:justify-end/);
  assert.match(hub,/sm:w-\[520px\]/);
  assert.match(hub,/event\.key==="Escape"/);
});

test("stock status counts use the full health set before display truncation",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  assert.match(hub,/const stockRows=stockHealth\.slice\(0,12\)/);
  assert.match(hub,/const outCount=stockHealth\.filter/);
  assert.match(hub,/lowCount=stockHealth\.filter/);
});

test("tab layout expands to the operator-visible tab count",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  assert.match(hub,/const visibleTabs=tabMeta\.filter\(x=>x\.allowed\)/);
  assert.match(hub,/gridTemplateColumns/);
  assert.match(hub,/visibleTabs\.length/);
});
