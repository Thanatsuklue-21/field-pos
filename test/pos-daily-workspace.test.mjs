import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {chooseWorkspaceNextAction} from "../lib/workspace-guidance.mjs";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("POS opens the daily workspace in-place and blocks it during payment mutation",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/PosDailyWorkspace/);
  assert.match(pos,/const openWorkspace=\(\)=>\{setWorkspaceMounted\(true\);setWorkspaceOpen\(true\)\}/);
  assert.match(pos,/workspaceMounted&&<PosDailyWorkspace/);
  assert.match(pos,/>งานร้าน<\/button>/);
  assert.match(pos,/disabled=\{busy\|\|payOpen\}/);
  assert.match(pos,/bootstrap=\{data\}/);
  assert.match(pos,/online=\{online\}/);
});

test("daily workspace covers queue orders stock quick expense and owner readiness",async()=>{
  const hub=await read("components/pos-daily-workspace.tsx");
  assert.match(hub,/FIELD · งานวันนี้/);
  for(const label of ["คิว","ออเดอร์","สต็อก","รายจ่าย","สถานะ"])assert.match(hub,new RegExp(label));
  assert.match(hub,/\/api\/pos\/queue/);
  assert.match(hub,/\/api\/pos\/history/);
  assert.match(hub,/\/api\/expenses/);
  assert.match(hub,/\/api\/control-center/);
  assert.match(hub,/bootstrap\?\.menu/);
});

test("daily workspace quick expense reuses report permission and durable expense recovery",async()=>{
  const hub=await read("components/pos-daily-workspace.tsx");
  assert.match(hub,/session\.user\.permissions\?\.queue===true/);
  assert.match(hub,/session\.user\.permissions\?\.order===true/);
  assert.match(hub,/session\.user\.permissions\?\.stock===true/);
  assert.match(hub,/session\.user\.permissions\?\.report===true/);
  assert.match(hub,/prepareExpenseIntent/);
  assert.match(hub,/readExpenseIntent/);
  assert.match(hub,/sendExpenseIntent/);
  assert.match(hub,/method:"POST"/);
  assert.doesNotMatch(hub,/method:"DELETE"/);
  assert.match(hub,/X-CSRF-Token/);
  assert.match(hub,/highRiskExpense/);
  assert.match(hub,/cashTooLarge/);
  for(const href of ["/queue","/orders","/stock","/expenses","/control"])assert.match(hub,new RegExp('href="'+href.replaceAll("/","\\/")+'"'));
});

test("workspace previews the latest receipt in-place and keeps deep actions on Orders",async()=>{
  const hub=await read("components/pos-daily-workspace.tsx");
  assert.match(hub,/ใบเสร็จล่าสุด/);
  assert.match(hub,/<details className=/);
  assert.match(hub,/latestOrder\.items/);
  assert.match(hub,/latestOrder\.paymentMethods/);
  assert.match(hub,/พิมพ์บิลล่าสุดได้ตรงนี้โดยไม่ออกจากหน้า POS/);
  assert.match(hub,/SaleReceipt/);
  assert.match(hub,/onClick=\{\(\)=>window\.print\(\)\}/);
  assert.match(hub,/พิมพ์ใบเสร็จล่าสุด/);
  assert.match(hub,/billNo:String\(latestOrder\.billNo\|\|latestOrder\.id\)/);
  assert.match(hub,/items:\(latestOrder\.items\|\|\[\]\)\.map/);
  assert.match(hub,/FullLink href="\/orders" label="เปิดประวัติ \/ คืนเงิน \/ ยกเลิกบิล"/);
  const receiptStart=hub.indexOf("ใบเสร็จล่าสุด");
  const receiptEnd=hub.indexOf("เปิดประวัติ / คืนเงิน / ยกเลิกบิล",receiptStart);
  const receiptBlock=hub.slice(receiptStart,receiptEnd);
  assert.doesNotMatch(receiptBlock,/href=\{latestOrder\.queueNo/);
});

test("workspace fails safe offline while still exposing cached stock signals",async()=>{
  const hub=await read("components/pos-daily-workspace.tsx");
  assert.match(hub,/เน็ตหลุด · ยังดูสัญญาณสต็อกจากข้อมูลล่าสุดได้/);
  assert.match(hub,/disabled=\{busy\|\|!online\}/);
  assert.match(hub,/เมนูที่เปิดขายยังไม่พบสัญญาณสต็อกต่ำ/);
});

test("workspace remains touch friendly and light-theme compliant",async()=>{
  const hub=await read("components/pos-daily-workspace.tsx");
  assert.match(hub,/min-h-12/);
  assert.match(hub,/h-11 w-11/);
  assert.doesNotMatch(hub,/bg-black\/[6789]/);
  assert.doesNotMatch(hub,/border-white\//);
});


test("workspace next-action policy prioritizes unresolved money before operational work",()=>{
  const base={canExpense:true,canQueue:true,canStock:true,canStatus:true,canOrder:true};
  assert.equal(chooseWorkspaceNextAction({...base,pendingExpense:true,queueCount:3,firstQueue:"Q12",outCount:2,blockedCount:1}).tab,"expense");
  assert.equal(chooseWorkspaceNextAction({...base,queueCount:3,firstQueue:"Q12",outCount:2,blockedCount:1}).tab,"queue");
  assert.equal(chooseWorkspaceNextAction({...base,outCount:2,blockedCount:1}).tab,"stock");
  assert.equal(chooseWorkspaceNextAction({...base,blockedCount:1}).tab,"status");
  assert.equal(chooseWorkspaceNextAction({...base,lowCount:2}).tab,"stock");
  assert.equal(chooseWorkspaceNextAction({...base,latestOrderLabel:"Q11"}).tab,"orders");
  assert.equal(chooseWorkspaceNextAction(base).tab,null);
});

test("workspace guidance explains FIFO instead of asking a new operator to choose a queue",()=>{
  const action=chooseWorkspaceNextAction({canQueue:true,queueCount:2,firstQueue:"Q7"});
  assert.equal(action.label,"ทำ Q7 ก่อน");
  assert.match(action.detail,/เรียงตามลำดับเวลา/);
  assert.match(action.detail,/ทำคิวบนสุดก่อน/);
});

test("workspace dialog traps keyboard focus and supports Escape without changing business mutations",async()=>{
  const hub=await read("components/pos-daily-workspace.tsx");
  assert.match(hub,/dialogRef=useRef/);
  assert.match(hub,/closeButtonRef=useRef/);
  assert.match(hub,/event\.key==="Escape"/);
  assert.match(hub,/event\.key!=="Tab"/);
  assert.match(hub,/querySelectorAll<HTMLElement>/);
  assert.match(hub,/previous\?\.focus\(\)/);
  assert.doesNotMatch(hub,/method:"POST"[\s\S]{0,180}\/api\/pos\/queue/);
  assert.doesNotMatch(hub,/method:"POST"[\s\S]{0,180}\/api\/stock/);
});

test("workspace renders one explicit recommended action above the detail tabs",async()=>{
  const hub=await read("components/pos-daily-workspace.tsx");
  assert.match(hub,/chooseWorkspaceNextAction/);
  assert.match(hub,/แนะนำตอนนี้/);
  assert.match(hub,/aria-live="polite"/);
  assert.match(hub,/setTab\(nextAction\.tab as WorkspaceTab\)/);
});


test("inline receipt is read-only and uses the existing history payload",async()=>{
  const hub=await read("components/pos-daily-workspace.tsx");
  assert.match(hub,/items\?:Array<\{id:string;name:string;variant\?:string;qty:number;price:number\}>/);
  assert.match(hub,/item\.qty} × ฿\{money\(item\.price\)\}/);
  assert.match(hub,/money\(Number\(item\.price\)\*Number\(item\.qty\)\)/);
  const api=await read("lib/api.mjs");
  const start=api.indexOf("if(path==='/api/pos/history'&&method==='GET')");
  const end=api.indexOf("\n      if(",start+10);
  const history=api.slice(start,end);
  assert.match(history,/paymentMethods/);
  assert.match(history,/items:\(s\.items\|\|\[\]\)\.map/);
  assert.doesNotMatch(hub,/method:"POST"[\s\S]{0,160}ใบเสร็จล่าสุด/);
});


test("workspace uses plain Thai operator language instead of engineering jargon",async()=>{
  const hub=await read("components/pos-daily-workspace.tsx");
  const guidance=await read("lib/workspace-guidance.mjs");
  for(const term of [
    "Quick Expense","SYSTEM READINESS","Request เดิม","exact ACK","FIFO","Server"
  ]){
    assert.equal(hub.includes(term),false,"workspace leaks "+term);
    assert.equal(guidance.includes(term),false,"guidance leaks "+term);
  }
  assert.match(hub,/รายจ่ายด่วน/);
  assert.match(hub,/ความพร้อมระบบ/);
  assert.match(hub,/ใกล้หมด/);
  assert.match(hub,/คืนเงิน \/ ยกเลิกบิล/);
  assert.match(guidance,/ระบบจะตรวจรายการเดิมซ้ำ/);
  assert.match(guidance,/เรียงตามลำดับเวลา/);
});

test("readiness machine states are translated before operators see them",async()=>{
  const hub=await read("components/pos-daily-workspace.tsx");
  assert.match(hub,/readinessLabel/);
  assert.match(hub,/checkStatusLabel/);
  assert.match(hub,/value==="READY"\?"พร้อม"/);
  assert.match(hub,/value==="WARN"\?"มีจุดต้องดู"/);
  assert.match(hub,/value==="WARN"\?"เตือน"/);
});


test("workspace expense browser QA proves lost-response recovery reuses the exact intent",async()=>{
  const qa=await read("scripts/qa-workspace-expense-recovery.py");
  assert.match(qa,/route\.abort\("failed"\)/);
  assert.match(qa,/มีค่าใช้จ่ายเดิมรอยืนยัน/);
  assert.match(qa,/ตรวจผลรายการเดิม/);
  assert.match(qa,/second==first/);
  assert.match(qa,/requestKey/);
  assert.match(qa,/paymentMethod/);
  assert.match(qa,/liveWrites.*False/);
  assert.doesNotMatch(qa,/field-pos\.vercel\.app/);
});


test("workspace continuously follows the highest-priority task until the operator chooses manual browsing",async()=>{
  const hub=await read("components/pos-daily-workspace.tsx");
  assert.match(hub,/guidedMode,setGuidedMode/);
  assert.match(hub,/workspaceReady/);
  assert.match(hub,/if\(!workspaceReady\|\|!guidedMode\)return/);
  assert.match(hub,/nextAction\.tab&&tabs\.includes\(nextAction\.tab as WorkspaceTab\)&&tab!==nextAction\.tab/);
  assert.match(hub,/setTab\(nextAction\.tab as WorkspaceTab\)/);
  assert.match(hub,/refresh\(\)\.catch\(\(\)=>\{\}\)\.finally/);
  assert.match(hub,/onClick=\{\(\)=>\{setGuidedMode\(false\);setTab\(key\)\}\}/);
  assert.match(hub,/กลับให้ระบบพาไปงานถัดไป/);
  assert.match(hub,/onClick=\{\(\)=>\{setGuidedMode\(true\);setTab\(nextAction\.tab as WorkspaceTab\)\}\}/);
  assert.match(hub,/if\(!open\)[\s\S]{0,80}setGuidedMode\(true\)/);
});


test("Today Workspace starts the business day in-place with durable exact-replay recovery",async()=>{
  const hub=await read("components/pos-daily-workspace.tsx");
  assert.match(hub,/prepareCashShiftOpenIntent/);
  assert.match(hub,/readCashShiftOpenIntent/);
  assert.match(hub,/sendCashShiftOpenIntent/);
  assert.match(hub,/expenseData\?\.businessDate/);
  assert.match(hub,/\/api\/cash-shift\/open/);
  assert.match(hub,/เริ่มงานวันนี้/);
  assert.match(hub,/เปิดร้านวันนี้/);
  assert.match(hub,/aria-label="เงินสดตั้งต้น"/);
  assert.match(hub,/pendingOpenShift/);
  assert.match(hub,/disabled=\{!!pendingOpenShift\|\|startDayRecoveryBlocked\}/);
  assert.match(hub,/window\.addEventListener\("online",recover\)/);
  assert.match(hub,/window\.addEventListener\("focus",recover\)/);
  assert.match(hub,/document\.addEventListener\("visibilitychange",visible\)/);
  assert.doesNotMatch(hub,/method:"POST"[\s\S]{0,180}\/api\/close-day/);
});


test("workspace next-action guides start-day before declaring the shop ready",()=>{
  const base={canStartDay:true,businessDateKnown:true,canExpense:true,canQueue:true,canStock:true,canStatus:true,canOrder:true};
  const fresh=chooseWorkspaceNextAction(base);
  assert.equal(fresh.action,"start_day");
  assert.equal(fresh.tab,null);
  assert.match(fresh.label,/เปิดร้านก่อน/);

  const pending=chooseWorkspaceNextAction({...base,pendingOpenShift:true});
  assert.equal(pending.action,"start_day");
  assert.equal(pending.tone,"critical");
  assert.match(pending.detail,/ป้องกันเงินตั้งต้นซ้ำ/);

  const blocked=chooseWorkspaceNextAction({...base,startDayRecoveryBlocked:true});
  assert.equal(blocked.action,"start_day");
  assert.equal(blocked.tone,"critical");
  assert.match(blocked.detail,/ห้ามสร้างคำสั่งเปิดร้านใหม่/);
});

test("customer queue still outranks a fresh start-day prompt once customers are already waiting",()=>{
  const action=chooseWorkspaceNextAction({
    canStartDay:true,businessDateKnown:true,
    canQueue:true,queueCount:2,firstQueue:"Q9"
  });
  assert.equal(action.tab,"queue");
  assert.equal(action.action,undefined);
  assert.match(action.label,/Q9/);
});

test("closed business day never tells a new operator that the shop is ready",()=>{
  const action=chooseWorkspaceNextAction({
    canStartDay:true,businessDateKnown:true,shiftStatus:"closed",
    canOrder:true,latestOrderLabel:"Q12"
  });
  assert.equal(action.tab,null);
  assert.equal(action.action,null);
  assert.equal(action.tone,"critical");
  assert.match(action.label,/ปิดยอดแล้ว/);
  assert.match(action.detail,/รอวันทำการถัดไป/);
});

test("workspace start-day recommendation focuses the exact opening cash control in-place",async()=>{
  const hub=await read("components/pos-daily-workspace.tsx");
  assert.match(hub,/startDayCardRef=useRef/);
  assert.match(hub,/openingCashRef=useRef/);
  assert.match(hub,/ref=\{startDayCardRef\}/);
  assert.match(hub,/ref=\{openingCashRef\}/);
  assert.match(hub,/nextAction\.action==="start_day"/);
  assert.match(hub,/scrollIntoView\(\{behavior:"smooth",block:"nearest"\}\)/);
  assert.match(hub,/openingCashRef\.current\?\.focus\(\)/);
  assert.match(hub,/"เริ่มงาน"/);
  assert.match(hub,/>ไปตรงนี้<\/button>/);
});


test("workspace completes the normal first-queue production flow in-place",async()=>{
  const hub=await read("components/pos-daily-workspace.tsx");
  assert.match(hub,/useQueueActionRecovery/);
  assert.match(hub,/runQueueProductionAction\(order:QueueOrder,item:QueueItem,itemIndex:number,action:"complete_item"\|"waste_remake"\)/);
  assert.match(hub,/action==="complete_item"/);
  assert.match(hub,/action==="waste_remake"/);
  assert.match(hub,/expectedReadyQty:n\(item\.readyQty\)/);
  assert.match(hub,/reason:"ชงเสีย \/ ทำใหม่"/);
  assert.match(hub,/const result=await sendQueueAction\(body\)/);
  assert.match(hub,/สูตรต่อแก้ว/);
  assert.match(hub,/ห้ามข้ามคิว/);
  assert.match(hub,/ทำ \{currentPrepTask\.item\.name\} ครบ/);
  assert.match(hub,/runQueueTailAction\(order,"call"\)/);
  assert.match(hub,/runQueueTailAction\(order,"return"\)/);
  assert.match(hub,/เรียกบัตร/);
  assert.match(hub,/ลูกค้ารับแล้ว/);
  assert.match(hub,/productionHead/);
  assert.match(hub,/readyAll/);
  assert.match(hub,/calledAll/);
  assert.doesNotMatch(hub,/action:"call_item"/);
});

test("workspace queue tail actions share the same pending intent and fail closed",async()=>{
  const hub=await read("components/pos-daily-workspace.tsx");
  assert.match(hub,/pendingQueueAction/);
  assert.match(hub,/queueRecoveryBlocked/);
  assert.match(hub,/queueActionLocked/);
  assert.match(hub,/recoverQueueAction/);
  assert.match(hub,/ไม่ต้องกดซ้ำ/);
  assert.match(hub,/role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(hub,/disabled=\{!online\|\|busy\|\|queueActionLocked\}/);
  assert.match(hub,/FullLink href="\/queue" label="เปิดโหมดทำเครื่องดื่ม \/ ดูคิวเต็ม"/);
});


test("workspace keeps FIFO obvious: only the production head can be called while later queues stay read-only",async()=>{
  const hub=await read("components/pos-daily-workspace.tsx");
  assert.match(hub,/productionHead=queueSorted\.find\(order=>!queueOrderCalled\(order\)\)\|\|null/);
  assert.match(hub,/isProductionHead:productionHead\?\.id===order\.id/);
  assert.match(hub,/isProductionHead&&readyAll/);
  assert.match(hub,/รอคิวก่อนหน้า · ระบบเรียงลำดับให้แล้ว/);
  const queueStart=hub.indexOf('tab==="queue"');
  const queueEnd=hub.indexOf('tab==="orders"',queueStart);
  const queueBlock=hub.slice(queueStart,queueEnd);
  assert.equal((queueBlock.match(/runQueueTailAction\(order,"call"\)/g)||[]).length,1);
  assert.equal((queueBlock.match(/runQueueTailAction\(order,"return"\)/g)||[]).length,1);
});


test("guided workspace no longer uses a one-shot auto-route lock",async()=>{
  const hub=await read("components/pos-daily-workspace.tsx");
  assert.doesNotMatch(hub,/autoRouteRef/);
  assert.doesNotMatch(hub,/manualTabRef/);
  assert.match(hub,/\[open,workspaceReady,guidedMode,nextAction\.tab,tabs\.join\("\|"\),tab\]/);
});
