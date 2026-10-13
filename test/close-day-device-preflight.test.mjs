import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {loadBrowserModule} from "./helpers/load-browser-module.mjs";

const loadPreflight=id=>loadBrowserModule("lib/close-day-device-preflight.ts",{
  id,
  replace:source=>source
    .replace('import {offlineCashListStrict,type OfflineCashRecord} from "@/lib/offline-db";','type OfflineCashRecord=any; const offlineCashListStrict=async()=>[];')
    .replace('import {listExpenseIntents,type ExpenseIntent} from "@/lib/expense-recovery";','type ExpenseIntent=any; const listExpenseIntents=()=>[];')
    .replace('import {listCashMovementIntents,type CashMovementIntent} from "@/lib/cash-movement-recovery";','type CashMovementIntent=any; const listCashMovementIntents=()=>[];')
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
    cashMovementIntents:[{version:1,actorId:"owner",createdAt:6,body:{requestKey:"cashmove-0001",date,type:"CASH_OUT",amount:100,reason:"เก็บเงิน",riskConfirmed:false}}]
  });
  assert.equal(result.ok,false);
  assert.equal(result.checkedAt,123);
  assert.deepEqual(result.blockers.map(x=>x.kind),["offline_cash","cash_unknown","promptpay_unknown","expense_unknown","expense_unknown","cash_movement_unknown"]);
  assert.equal(result.blockers.at(-1).route,undefined);
  assert.match(result.blockers.at(-1).title,/ผู้ใช้อื่น/);
});

test("resolved context from another business date does not block the current close",async()=>{
  const api=await loadPreflight("other-day"),today="2026-10-13",old="2026-10-12";
  const result=api.buildCloseDayDevicePreflight({
    actorId:"owner",businessDate:today,
    offlineRows:[{requestKey:"offline-old1",body:{date:old},createdAt:1,localNo:"OFF-1",status:"needs_review",attempts:1}],
    cashPending:{body:{requestKey:"cash-old01",date:old,total:50},createdAt:2},
    promptPending:{requestKey:"prompt-old1",date:old,total:55,createdAt:3},
    expenseIntents:[{version:1,actorId:"owner",createdAt:4,body:{requestKey:"expense-old1",date:old,amount:30,category:"OTHER",description:"old",paymentMethod:"cash",riskConfirmed:false}}],
    cashMovementIntents:[{version:1,actorId:"owner",createdAt:5,body:{requestKey:"cashmove-old1",date:old,type:"CASH_IN",amount:20,reason:"old",riskConfirmed:false}}]
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
    listCashMovements:()=>[]
  });
  assert.equal(result.ok,false);
  assert.equal(result.blockers[0].kind,"storage_unreadable");
});

test("Close Day checks device state before review and again before final commit",async()=>{
  const ui=await readFile(new URL("../app/close/page.tsx",import.meta.url),"utf8");
  const reviewStart=ui.indexOf("async function reviewCash");
  const closeStart=ui.indexOf("async function close()",reviewStart);
  const review=ui.slice(reviewStart,closeStart);
  const closing=ui.slice(closeStart,ui.indexOf("const movementAmountNumber",closeStart));
  assert.ok(review.indexOf("await refreshDevicePreflight()")>=0);
  assert.ok(review.indexOf("await refreshDevicePreflight()")<review.indexOf('api<any>("/api/close-day/review"'));
  assert.ok(closing.indexOf("await refreshDevicePreflight()")>=0);
  assert.ok(closing.indexOf("await refreshDevicePreflight()")<closing.indexOf("window.confirm"));
  assert.ok(closing.indexOf("await refreshDevicePreflight()")<closing.indexOf('api<any>("/api/close-day"'));
});

test("Close Day refreshes blockers after reconnect focus and visible resume and provides recovery routes",async()=>{
  const ui=await readFile(new URL("../app/close/page.tsx",import.meta.url),"utf8");
  assert.match(ui,/window\.addEventListener\("online",onOnline\)/);
  assert.match(ui,/window\.addEventListener\("focus",onFocus\)/);
  assert.match(ui,/document\.addEventListener\("visibilitychange",onVisible\)/);
  assert.match(ui,/ไปหน้า POS/);
  assert.match(ui,/ไป Payment Recovery/);
  assert.match(ui,/ไปหน้า Expenses/);
  assert.match(ui,/Server ตรวจเฉพาะรายการที่ขึ้น Cloud แล้ว/);
});

test("strict offline outbox inspection distinguishes unreadable storage from an empty outbox",async()=>{
  const source=await readFile(new URL("../lib/offline-db.ts",import.meta.url),"utf8");
  assert.match(source,/export async function offlineCashListStrict/);
  assert.match(source,/r\.onblocked=finishError/);
  assert.match(source,/tx\.oncomplete=/);
  assert.match(source,/offline_storage_unavailable/);
});
