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
  const durable=client.slice(client.indexOf("export async function sendExpenseDurably"),client.indexOf("export function expenseErrorText"));
  assert.ok(durable.indexOf("validateExpenseAck(response,pending.body)")<durable.indexOf("clearPendingExpense()"));
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


test("open Operations Hub stays live without forcing route changes",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  assert.match(hub,/if\(!open\)return/);
  assert.match(hub,/window\.setInterval/);
  assert.match(hub,/,5000\)/);
  assert.match(hub,/document\.visibilityState!=="hidden"/);
  assert.match(hub,/window\.addEventListener\("online",onOnline\)/);
  assert.match(hub,/window\.addEventListener\("focus",onFocus\)/);
  assert.match(hub,/document\.addEventListener\("visibilitychange",onVisible\)/);
  assert.match(hub,/document\.visibilityState==="visible"/);
  assert.match(hub,/recoverExpense\(\)\.catch/);
});

test("Hub loads all permitted data once but background refreshes only the active tab quietly",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  assert.match(hub,/async function refresh\(scope:HubTab\|"all"="all",quiet=false\)/);
  assert.match(hub,/canQueue&&\(scope==="all"\|\|scope==="queue"\)/);
  assert.match(hub,/canOrder&&\(scope==="all"\|\|scope==="orders"\)/);
  assert.match(hub,/canExpense&&\(scope==="all"\|\|scope==="expenses"\)/);
  assert.match(hub,/if\(!quiet\)\{setLoading\(true\);setMessage\(""\)\}/);
  assert.match(hub,/finally\{if\(!quiet\)setLoading\(false\)\}/);
  assert.match(hub,/refresh\("all",quiet\)/);
  assert.match(hub,/sync\(false\)/);
  assert.match(hub,/refresh\(activeTabRef\.current,true\)/);
  assert.match(hub,/onClick=\{\(\)=>refresh\(tab\)\}/);
  const timer=hub.slice(hub.indexOf("const timer=window.setInterval"),hub.indexOf('window.addEventListener("online"',hub.indexOf("const timer=window.setInterval")));
  assert.match(timer,/refresh\(activeTabRef\.current,true\)/);
  assert.doesNotMatch(timer,/refresh\("all"/);
});

test("switching Hub tabs refreshes the newly selected tab once without duplicating initial open fetch",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  const start=hub.indexOf("const changed=activeTabRef.current!==tab");
  const block=hub.slice(start,start+360);
  assert.match(block,/const changed=activeTabRef\.current!==tab/);
  assert.match(block,/activeTabRef\.current=tab/);
  assert.match(block,/if\(changed&&open&&!session\.offline\)refresh\(tab,true\)/);
});
