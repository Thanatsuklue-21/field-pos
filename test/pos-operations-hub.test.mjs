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

test("quick expense inside POS reuses one shared durable expense client",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  const expenses=await read("app/expenses/page.tsx");
  const client=await read("lib/expense-client.ts");
  const send=client.slice(client.indexOf("export async function sendExpenseDurably"));
  assert.match(hub,/readPendingExpense\(\)/);
  assert.match(hub,/sendExpenseDurably\(session\.csrf,pending\.body\)/);
  assert.match(hub,/sendExpenseDurably\(session\.csrf,body\)/);
  assert.match(expenses,/sendExpenseDurably\(session\.csrf,body\)/);
  assert.match(send,/writePendingExpense\(body\)/);
  assert.match(send,/body:JSON\.stringify\(pending\.body\)/);
  assert.match(send,/validateExpenseAck\(response,pending\.body\)/);
  assert.ok(send.indexOf("writePendingExpense(body)")<send.indexOf('api<any>("/api/expenses"'));
  assert.ok(send.indexOf("validateExpenseAck(response,pending.body)")<send.indexOf("clearPendingExpense()"));
  assert.doesNotMatch(hub,/EXPENSE_PENDING_KEY/);
  assert.doesNotMatch(hub,/function expensePendingWrite/);
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


test("hub behaves as a mobile bottom sheet and desktop side drawer without route switching",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  assert.match(hub,/fixed inset-0 z-\[90\] bg-black\/35/);
  assert.match(hub,/absolute inset-x-0 bottom-0 flex h-\[88dvh\]/);
  assert.match(hub,/rounded-t-\[28px\]/);
  assert.match(hub,/sm:inset-y-0/);
  assert.match(hub,/sm:w-\[520px\]/);
  assert.match(hub,/sm:rounded-none/);
  assert.match(hub,/overscroll-contain/);
});

test("open hub stays fresh on timer reconnect focus and foreground and closes with Escape",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  assert.match(hub,/if\(!open\)return/);
  assert.match(hub,/window\.setInterval\(\(\)=>refresh\(\)\.catch\(\(\)=>\{\}\),5000\)/);
  assert.match(hub,/window\.addEventListener\("online",onOnline\)/);
  assert.match(hub,/window\.addEventListener\("focus",onFocus\)/);
  assert.match(hub,/document\.addEventListener\("visibilitychange",onVisible\)/);
  assert.match(hub,/document\.visibilityState==="visible"/);
  assert.match(hub,/event\.key==="Escape"/);
  assert.match(hub,/window\.removeEventListener\("keydown",onKey\)/);
});

test("shared expense client owns Bangkok business date for both full and in-POS writers",async()=>{
  const client=await read("lib/expense-client.ts");
  const hub=await read("components/pos-operations-hub.tsx");
  const expenses=await read("app/expenses/page.tsx");
  assert.match(client,/timeZone:"Asia\/Bangkok"/);
  assert.match(client,/export function currentBusinessDate/);
  assert.match(hub,/date:currentBusinessDate\(\)/);
  assert.match(expenses,/date:currentBusinessDate\(\)/);
});
