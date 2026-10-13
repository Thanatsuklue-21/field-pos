import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import ts from "typescript";

async function mod(t){
  const source=await readFile(new URL("../lib/order-mutation-recovery.ts",import.meta.url),"utf8");
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
    removeItem:k=>m.delete(k)
  };
}
const voidBody={requestKey:"void-recovery-0001",saleId:"sale-1",reason:"customer changed",riskConfirmed:true};
const refundBody={requestKey:"refund-recovery-0001",saleId:"sale-2",reason:"customer refund",riskConfirmed:true,manualConfirmed:true,manualReference:"bank-ref-1"};

test("VOID intent survives network unknown and clears only after exact ACK",async t=>{
  const x=await mod(t),s=storage(),intent=x.prepareOrderMutationIntent("owner","void","2026-10-13",voidBody,s);
  await assert.rejects(x.sendOrderMutationIntent(intent,async()=>{throw Object.assign(new Error("network_unavailable"),{status:0})},new Set(),s),/network_unavailable/);
  assert.equal(x.readOrderMutationIntent("owner",s).body.requestKey,voidBody.requestKey);
  await assert.rejects(x.sendOrderMutationIntent(intent,async()=>({ok:true,requestKey:voidBody.requestKey,performedBy:"other",saleId:"sale-1",orderId:"order-1"}),new Set(),s),/order_mutation_ack_unknown/);
  assert.ok(x.readOrderMutationIntent("owner",s));
  const result=await x.sendOrderMutationIntent(intent,async()=>({ok:true,requestKey:voidBody.requestKey,performedBy:"owner",saleId:"sale-1",orderId:"order-1"}),new Set(),s);
  assert.equal(result.ok,true);assert.equal(x.readOrderMutationIntent("owner",s),null);
});

test("Refund recovery preserves the exact manual reference and payload",async t=>{
  const x=await mod(t),s=storage(),intent=x.prepareOrderMutationIntent("owner","refund","2026-10-13",refundBody,s);
  assert.equal(x.readOrderMutationIntent("owner",s).body.manualReference,"bank-ref-1");
  assert.throws(()=>x.prepareOrderMutationIntent("owner","refund","2026-10-13",{...refundBody,manualReference:"changed"},s),/pending_order_mutation_exists/);
  const result=await x.sendOrderMutationIntent(intent,async body=>{
    assert.deepEqual(body,refundBody);
    return {ok:true,requestKey:body.requestKey,performedBy:"owner",saleId:body.saleId,saleIds:[body.saleId],refundAmount:55};
  },new Set(),s);
  assert.equal(result.refundAmount,55);assert.equal(x.readOrderMutationIntent("owner",s),null);
});

test("authoritative pre-commit rejection clears only that uncommitted intent",async t=>{
  const x=await mod(t),s=storage(),intent=x.prepareOrderMutationIntent("owner","void","2026-10-13",voidBody,s);
  await assert.rejects(
    x.sendOrderMutationIntent(intent,async()=>{throw Object.assign(new Error("void_after_production_started"),{status:409})},new Set(["void_after_production_started"]),s),
    /void_after_production_started/
  );
  assert.equal(x.readOrderMutationIntent("owner",s),null);
});

test("request-key conflict remains fail closed for operator review",async t=>{
  const x=await mod(t),s=storage(),intent=x.prepareOrderMutationIntent("owner","refund","2026-10-13",refundBody,s);
  await assert.rejects(
    x.sendOrderMutationIntent(intent,async()=>{throw Object.assign(new Error("request_key_conflict"),{status:409})},new Set(["sale_not_found"]),s),
    /request_key_conflict/
  );
  assert.ok(x.readOrderMutationIntent("owner",s));
});

test("device can enumerate unresolved VOID and refund intents across users",async t=>{
  const x=await mod(t),s=storage();
  x.prepareOrderMutationIntent("owner","void","2026-10-13",voidBody,s);
  x.prepareOrderMutationIntent("staff-2","refund","2026-10-13",{...refundBody,requestKey:"refund-recovery-0002"},s);
  assert.deepEqual(x.listOrderMutationIntents(s).map(v=>v.actorId).sort(),["owner","staff-2"]);
});

test("Orders UI replays pending mutation on reconnect focus and visible resume",async()=>{
  const ui=await readFile(new URL("../app/orders/page.tsx",import.meta.url),"utf8");
  assert.match(ui,/prepareOrderMutationIntent/);
  assert.match(ui,/sendOrderMutationIntent/);
  assert.match(ui,/readOrderMutationIntent/);
  assert.match(ui,/window\.addEventListener\("online",onOnline\)/);
  assert.match(ui,/window\.addEventListener\("focus",onFocus\)/);
  assert.match(ui,/document\.addEventListener\("visibilitychange",onVisible\)/);
  assert.match(ui,/มี \{pendingOrderMutation\.operation===\"void\"\?\"VOID\":\"Refund\"\} เดิมที่ยังไม่ทราบผล/);
  assert.match(ui,/ตรวจรายการเดิม/);
  assert.doesNotMatch(ui,/\/api\/pos\/refund"[\s\S]{0,180}requestKey:crypto\.randomUUID\(\)/);
  assert.doesNotMatch(ui,/\/api\/pos\/void"[\s\S]{0,180}requestKey:crypto\.randomUUID\(\)/);
});
