import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("POS exposes one in-place operations hub instead of forcing routine page switching",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/PosOperationsHub/);
  assert.match(pos,/setOpsOpen\(true\)/);
  assert.match(pos,/คิว \/ งานร้าน/);
  assert.match(pos,/setOpsInitialTab\(undefined\);setOpsOpen\(true\)/);
  assert.match(pos,/bootstrap=\{data\}/);
  assert.match(pos,/open=\{opsOpen\}/);
  assert.match(pos,/networkOnline=\{online\}/);
});

test("operations hub covers queue orders stock and quick expenses in one dialog",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  assert.match(hub,/role="dialog"/);
  for(const label of ["วันนี้","คิว","ออเดอร์","สต็อก","รายจ่าย"])assert.match(hub,new RegExp(label));
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

test("hub remains fail-safe offline and routes queue mutations through the shared durable sender",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  const queueClient=await read("lib/queue-client.ts");
  assert.match(hub,/OFFLINE · ดูสถานะจากข้อมูลเมนู\/สต็อกที่ cache ไว้ได้/);
  assert.match(hub,/const cloudAvailable=networkOnline&&!session\.offline/);
  assert.match(hub,/if\(!cloudAvailable\).*OFFLINE/s);
  assert.match(hub,/disabled=\{expenseBusy\|\|!cloudAvailable/);
  assert.match(hub,/sendQueueActionDurably\(session\.csrf,body\)/);
  assert.match(hub,/readPendingQueueAction\(\)/);
  assert.doesNotMatch(hub,/api<any>\("\/api\/pos\/queue"[^\n]*method:"POST"/);
  assert.doesNotMatch(hub,/method:"POST"[\s\S]{0,120}\/api\/stock/);
  assert.match(queueClient,/writePendingQueueAction\(body\)/);
  assert.match(queueClient,/validateQueueActionAck\(result,pending\.body\)/);
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

test("stock health recomputes when local projected menu changes without a server revision bump",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  assert.match(hub,/\},\[bootstrap\?\.menu\]\);/);
  assert.doesNotMatch(hub,/\},\[bootstrap\?\.revision\]\);/);
});

test("stock health ignores products disabled from the selling surface",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  assert.match(hub,/\(bootstrap\?\.menu\|\|\[\]\)\.filter\(x=>x\.enabled\)/);
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
  assert.match(block,/if\(changed&&open&&cloudAvailable\)refresh\(tab,true\)/);
});


test("stock tab refreshes authoritative POS bootstrap instead of becoming stale",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  const pos=await read("app/pos/page.tsx");
  assert.match(hub,/onRefreshStock\?:\(\)=>Promise<unknown>/);
  assert.match(hub,/canStock&&\(scope==="all"\|\|scope==="stock"\)&&onRefreshStock/);
  assert.match(hub,/tasks\.push\(onRefreshStock\(\)\);names\.push\("stock"\)/);
  assert.match(pos,/onRefreshStock=\{\(\)=>load\(true\)\}/);
  const timer=hub.slice(hub.indexOf("const timer=window.setInterval"),hub.indexOf('window.addEventListener("online"',hub.indexOf("const timer=window.setInterval")));
  assert.match(timer,/refresh\(activeTabRef\.current,true\)/);
});

test("Operations Hub blocks cloud polling and quick expense writes when the device network is offline",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/networkOnline=\{online\}/);
  assert.match(hub,/const cloudAvailable=networkOnline&&!session\.offline/);
  assert.match(hub,/if\(!cloudAvailable\)\{if\(!quiet\)setMessage/);
  assert.match(hub,/if\(!canExpense\|\|!cloudAvailable\|\|expenseRecoveryRef\.current\)return/);
  assert.match(hub,/if\(!cloudAvailable\)return/);
  assert.match(hub,/expenseBusy\|\|!cloudAvailable\|\|!/);
});


test("post-sale queue action stays inside POS and opens the Hub on Queue context",async()=>{
  const pos=await read("app/pos/page.tsx");
  const hub=await read("components/pos-operations-hub.tsx");
  const saleStart=pos.indexOf("lastSale&&");
  const saleBlock=pos.slice(saleStart,pos.indexOf("<PosOperationsHub",saleStart));
  assert.match(pos,/const \[opsInitialTab,setOpsInitialTab\]=useState<HubTab\|undefined>\(undefined\)/);
  assert.match(saleBlock,/setOpsInitialTab\("queue"\);setLastSale\(null\);setOpsOpen\(true\)/);
  assert.doesNotMatch(saleBlock,/router\.push\("\/queue"\)/);
  assert.match(pos,/initialTab=\{opsInitialTab\}/);
  assert.match(hub,/initialTab\?:HubTab/);
  assert.match(hub,/initialTab&&availableTabs\.includes\(initialTab\)\?initialTab:availableTabs\[0\]/);
  const initialEffect=hub.slice(hub.indexOf("const requested=initialTab"),hub.indexOf("useEffect(()=>{",hub.indexOf("const requested=initialTab")+1));
  assert.ok(initialEffect.includes('[open,initialTab,availableTabs.join("|")]'));
  assert.ok(!initialEffect.includes('availableTabs.join("|"),tab'));
});


test("post-sale queue shortcut is shown only to operators with Queue permission",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/const canQueueOps=session\.user\.role==="admin"\|\|session\.user\.permissions\?\.queue===true/);
  const saleStart=pos.indexOf("lastSale&&");
  const saleBlock=pos.slice(saleStart,pos.indexOf("<PosOperationsHub",saleStart));
  assert.match(saleBlock,/!lastSale\.offline&&canQueueOps\?<><button/);
  assert.match(saleBlock,/ไปทำคิว \{lastSale\.queueNo\}/);
  assert.match(saleBlock,/setOpsInitialTab\("queue"\);setLastSale\(null\);setOpsOpen\(true\)/);
});


test("Operations Hub tabs follow keyboard roving-tab semantics without extra page navigation",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  assert.match(hub,/aria-orientation="horizontal"/);
  assert.match(hub,/tabIndex=\{tab===key\?0:-1\}/);
  assert.match(hub,/aria-controls=\{"field-operations-panel-"\+key\}/);
  assert.match(hub,/role="tabpanel"/);
  assert.match(hub,/aria-labelledby=\{"field-operations-tab-"\+tab\}/);
  assert.match(hub,/event\.key==="ArrowRight"\|\|event\.key==="ArrowDown"/);
  assert.match(hub,/event\.key==="ArrowLeft"\|\|event\.key==="ArrowUp"/);
  assert.match(hub,/event\.key==="Home"/);
  assert.match(hub,/event\.key==="End"/);
  assert.match(hub,/window\.requestAnimationFrame\(\(\)=>tabRefs\.current\[next\]\?\.focus\(\)\)/);
});


test("Queue tab offers one-state-at-a-time quick actions without leaving POS",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  assert.match(hub,/async function runQuickQueueAction\(order:QueueOrder\)/);
  assert.match(hub,/action:"complete_item"/);
  assert.match(hub,/expectedReadyQty:n\(item\.readyQty\)/);
  assert.match(hub,/action:"call"/);
  assert.match(hub,/action:"return"/);
  assert.match(hub,/const productionHead=queueSorted\.find\(order=>\(order\.items\|\|\[\]\)\.some\(item=>n\(item\.calledQty\)<n\(item\.qty\)\)\)\|\|null/);
  assert.match(hub,/const allCalled=total>0&&called>=total,isProduction=productionHead\?\.id===order\.id/);
  assert.match(hub,/const quick=\(isProduction\|\|allCalled\)\?quickQueueStep\(order\):null/);
  assert.match(hub,/Server บังคับ FIFO/);
  assert.match(hub,/รอลูกค้ารับ/);
  assert.match(hub,/เปิดหน้าคิวเต็ม \/ งานผลิตละเอียด/);
});

test("Operations Hub recovers queue mutations from either Queue page or POS using the same pending key",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  const queue=await read("app/queue/page.tsx");
  const client=await read("lib/queue-client.ts");
  assert.match(hub,/recoverQueueAction\(\)\.catch/);
  assert.match(hub,/readPendingQueueAction\(\)/);
  assert.match(queue,/readPendingQueueAction\(\)/);
  assert.match(queue,/sendQueueActionDurably\(session\.csrf,body\)/);
  assert.match(client,/QUEUE_PENDING_KEY/);
  assert.match(client,/sendQueueActionDurably/);
});

test("quick Queue action is disabled when cloud is unavailable or another queue action is resolving",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  assert.match(hub,/if\(queueBusy\|\|!cloudAvailable\)return/);
  assert.match(hub,/disabled=\{queueBusy\|\|!cloudAvailable\}/);
  assert.match(hub,/queueRecoveryRef\.current/);
});


test("next quick Queue tap reconciles an ambiguous existing request instead of creating a new key",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  const start=hub.indexOf("async function runQuickQueueAction");
  const end=hub.indexOf("function quickQueueStep",start);
  const block=hub.slice(start,end);
  assert.match(block,/if\(readPendingQueueAction\(\)\)\{await recoverQueueAction\(\);return\}/);
  assert.ok(block.indexOf("readPendingQueueAction()")<block.indexOf("crypto.randomUUID()"));
});


test("quick Queue shows the current menu recipe per cup without aggregating grams across menus",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  assert.match(hub,/type QueueRecipeUse=/);
  assert.match(hub,/prepGroups\?:QueuePrepGroup\[\]/);
  assert.match(hub,/recipeUsage\?:QueueRecipeUse\[\]/);
  assert.match(hub,/หมวดเบส:/);
  assert.match(hub,/สูตรต่อแก้ว:/);
  assert.match(hub,/row\.name\+" "\+row\.perCup\+" "\+row\.unit/);
  const recipeStart=hub.indexOf("สูตรต่อแก้ว:");
  const recipeBlock=hub.slice(recipeStart,recipeStart+700);
  assert.ok(recipeStart>=0);
  assert.doesNotMatch(recipeBlock,/reduce\(/);
});


test("quick Queue action labels the remaining cups rather than the original item quantity",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  assert.match(hub,/remaining=Math\.max\(0,n\(item\.qty\)-n\(item\.readyQty\)\)/);
  assert.match(hub,/remaining>1\?" · อีก "\+remaining\+" แก้ว"/);
  assert.doesNotMatch(hub,/n\(item\.qty\)>1\?" ×"\+n\(item\.qty\)/);
});


test("Quick Queue offers WASTE remake only for the current production item and confirms stock impact",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  assert.match(hub,/async function runQuickWasteRemake\(order:QueueOrder,itemIndex:number\)/);
  assert.match(hub,/window\.confirm\("บันทึก “ชงเสีย \/ ทำใหม่”/);
  assert.match(hub,/หักวัตถุดิบเพิ่มตามสูตรที่ใช้ตอนขาย และลงค่าใช้จ่าย WASTE อัตโนมัติ/);
  assert.match(hub,/action:"waste_remake"/);
  assert.match(hub,/reason:"ชงเสีย \/ ทำใหม่"/);
  assert.match(hub,/sendQueueActionDurably\(session\.csrf,\{/);
  assert.match(hub,/isProduction&&nextItem&&<button/);
  assert.match(hub,/runQuickWasteRemake\(order,nextIndex\)/);
});

test("Quick WASTE reconciles any ambiguous queue request before generating a new request key",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  const start=hub.indexOf("async function runQuickWasteRemake");
  const end=hub.indexOf("function quickQueueStep",start);
  const block=hub.slice(start,end);
  assert.match(block,/if\(readPendingQueueAction\(\)\)\{await recoverQueueAction\(\);return\}/);
  assert.ok(block.indexOf("readPendingQueueAction()")<block.indexOf("crypto.randomUUID()"));
  assert.match(block,/ผล WASTE ยังไม่ชัดเจน/);
});

test("Quick WASTE exposes waste cost and actionable recipe or stock failures without leaving POS",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  const client=await read("lib/queue-client.ts");
  assert.match(hub,/result\?\.wasteCost/);
  assert.match(hub,/ต้นทุนของเสีย ฿/);
  assert.match(client,/waste_after_call_not_supported/);
  assert.match(client,/recipe_unavailable/);
  assert.match(client,/code\.startsWith\("stock_shortage:"\)/);
  assert.match(client,/code\.startsWith\("ingredient_missing:"\)/);
});


test("Today tab keeps daily status inside POS without moving close-day mutation into the drawer",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  assert.match(hub,/type TodaySummary=/);
  assert.match(hub,/type CloseStatus=/);
  assert.match(hub,/\/api\/management\/dashboard/);
  assert.match(hub,/\/api\/close-day/);
  assert.match(hub,/ยอดขายวันนี้/);
  assert.match(hub,/ออเดอร์วันนี้/);
  assert.match(hub,/ยังปิดวันไม่ได้/);
  assert.match(hub,/คิวค้าง/);
  assert.match(hub,/ชำระค้าง/);
  assert.match(hub,/href="\/close"/);
  assert.doesNotMatch(hub,/api<any>\("\/api\/close-day"[^\n]*method:"POST"/);
});

test("report-capable operators see Today first so routine status does not require Dashboard navigation",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  assert.match(hub,/canReport&&"today",canQueue&&"queue"/);
  assert.match(hub,/\{key:"today",label:"วันนี้"/);
  assert.match(hub,/if\(name==="todaySummary"\)setTodaySummary/);
  assert.match(hub,/if\(name==="closeStatus"\)setCloseStatus/);
});
