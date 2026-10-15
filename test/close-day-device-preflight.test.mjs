import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {loadBrowserModule} from "./helpers/load-browser-module.mjs";

const loadPreflight=id=>loadBrowserModule("lib/close-day-device-preflight.ts",{
  id,
  replace:source=>source
    .replace('import {offlineCashListStrict,type OfflineCashRecord} from "@/lib/offline-db";','type OfflineCashRecord=any; const offlineCashListStrict=async()=>[];')
    .replace('import {listExpenseIntents,type ExpenseIntent} from "@/lib/expense-recovery";','type ExpenseIntent=any; const listExpenseIntents=()=>[];')
    .replace('import {listCashShiftOpenIntents,type CashShiftOpenIntent} from "@/lib/cash-shift-open-recovery";','type CashShiftOpenIntent=any; const listCashShiftOpenIntents=()=>[];')
    .replace('import {listCashMovementIntents,type CashMovementIntent} from "@/lib/cash-movement-recovery";','type CashMovementIntent=any; const listCashMovementIntents=()=>[];')
    .replace('import {listExpenseDeleteIntents,type ExpenseDeleteIntent} from "@/lib/expense-delete-recovery";','type ExpenseDeleteIntent=any; const listExpenseDeleteIntents=()=>[];')
    .replace('import {listStockWriteIntents,type StockWriteIntent} from "@/lib/stock-write-recovery";','type StockWriteIntent=any; const listStockWriteIntents=()=>[];')
    .replace('import {listOrderMutationIntents,type OrderMutationIntent} from "@/lib/order-mutation-recovery";','type OrderMutationIntent=any; const listOrderMutationIntents=()=>[];')
    .replace('import {listCloseDayWriteIntents,type CloseDayWriteIntent} from "@/lib/close-day-write-recovery";','type CloseDayWriteIntent=any; const listCloseDayWriteIntents=()=>[];')
});
const storage=(entries={})=>{
  const data=new Map(Object.entries(entries));
  return {
    get length(){return data.size},
    key:index=>Array.from(data.keys())[index]??null,
    getItem:key=>data.get(key)??null,
    setItem:(key,value)=>data.set(key,value),
    removeItem:key=>data.delete(key)
  };
};

test("same-day device-local money and expense intents block Close Day",async()=>{
  const api=await loadPreflight("same-day"),date="2026-10-13";
  const result=api.buildCloseDayDevicePreflight({
    actorId:"owner",businessDate:date,checkedAt:123,
    offlineRows:[{requestKey:"offline-0001",body:{date},createdAt:1,localNo:"OFF-1",status:"pending",attempts:0}],
    cashPending:{body:{requestKey:"cash-0001",date,total:50,received:100},createdAt:2},
    promptPending:{requestKey:"prompt-0001",date,total:55,createdAt:3,paymentReference:"ch_1"},
    expenseIntents:[
      {version:1,actorId:"owner",createdAt:4,body:{requestKey:"expense-0001",date,amount:30,category:"OTHER",description:"ice",paymentMethod:"cash",riskConfirmed:false}},
      {version:1,actorId:"staff-2",createdAt:5,body:{requestKey:"expense-0002",date,amount:20,category:"OTHER",description:"parking",paymentMethod:"cash",riskConfirmed:false}}
    ],
    cashMovementIntents:[{version:1,actorId:"owner",createdAt:6,body:{requestKey:"cashmove-0001",date,type:"CASH_OUT",amount:100,reason:"เก็บเงิน",riskConfirmed:false}}],
    expenseDeleteIntents:[{version:1,actorId:"owner",createdAt:7,body:{requestKey:"expdel-0001",expenseId:"exp-1",date,expectedAmount:30}}],
    stockWriteIntents:[{version:1,actorId:"owner",operation:"stockTransaction",businessDate:date,createdAt:8,body:{requestKey:"stock-write-0001",ingredientId:"matcha",type:"WASTE",qtyDelta:-5}}]
  });
  assert.equal(result.ok,false);
  assert.equal(result.checkedAt,123);
  assert.deepEqual(result.blockers.map(x=>x.kind),["offline_cash","cash_unknown","promptpay_unknown","expense_unknown","expense_unknown","cash_movement_unknown","expense_delete_unknown","stock_write_unknown"]);
  const otherExpense=result.blockers.find(x=>x.kind==="expense_unknown"&&x.actorId==="staff-2");
  assert.equal(otherExpense?.route,undefined);
  assert.match(otherExpense?.title||"",/ผู้ใช้อื่น/);
  const movement=result.blockers.find(x=>x.kind==="cash_movement_unknown");
  assert.match(movement?.title||"",/เงินเข้า\/ออกลิ้นชัก/);
});

test("same-day unresolved cycle count approve and reject block Close Day",async()=>{
  const api=await loadPreflight("stock-review"),date="2026-10-13";
  const result=api.buildCloseDayDevicePreflight({
    actorId:"owner",businessDate:date,
    offlineRows:[],cashPending:null,promptPending:null,expenseIntents:[],cashMovementIntents:[],expenseDeleteIntents:[],
    stockWriteIntents:[
      {version:1,actorId:"owner",operation:"cycleCountProposalApprove",businessDate:date,createdAt:1,body:{requestKey:"review-approve-01",proposalId:"p1",confirm:true}},
      {version:1,actorId:"owner-2",operation:"cycleCountProposalReject",businessDate:date,createdAt:2,body:{requestKey:"review-reject-001",proposalId:"p2",reason:"recount"}}
    ]
  });
  assert.equal(result.ok,false);
  assert.equal(result.blockers.length,2);
  assert.match(result.blockers[0].title,/อนุมัติผลนับ Stock/);
  assert.equal(result.blockers[0].route,"/stock");
  assert.match(result.blockers[1].title,/ผู้ใช้อื่น/);
  assert.equal(result.blockers[1].route,undefined);
});

test("resolved context from another business date does not block the current close",async()=>{
  const api=await loadPreflight("other-day"),today="2026-10-13",old="2026-10-12";
  const result=api.buildCloseDayDevicePreflight({
    actorId:"owner",businessDate:today,
    offlineRows:[{requestKey:"offline-old1",body:{date:old},createdAt:1,localNo:"OFF-1",status:"needs_review",attempts:1}],
    cashPending:{body:{requestKey:"cash-old01",date:old,total:50},createdAt:2},
    promptPending:{requestKey:"prompt-old1",date:old,total:55,createdAt:3},
    expenseIntents:[{version:1,actorId:"owner",createdAt:4,body:{requestKey:"expense-old1",date:old,amount:30,category:"OTHER",description:"old",paymentMethod:"cash",riskConfirmed:false}}],
    cashMovementIntents:[{version:1,actorId:"owner",createdAt:5,body:{requestKey:"cashmove-old1",date:old,type:"CASH_IN",amount:20,reason:"old",riskConfirmed:false}}],
    expenseDeleteIntents:[{version:1,actorId:"owner",createdAt:6,body:{requestKey:"expdel-old1",expenseId:"exp-old",date:old,expectedAmount:30}}],
    stockWriteIntents:[{version:1,actorId:"owner",operation:"cycleCountCommit",businessDate:old,createdAt:7,body:{requestKey:"stock-old-0001",confirm:true,counts:[]}}]
  });
  assert.equal(result.ok,true);
  assert.deepEqual(result.blockers,[]);
});

for(const scenario of ["local-storage-denied","indexeddb-unreadable"])test("device preflight fails closed when "+scenario,async()=>{
  const api=await loadPreflight(scenario),date="2026-10-13";
  const store=storage();
  if(scenario==="local-storage-denied")store.getItem=()=>{throw new Error("denied")};
  const result=await api.readCloseDayDevicePreflight("owner",date,{
    storage:store,
    listOffline:scenario==="indexeddb-unreadable"?async()=>{throw new Error("idb failed")}:async()=>[],
    listExpenses:()=>[],
    listCashMovements:()=>[],
    listExpenseDeletes:()=>[],
    listStockWrites:()=>[],
    now:()=>99
  });
  assert.equal(result.ok,false);
  assert.equal(result.checkedAt,99);
  assert.equal(result.blockers[0].kind,"storage_unreadable");
  assert.match(result.blockers[0].detail,/ห้ามปิดวัน/);
});

test("malformed pending cash never becomes an empty recovery state",async()=>{
  const api=await loadPreflight("corrupt"),date="2026-10-13";
  const result=await api.readCloseDayDevicePreflight("owner",date,{
    storage:storage({"field-pos-pending-cash-v1":"{broken"}),
    listOffline:async()=>[],
    listExpenses:()=>[],
    listCashMovements:()=>[],
    listExpenseDeletes:()=>[],
    listStockWrites:()=>[]
  });
  assert.equal(result.ok,false);
  assert.equal(result.blockers[0].kind,"storage_unreadable");
});

test("Close Day checks device state before review and rechecks after final confirmation",async()=>{
  const ui=await readFile(new URL("../app/close/page.tsx",import.meta.url),"utf8");
  const reviewStart=ui.indexOf("async function reviewCash");
  const closeStart=ui.indexOf("async function close()",reviewStart);
  const review=ui.slice(reviewStart,closeStart);
  const closing=ui.slice(closeStart,ui.indexOf("const movementAmountNumber",closeStart));
  const firstPreflight=closing.indexOf("await refreshDevicePreflight()");
  const confirm=closing.indexOf("window.confirm");
  const finalPreflight=closing.indexOf("await refreshDevicePreflight()",firstPreflight+1);
  const reviewPersist=review.indexOf("prepareCloseDayWriteIntent");
  const reviewSend=review.indexOf("submitCloseDayIntent",reviewPersist);
  const finalPersist=closing.indexOf("prepareCloseDayWriteIntent",finalPreflight);
  const finalSend=closing.indexOf("submitCloseDayIntent",finalPersist);
  assert.ok(review.indexOf("await refreshDevicePreflight()")>=0);
  assert.ok(review.indexOf("await refreshDevicePreflight()")<reviewPersist);
  assert.ok(reviewPersist>=0&&reviewSend>reviewPersist);
  assert.ok(firstPreflight>=0&&firstPreflight<confirm);
  assert.ok(finalPreflight>confirm);
  assert.ok(finalPersist>finalPreflight&&finalSend>finalPersist);
  assert.match(closing,/setReview\(null\).*พบรายการค้างใหม่ในเครื่องหลังการยืนยัน/);
});

test("Close Day refreshes blockers after reconnect focus and visible resume and provides recovery routes",async()=>{
  const ui=await readFile(new URL("../app/close/page.tsx",import.meta.url),"utf8");
  assert.match(ui,/window\.addEventListener\("online",onOnline\)/);
  assert.match(ui,/window\.addEventListener\("focus",onFocus\)/);
  assert.match(ui,/document\.addEventListener\("visibilitychange",onVisible\)/);
  assert.match(ui,/ไปหน้า POS/);
  assert.match(ui,/ไปตรวจรายการรับเงินค้าง/);
  assert.match(ui,/ไปหน้า Expenses/);
  assert.match(ui,/ระบบกลางเห็นเฉพาะรายการที่ส่งสำเร็จแล้ว/);
});

test("strict offline outbox inspection distinguishes unreadable storage from an empty outbox",async()=>{
  const source=await readFile(new URL("../lib/offline-db.ts",import.meta.url),"utf8");
  assert.match(source,/export async function offlineCashListStrict/);
  assert.match(source,/r\.onblocked=finishError/);
  assert.match(source,/tx\.oncomplete=/);
  assert.match(source,/offline_storage_unavailable/);
});


test("same-day unresolved stock write blocks Close Day and routes current actor to Stock",async()=>{
  const api=await loadPreflight("stock-write"),date="2026-10-13";
  const result=api.buildCloseDayDevicePreflight({
    actorId:"owner",businessDate:date,offlineRows:[],cashPending:null,promptPending:null,expenseIntents:[],cashMovementIntents:[],expenseDeleteIntents:[],
    stockWriteIntents:[
      {version:1,actorId:"owner",operation:"cycleCountCommit",businessDate:date,createdAt:1,body:{requestKey:"cycle-write-0001",confirm:true,counts:[{ingredientId:"matcha",countedQty:90}]}},
      {version:1,actorId:"staff-2",operation:"stockTransaction",businessDate:date,createdAt:2,body:{requestKey:"stock-write-0002",ingredientId:"milk",type:"WASTE",qtyDelta:-10}}
    ]
  });
  assert.equal(result.ok,false);
  assert.equal(result.blockers[0].kind,"stock_write_unknown");
  assert.equal(result.blockers[0].route,"/stock");
  assert.equal(result.blockers[1].route,undefined);
  assert.match(result.blockers[1].title,/ผู้ใช้อื่น/);
});

test("read preflight includes persisted stock write intents",async()=>{
  const api=await loadPreflight("stock-read"),date="2026-10-13";
  const result=await api.readCloseDayDevicePreflight("owner",date,{
    storage:storage(),listOffline:async()=>[],listExpenses:()=>[],listCashMovements:()=>[],listExpenseDeletes:()=>[],
    listStockWrites:()=>[{version:1,actorId:"owner",operation:"stockTransaction",businessDate:date,createdAt:1,body:{requestKey:"stock-read-0001"}}]
  });
  assert.equal(result.ok,false);
  assert.equal(result.blockers[0].kind,"stock_write_unknown");
});


test("same-day unresolved VOID and Refund block Close Day with current-user recovery route",async()=>{
  const api=await loadPreflight("order-mutations"),date="2026-10-13";
  const result=api.buildCloseDayDevicePreflight({
    actorId:"owner",businessDate:date,offlineRows:[],cashPending:null,promptPending:null,expenseIntents:[],cashMovementIntents:[],expenseDeleteIntents:[],stockWriteIntents:[],
    orderMutationIntents:[
      {version:1,actorId:"owner",operation:"void",businessDate:date,createdAt:1,body:{requestKey:"void-close-0001",saleId:"sale-1",reason:"mistake",riskConfirmed:true}},
      {version:1,actorId:"staff-2",operation:"refund",businessDate:date,createdAt:2,body:{requestKey:"refund-close-0001",saleId:"sale-2",reason:"refund",riskConfirmed:true}}
    ]
  });
  assert.equal(result.ok,false);
  assert.deepEqual(result.blockers.map(x=>x.kind),["order_mutation_unknown","order_mutation_unknown"]);
  assert.equal(result.blockers[0].route,"/orders");
  assert.equal(result.blockers[1].route,undefined);
  assert.match(result.blockers[0].detail,/เงิน\/Stock\/ประวัติอาจถูกเปลี่ยนแล้ว/);
  assert.match(result.blockers[1].title,/ผู้ใช้อื่น/);
});

test("read preflight includes local order mutation intents",async()=>{
  const api=await loadPreflight("order-read"),date="2026-10-13";
  const result=await api.readCloseDayDevicePreflight("owner",date,{
    storage:storage(),listOffline:async()=>[],listExpenses:()=>[],listCashMovements:()=>[],listExpenseDeletes:()=>[],listStockWrites:()=>[],
    listOrderMutations:()=>[{version:1,actorId:"owner",operation:"refund",businessDate:date,createdAt:1,body:{requestKey:"refund-read-0001",saleId:"sale-1",reason:"refund",riskConfirmed:true}}]
  });
  assert.equal(result.ok,false);
  assert.equal(result.blockers[0].kind,"order_mutation_unknown");
  assert.equal(result.blockers[0].route,"/orders");
});

test("Close Day renders the correct Orders recovery action for unresolved VOID or Refund",async()=>{
  const ui=await readFile(new URL("../app/close/page.tsx",import.meta.url),"utf8");
  assert.match(ui,/order_mutation_unknown/);
  assert.match(ui,/ไปหน้า Orders/);
});


test("same-day unresolved start-day intent blocks Close Day and routes the current owner to Close",async()=>{
  const api=await loadPreflight("start-day"),date="2026-10-14";
  const result=api.buildCloseDayDevicePreflight({
    actorId:"owner",businessDate:date,
    offlineRows:[],cashPending:null,promptPending:null,expenseIntents:[],cashMovementIntents:[],expenseDeleteIntents:[],
    stockWriteIntents:[],orderMutationIntents:[],
    cashShiftOpenIntents:[{
      version:1,actorId:"owner",createdAt:1,
      body:{requestKey:"start-day-close-0001",date,openingCash:500}
    }]
  });
  assert.equal(result.ok,false);
  assert.equal(result.blockers.length,1);
  assert.equal(result.blockers[0].kind,"cash_shift_open_unknown");
  assert.equal(result.blockers[0].route,"/close");
  assert.match(result.blockers[0].detail,/เงินตั้งต้น/);
  assert.match(result.blockers[0].detail,/ห้ามเปิดร้านซ้ำหรือปิดวัน/);
});

test("read preflight includes persisted start-day intents",async()=>{
  const api=await loadPreflight("start-day-read"),date="2026-10-14";
  const result=await api.readCloseDayDevicePreflight("owner",date,{
    storage:storage(),listOffline:async()=>[],listExpenses:()=>[],listCashMovements:()=>[],listExpenseDeletes:()=>[],
    listStockWrites:()=>[],listOrderMutations:()=>[],
    listCashShiftOpens:()=>[{version:1,actorId:"owner",createdAt:1,body:{requestKey:"start-day-read-01",date,openingCash:300}}]
  });
  assert.equal(result.ok,false);
  assert.equal(result.blockers[0].kind,"cash_shift_open_unknown");
});
