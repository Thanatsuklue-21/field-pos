import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("Orders persists VOID and Refund identity before POST and background recovery never creates a new key",async()=>{
  const ui=await read("app/orders/page.tsx");
  assert.match(ui,/prepareOrderMutationIntent/);
  assert.match(ui,/requestKey:"refund:"\+crypto\.randomUUID\(\)/);
  assert.match(ui,/requestKey:"void:"\+crypto\.randomUUID\(\)/);
  assert.match(ui,/sendOrderMutationIntent\(intent/);
  const recoverStart=ui.indexOf("async function runOrderMutation");
  const refundStart=ui.indexOf("async function refundSaleUi",recoverStart);
  assert.doesNotMatch(ui.slice(recoverStart,refundStart),/crypto\.randomUUID/);
});

test("unresolved order mutation locks only mutation actions and keeps normal selling available",async()=>{
  const ui=await read("app/orders/page.tsx");
  assert.match(ui,/ระบบล็อกการแก้ยอดขายซ้ำไว้ แต่ยังรับออเดอร์ใหม่ได้ตามปกติ/);
  assert.match(ui,/ตรวจผลรายการเดิม/);
  assert.match(ui,/disabled=\{busy\|\|!!pendingMutation\|\|mutationRecoveryBlocked\} onClick=\{\(\)=>voidCash\(detail\)\}/);
  assert.match(ui,/disabled=\{busy\|\|!!pendingMutation\|\|mutationRecoveryBlocked\} onClick=\{\(\)=>refundSaleUi\(detail\)\}/);
  assert.doesNotMatch(ui,/disabled=\{[^}]*pendingMutation[^}]*\} onClick=\{\(\)=>router\.push\("\/pos"\)\}/);
});

test("cash-order edit context survives ambiguous VOID and can resume back to POS",async()=>{
  const ui=await read("app/orders/page.tsx");
  assert.match(ui,/purpose:"void"\|"edit_cash"/);
  assert.match(ui,/saleSnapshot:\{items:s\.items,total:s\.total,billNo:s\.billNo,queueNo:s\.queueNo\}/);
  assert.match(ui,/restoreEditContext/);
  assert.match(ui,/field-pos-edit-cash-v1/);
  assert.match(ui,/router\.push\("\/pos"\)/);
});

test("Orders retries exact pending mutation on online focus and visible resume",async()=>{
  const ui=await read("app/orders/page.tsx");
  const marker=ui.indexOf("const recover=async()=>");
  const segment=ui.slice(marker,marker+1900);
  assert.match(segment,/readOrderMutationIntent\(session\.user\.id\)/);
  assert.match(segment,/runOrderMutation\(intent,true\)/);
  assert.match(segment,/window\.addEventListener\("online",onOnline\)/);
  assert.match(segment,/window\.addEventListener\("focus",onFocus\)/);
  assert.match(segment,/document\.addEventListener\("visibilitychange",onVisible\)/);
});

test("VOID and Refund server domain replay durable request before terminal-state checks",async()=>{
  const source=await read("lib/pos-api.mjs");
  for(const [name,end] of [["voidSale","refundSale"],["refundSale","startSplitPayment"]]){
    const start=source.indexOf("export async function "+name),finish=source.indexOf("export async function "+end,start+1),block=source.slice(start,finish);
    assert.match(block,/const old=await replay\(tx,doc,body\.requestKey,context\)/);
    assert.match(block,/await remember\(tx,doc,body\.requestKey,response,context\)/);
    assert.ok(block.indexOf("const old=await replay")<block.indexOf(name==="voidSale"?"sale.status==='void'":"sale.status==='refunded'"));
  }
});
