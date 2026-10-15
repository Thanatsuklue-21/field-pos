import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import ts from "typescript";

async function mod(t){
  const source=await readFile(new URL("../lib/close-day-write-recovery.ts",import.meta.url),"utf8");
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  return import("data:text/javascript;base64,"+Buffer.from(code+"\n// "+t.name).toString("base64"));
}
function storage(){
  const m=new Map();
  return {get length(){return m.size},key:i=>Array.from(m.keys())[i]??null,getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m};
}
const review=(extra={})=>({requestKey:"close-review-0001",operation:"review",date:"2026-10-15",firstCount:500,secondCount:500,...extra});

test("close-day recovery persists exact review identity and blocks a different close write",async t=>{
  const x=await mod(t),store=storage(),intent=x.prepareCloseDayWriteIntent("owner",review(),store);
  assert.equal(x.readCloseDayWriteIntent("owner",store)?.body.requestKey,intent.body.requestKey);
  assert.throws(()=>x.prepareCloseDayWriteIntent("owner",{requestKey:"close-commit-0001",operation:"close",date:"2026-10-15",openingCash:500,countedCash:500,reviewId:"r1",varianceReason:"",confirmVariance:false},store),/pending_close_day_write_exists/);
});

test("lost review response keeps intent and exact replay clears it",async t=>{
  const x=await mod(t),store=storage(),intent=x.prepareCloseDayWriteIntent("owner",review(),store);
  await assert.rejects(x.sendCloseDayWriteIntent(intent,async()=>{throw Object.assign(new Error("network_unavailable"),{status:0})},store),/network_unavailable/);
  assert.equal(x.readCloseDayWriteIntent("owner",store)?.body.requestKey,intent.body.requestKey);
  const result=await x.sendCloseDayWriteIntent(intent,async body=>({ok:true,requestKey:body.requestKey,performedBy:"owner",operation:"review",review:{id:"r1",date:body.date,createdBy:"owner",countedCash:body.secondCount}}),store);
  assert.equal(result.review.id,"r1");assert.equal(x.readCloseDayWriteIntent("owner",store),null);
});

test("lost close response keeps intent and exact replay clears it",async t=>{
  const x=await mod(t),store=storage();
  const body={requestKey:"close-commit-0002",operation:"close",date:"2026-10-15",openingCash:500,countedCash:500,reviewId:"r1",varianceReason:"",confirmVariance:false};
  const intent=x.prepareCloseDayWriteIntent("owner",body,store);
  await assert.rejects(x.sendCloseDayWriteIntent(intent,async()=>{throw Object.assign(new Error("network_unavailable"),{status:0})},store),/network_unavailable/);
  const result=await x.sendCloseDayWriteIntent(intent,async b=>({ok:true,requestKey:b.requestKey,performedBy:"owner",operation:"close",close:{id:"c1",date:b.date,closedBy:"owner",openingCash:b.openingCash,countedCash:b.countedCash,reviewId:b.reviewId,cashVariance:0,varianceReason:""}}),store);
  assert.equal(result.close.id,"c1");assert.equal(x.readCloseDayWriteIntent("owner",store),null);
});

test("authoritative recount mismatch clears intent but request-key conflict does not",async t=>{
  const x=await mod(t),mismatchStore=storage(),mismatch=x.prepareCloseDayWriteIntent("owner",review(),mismatchStore);
  await assert.rejects(x.sendCloseDayWriteIntent(mismatch,async()=>{throw Object.assign(new Error("cash_recount_mismatch"),{status:409})},mismatchStore),/cash_recount_mismatch/);
  assert.equal(x.readCloseDayWriteIntent("owner",mismatchStore),null);

  const conflictStore=storage(),conflict=x.prepareCloseDayWriteIntent("owner",review(),conflictStore);
  await assert.rejects(x.sendCloseDayWriteIntent(conflict,async()=>{throw Object.assign(new Error("request_key_conflict"),{status:409})},conflictStore),/request_key_conflict/);
  assert.ok(x.readCloseDayWriteIntent("owner",conflictStore));
});

test("close-day pending intents are enumerable for device preflight",async t=>{
  const x=await mod(t),store=storage();
  x.prepareCloseDayWriteIntent("owner",review(),store);
  assert.equal(x.listCloseDayWriteIntents(store).length,1);
  assert.equal(x.listCloseDayWriteIntents(store)[0].body.operation,"review");
});

test("Close Day UI persists review and final close before network send and auto-recovers",async()=>{
  const ui=await readFile(new URL("../app/close/page.tsx",import.meta.url),"utf8");
  assert.match(ui,/prepareCloseDayWriteIntent/);
  assert.match(ui,/sendCloseDayWriteIntent/);
  assert.match(ui,/readCloseDayWriteIntent/);
  assert.match(ui,/operation:"review"/);
  assert.match(ui,/operation:"close"/);
  assert.match(ui,/ห้ามสร้าง Request ใหม่/);
  assert.match(ui,/window\.addEventListener\("online",recover\)/);
  for(const marker of ['operation:"review"','operation:"close"']){
    const start=ui.indexOf(marker),persisted=ui.indexOf("setPendingCloseDayWrite(intent)",start),sent=ui.indexOf("await submitCloseDayIntent(intent,false)",persisted);
    assert.ok(start>=0&&persisted>start&&sent>persisted);
  }
});
