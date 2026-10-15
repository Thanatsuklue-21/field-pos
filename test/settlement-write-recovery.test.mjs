import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import ts from "typescript";

async function mod(t){
  const source=await readFile(new URL("../lib/settlement-write-recovery.ts",import.meta.url),"utf8");
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  return import("data:text/javascript;base64,"+Buffer.from(code+"\n// "+t.name).toString("base64"));
}
function storage(){const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m}}
const reconcile=(extra={})=>({requestKey:"settlement-reconcile-01",operation:"reconcile",saleDate:"2026-10-14",platform:"grab",receivedAmount:70,receivedDate:"2026-10-15",note:" bank ref ",...extra});

test("settlement recovery persists normalized reconcile identity and blocks another write",async t=>{
  const x=await mod(t),store=storage(),intent=x.prepareSettlementWriteIntent("owner",reconcile(),store);
  assert.equal(intent.body.note,"bank ref");
  assert.equal(x.readSettlementWriteIntent("owner",store)?.body.requestKey,intent.body.requestKey);
  assert.throws(()=>x.prepareSettlementWriteIntent("owner",{requestKey:"settlement-cancel-02",operation:"cancel",settlementId:"drec-1",reason:"wrong amount"},store),/pending_settlement_write_exists/);
});

test("lost reconcile response keeps request and exact replay clears it",async t=>{
  const x=await mod(t),store=storage(),intent=x.prepareSettlementWriteIntent("owner",reconcile(),store);
  await assert.rejects(x.sendSettlementWriteIntent(intent,async()=>{throw Object.assign(new Error("network_unavailable"),{status:0})},store),/network_unavailable/);
  assert.equal(x.readSettlementWriteIntent("owner",store)?.body.requestKey,intent.body.requestKey);
  const result=await x.sendSettlementWriteIntent(intent,async body=>({ok:true,requestKey:body.requestKey,performedBy:"owner",operation:"reconcile",reconciliation:{id:"drec-1",saleDate:body.saleDate,platform:body.platform,receivedAmount:body.receivedAmount,receivedDate:body.receivedDate,note:body.note}}),store);
  assert.equal(result.reconciliation.id,"drec-1");assert.equal(x.readSettlementWriteIntent("owner",store),null);
});

test("cancel exact ACK clears while authoritative pre-commit rejection clears safely",async t=>{
  const x=await mod(t),cancelStore=storage(),cancel=x.prepareSettlementWriteIntent("owner",{requestKey:"settlement-cancel-01",operation:"cancel",settlementId:"drec-1",reason:"wrong amount"},cancelStore);
  await x.sendSettlementWriteIntent(cancel,async body=>({ok:true,requestKey:body.requestKey,performedBy:"owner",operation:"cancel",id:body.settlementId,reason:body.reason,cancelledAt:100,cancelledBy:"owner"}),cancelStore);
  assert.equal(x.readSettlementWriteIntent("owner",cancelStore),null);

  const rejectStore=storage(),reject=x.prepareSettlementWriteIntent("owner",reconcile({requestKey:"settlement-reconcile-02"}),rejectStore);
  await assert.rejects(x.sendSettlementWriteIntent(reject,async()=>{throw Object.assign(new Error("delivery_settlement_group_not_found"),{status:409})},rejectStore),/delivery_settlement_group_not_found/);
  assert.equal(x.readSettlementWriteIntent("owner",rejectStore),null);
});

test("inexact settlement ACK remains recoverable",async t=>{
  const x=await mod(t),store=storage(),intent=x.prepareSettlementWriteIntent("owner",reconcile(),store);
  await assert.rejects(x.sendSettlementWriteIntent(intent,async body=>({ok:true,requestKey:body.requestKey,performedBy:"other",operation:"reconcile",reconciliation:{id:"drec-1",saleDate:body.saleDate,platform:body.platform,receivedAmount:body.receivedAmount,receivedDate:body.receivedDate,note:body.note}}),store),/settlement_ack_unknown/);
  assert.equal(x.readSettlementWriteIntent("owner",store)?.body.requestKey,intent.body.requestKey);
});

test("settlement UI persists reconcile and cancel before send and auto-replays exact request",async()=>{
  const ui=await readFile(new URL("../app/settlements/page.tsx",import.meta.url),"utf8");
  assert.match(ui,/prepareSettlementWriteIntent/);
  assert.match(ui,/sendSettlementWriteIntent/);
  assert.match(ui,/readSettlementWriteIntent/);
  assert.match(ui,/operation:"reconcile"/);
  assert.match(ui,/operation:"cancel"/);
  assert.match(ui,/window\.addEventListener\("online",recover\)/);
  assert.match(ui,/window\.addEventListener\("focus",recover\)/);
  assert.match(ui,/ห้ามบันทึกหรือยกเลิกด้วย Request ใหม่/);
  for(const marker of ['operation:"reconcile"','operation:"cancel"']){
    const start=ui.indexOf(marker),persisted=ui.indexOf("setPendingSettlementIntent(intent)",start),sent=ui.indexOf("await submitSettlementIntent(intent,false)",persisted);
    assert.ok(start>=0&&persisted>start&&sent>persisted);
  }
});
