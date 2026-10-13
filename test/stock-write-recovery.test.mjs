import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import ts from "typescript";

async function mod(t){
  const source=await readFile(new URL("../lib/stock-write-recovery.ts",import.meta.url),"utf8");
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  return import("data:text/javascript;base64,"+Buffer.from(code+"\n// "+t.name).toString("base64"));
}
function storage(){
  const m=new Map();
  return {
    get length(){return m.size},
    key:i=>Array.from(m.keys())[i]??null,
    getItem:k=>m.has(k)?m.get(k):null,
    setItem:(k,v)=>m.set(k,String(v)),
    removeItem:k=>m.delete(k),
    m
  };
}

test("stock recovery persists exact identity and keeps it across unknown outcomes",async t=>{
  const x=await mod(t),store=storage(),body={requestKey:"stock-recovery-0001",ingredientId:"matcha",type:"WASTE",qtyDelta:-5};
  const intent=x.prepareStockWriteIntent("owner","stockTransaction","2026-10-13",body,store);
  assert.equal(x.readStockWriteIntent("owner",store).body.requestKey,body.requestKey);
  assert.throws(()=>x.prepareStockWriteIntent("owner","stockTransaction","2026-10-13",{...body,requestKey:"stock-recovery-0002",qtyDelta:-6},store),/pending_stock_write_exists/);
  await assert.rejects(
    x.sendStockWriteIntent(intent,async()=>{throw Object.assign(new Error("network_unavailable"),{status:0})},()=>false,new Set(),store),
    /network_unavailable/
  );
  assert.equal(x.readStockWriteIntent("owner",store).body.requestKey,body.requestKey);
  await assert.rejects(
    x.sendStockWriteIntent(intent,async()=>({ok:true,transaction:{requestKey:body.requestKey}}),()=>false,new Set(),store),
    /stock_ack_unknown/
  );
  assert.ok(x.readStockWriteIntent("owner",store));
  const result=await x.sendStockWriteIntent(intent,async()=>({ok:true,transaction:{requestKey:body.requestKey,createdBy:"owner"}}),r=>r.transaction?.createdBy==="owner",new Set(),store);
  assert.equal(result.ok,true);
  assert.equal(x.readStockWriteIntent("owner",store),null);
});

test("authoritative pre-commit stock validation clears intent so operator can correct input",async t=>{
  const x=await mod(t),store=storage(),body={requestKey:"stock-recovery-0003",ingredientId:"matcha",type:"WASTE",qtyDelta:-500};
  const intent=x.prepareStockWriteIntent("owner","stockTransaction","2026-10-13",body,store);
  await assert.rejects(
    x.sendStockWriteIntent(intent,async()=>{throw Object.assign(new Error("stock_shortage"),{status:409})},()=>false,new Set(["stock_shortage"]),store),
    /stock_shortage/
  );
  assert.equal(x.readStockWriteIntent("owner",store),null);
});

test("stock recovery lists pending intents for all actors on this device",async t=>{
  const x=await mod(t),store=storage();
  x.prepareStockWriteIntent("owner","cycleCountCommit","2026-10-13",{requestKey:"count-owner-0001",confirm:true,counts:[]},store);
  x.prepareStockWriteIntent("staff-2","cycleCountProposal","2026-10-13",{requestKey:"count-staff-0001",counts:[]},store);
  const rows=x.listStockWriteIntents(store);
  assert.deepEqual(rows.map(r=>r.actorId).sort(),["owner","staff-2"]);
});

test("committed stale cycle count review stays pending until exact replay ACK",async t=>{
  const x=await mod(t),store=storage(),body={requestKey:"count-review-stale-03",proposalId:"proposal-1",confirm:true,note:"checked"};
  const intent=x.prepareStockWriteIntent("owner","cycleCountProposalApprove","2026-10-13",body,store);
  await assert.rejects(
    x.sendStockWriteIntent(intent,async()=>{throw Object.assign(new Error("cycle_count_proposal_stale"),{status:409})},()=>false,new Set(["cycle_count_proposal_not_found"]),store),
    /cycle_count_proposal_stale/
  );
  assert.equal(x.readStockWriteIntent("owner",store)?.body.requestKey,body.requestKey);
  const result=await x.sendStockWriteIntent(
    intent,
    async()=>({requestKey:body.requestKey,performedBy:"owner",proposalId:body.proposalId,outcome:"stale",replayed:true}),
    (ack,b,i)=>ack.requestKey===b.requestKey&&ack.performedBy===i.actorId&&ack.proposalId===b.proposalId&&ack.outcome==="stale",
    new Set(),
    store
  );
  assert.equal(result.replayed,true);
  assert.equal(x.readStockWriteIntent("owner",store),null);
});

test("authoritative admin permission denial clears cycle count review intent",async t=>{
  const x=await mod(t),store=storage(),body={requestKey:"count-review-denied-01",proposalId:"proposal-2",reason:"recount"};
  const intent=x.prepareStockWriteIntent("owner","cycleCountProposalReject","2026-10-13",body,store);
  await assert.rejects(
    x.sendStockWriteIntent(intent,async()=>{throw Object.assign(new Error("admin_required"),{status:403})},()=>false,new Set(["admin_required"]),store),
    /admin_required/
  );
  assert.equal(x.readStockWriteIntent("owner",store),null);
});

test("stock UI recovers exact pending writes on reconnect focus and visible resume",async()=>{
  const ui=await readFile(new URL("../app/stock/page.tsx",import.meta.url),"utf8");
  assert.match(ui,/prepareStockWriteIntent/);
  assert.match(ui,/sendStockWriteIntent/);
  assert.match(ui,/readStockWriteIntent/);
  assert.match(ui,/window\.addEventListener\("online",onOnline\)/);
  assert.match(ui,/window\.addEventListener\("focus",onFocus\)/);
  assert.match(ui,/document\.addEventListener\("visibilitychange",onVisible\)/);
  assert.match(ui,/มีรายการ Stock เดิมที่ยังไม่ทราบผล/);
  assert.match(ui,/ตรวจผล Request เดิม/);
  assert.match(ui,/cycleCountProposalApprove/);
  assert.match(ui,/cycleCountProposalReject/);
  assert.match(ui,/proposalId:p\.id/);
});


test("purchase edit and cancel use the same durable Stock recovery channel",async t=>{
  const x=await mod(t),store=storage();
  const edit=x.prepareStockWriteIntent("owner","purchaseEdit","2026-10-13",{requestKey:"purchase-edit-local-0001",purchaseId:"pur-1",totalCost:250},store);
  assert.equal(edit.operation,"purchaseEdit");
  assert.throws(()=>x.prepareStockWriteIntent("owner","purchaseCancel","2026-10-13",{requestKey:"purchase-cancel-local-0001",purchaseId:"pur-1",confirm:"CANCEL PURCHASE",reason:"duplicate"},store),/pending_stock_write_exists/);
});

test("purchase admin denial is authoritative and clears the local recovery intent",async t=>{
  const x=await mod(t),store=storage(),body={requestKey:"purchase-edit-denied-001",purchaseId:"pur-1",totalCost:250};
  const intent=x.prepareStockWriteIntent("owner","purchaseEdit","2026-10-13",body,store);
  await assert.rejects(
    x.sendStockWriteIntent(intent,async()=>{throw Object.assign(new Error("admin_required"),{status:403})},()=>false,new Set(["admin_required"]),store),
    /admin_required/
  );
  assert.equal(x.readStockWriteIntent("owner",store),null);
});

test("Stock UI persists Purchase Edit and Cancel before network send and requires exact ACK",async()=>{
  const ui=await readFile(new URL("../app/stock/page.tsx",import.meta.url),"utf8");
  assert.match(ui,/prepareStockWriteIntent\(session\.user\.id,"purchaseEdit",today\(\),body\)/);
  assert.match(ui,/prepareStockWriteIntent\(session\.user\.id,"purchaseCancel",today\(\),body\)/);
  assert.match(ui,/intent\.operation==="purchaseEdit"/);
  assert.match(ui,/intent\.operation==="purchaseCancel"/);
  assert.match(ui,/result\?\.performedBy===intent\.actorId/);
  const requestStart=ui.indexOf("function stockRequest");
  const requestEnd=ui.indexOf("function exactStockAck",requestStart);
  const requestBlock=ui.slice(requestStart,requestEnd);
  assert.match(requestBlock,/operation==="purchaseEdit"\)return \{path:"\/api\/stock\/purchases\/"/);
  assert.match(requestBlock,/operation==="purchaseCancel"\)return \{path:"\/api\/stock\/purchases\/"/);
  const save=ui.slice(ui.indexOf("async function savePurchaseEdit"),ui.indexOf("async function cancelPurchase"));
  const cancel=ui.slice(ui.indexOf("async function cancelPurchase"),ui.indexOf("async function purgeIngredient"));
  assert.ok(save.indexOf("prepareStockWriteIntent")<save.indexOf("submitStockIntent"));
  assert.ok(cancel.indexOf("prepareStockWriteIntent")<cancel.indexOf("submitStockIntent"));
  assert.doesNotMatch(save,/api\("\/api\/stock\/purchases/);
  assert.doesNotMatch(cancel,/api\("\/api\/stock\/purchases/);
});

test("Close Day stock blocker names purchase edit and cancel intents accurately",async()=>{
  const preflight=await readFile(new URL("../lib/close-day-device-preflight.ts",import.meta.url),"utf8");
  assert.match(preflight,/intent\.operation==="purchaseEdit"\?"การแก้รายการรับเข้า":"การยกเลิกรายการรับเข้า"/);
});
