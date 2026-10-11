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

test("quick expense inside POS reuses the durable expense recovery contract",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  assert.match(hub,/EXPENSE_PENDING_KEY/);
  assert.match(hub,/validatePendingExpense/);
  assert.match(hub,/shouldRetainExpensePending/);
  assert.match(hub,/validateExpenseAck/);
  const start=hub.indexOf("async function sendExpense");
  const end=hub.indexOf("function expenseError",start);
  const block=hub.slice(start,end);
  assert.ok(block.indexOf("expensePendingWrite(body)")<block.indexOf('api<any>("/api/expenses"'));
  assert.ok(block.indexOf("validateExpenseAck(r,pending.body)")<block.indexOf("expensePendingClear()"));
  assert.match(block,/JSON\.stringify\(pending\.body\)/);
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
