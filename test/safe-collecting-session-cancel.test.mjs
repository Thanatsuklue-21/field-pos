import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("generic split cancel rejects provider-managed sessions before stock restore",async()=>{
  const pos=await read("lib/pos-api.mjs");
  const start=pos.indexOf("export async function cancelSplitPayment");
  const end=pos.indexOf("export async function resolveSplitPayment",start);
  const block=pos.slice(start,end);
  assert.match(block,/split_session_provider_managed/);
  assert.match(block,/session\.providerCharge\?\.chargeId/);
  assert.match(block,/session\.providerChargeAttempt\?\.state==='creating'/);
  assert.match(block,/session\.mode==='promptpay_full'/);
  assert.ok(block.indexOf("split_session_provider_managed")<block.indexOf("restoreStock"));
});

test("failed PromptPay webhook uses provider-final release instead of generic split cancel",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("if(path==='/api/payments/promptpay/webhook'");
  const end=api.indexOf("const sessionToken=cookie(req)",start);
  const block=api.slice(start,end);
  const failed=block.slice(block.indexOf("verified.eventType==='charge.failed'"));
  assert.match(failed,/releaseSplitPaymentProviderSession/);
  assert.match(failed,/paymentReference:String\(live\.chargeId\)/);
  assert.match(failed,/providerStatus:String\(live\.status\|\|'failed'\)\.toLowerCase\(\)/);
  assert.doesNotMatch(failed,/cancelSplitPayment/);
});

test("Orders only offers abandoned collecting cancellation when session is provider-free and unpaid",async()=>{
  const ui=await read("app/orders/page.tsx");
  assert.match(ui,/cancelAbandonedCollecting/);
  assert.match(ui,/r\.providerManaged!==true/);
  assert.match(ui,/r\.mode!=="promptpay_full"/);
  assert.match(ui,/\(r\.payments\?\.length\|\|0\)===0/);
  assert.match(ui,/!r\.providerCharge\?\.chargeId/);
  assert.match(ui,/\/api\/pos\/split\/cancel/);
  assert.match(ui,/ยกเลิก Split ที่ยังไม่รับเงิน · คืน Stock/);
});

test("payment session view exposes provider-managed state for UI safety decisions",async()=>{
  const pos=await read("lib/pos-api.mjs");
  const start=pos.indexOf("function splitSessionView");
  const end=pos.indexOf("function validateSplitAllocations",start);
  const block=pos.slice(start,end);
  assert.match(block,/mode:String\(s\.mode\|\|'split'\)/);
  assert.match(block,/providerManaged:/);
  assert.match(block,/s\.providerChargeAttempt\?\.state==='creating'/);
});
