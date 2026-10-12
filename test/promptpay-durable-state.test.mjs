import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("PromptPay create route derives amount from server reservation and recovers attached charge",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("if(path==='/api/payments/promptpay/create'");
  const end=api.indexOf("if(path==='/api/payments/promptpay/status'",start);
  const block=api.slice(start,end);
  assert.match(block,/getSplitPaymentProviderContext/);
  assert.match(block,/ctx\.providerCharge\?\.chargeId/);
  assert.match(block,/createPromptPayCharge\(\{amount:ctx\.total,reference\}\)/);
  assert.doesNotMatch(block,/amount:b\.amount/);
  assert.match(block,/attachSplitPaymentProviderCharge/);
  assert.match(block,/recoveredFromSession:true/);
});

test("client restores charge identity from server session before creating another QR",async()=>{
  const pos=await read("app/pos/page.tsx");
  const start=pos.indexOf("async function ensurePendingPrompt");
  const end=pos.indexOf("async function recoverPending",start);
  const block=pos.slice(start,end);
  assert.match(block,/\/api\/pos\/split\/status/);
  assert.match(block,/serverSession\?\.session\?\.providerCharge/);
  assert.match(block,/paymentReference:String\(serverCharge\.chargeId\)/);
  assert.ok(block.indexOf("providerCharge")<block.indexOf("/api/payments/promptpay/create"));
  assert.match(block,/JSON\.stringify\(\{reference:next\.sessionId\}\)/);
  assert.doesNotMatch(block,/amount:next\.total,reference:next\.sessionId/);
});

test("PromptPay waiting no longer blocks checkout for fifteen minutes",async()=>{
  const pos=await read("app/pos/page.tsx");
  const start=pos.indexOf('if(method==="promptpay")');
  const end=pos.indexOf('if(["bank","card"].includes(method))',start);
  const block=pos.slice(start,end);
  assert.doesNotMatch(block,/15\*60\*1000/);
  assert.doesNotMatch(block,/while\(!st\.paid/);
  assert.match(block,/ระบบปลดล็อกหน้าจอแล้ว/);
  assert.match(block,/return;/);
  assert.match(pos,/setInterval\(tick,3000\)/);
  assert.match(pos,/promptReconcileRef/);
});

test("PromptPay reconcile mutex is released even when no local pending exists",async()=>{
  const pos=await read("app/pos/page.tsx");
  const start=pos.indexOf("async function recoverPending()");
  const end=pos.indexOf("function errorText",start);
  const block=pos.slice(start,end);
  assert.match(block,/if\(!p\)\{promptReconcileRef\.current=false;return\}/);
  assert.match(block,/finally\{\s*promptReconcileRef\.current=false;/);
});
