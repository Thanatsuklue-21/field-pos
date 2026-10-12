import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("expired ambiguous provider attempt enters requires_resolution without stock release",async()=>{
  const pos=await read("lib/pos-api.mjs");
  const start=pos.indexOf("function cleanupExpiredPaymentSessions");
  const end=pos.indexOf("function prunePaymentSessions",start);
  const block=pos.slice(start,end);
  assert.match(block,/s\.providerChargeAttempt\?\.state==='creating'/);
  assert.match(block,/requires_resolution/);
  assert.ok(block.indexOf("providerChargeAttempt")<block.indexOf("restoreStock"));
});

test("provider context and session view expose sanitized attempt evidence",async()=>{
  const pos=await read("lib/pos-api.mjs");
  assert.match(pos,/providerAttempt:s\.providerChargeAttempt\?\{/);
  assert.match(pos,/providerAttempt:session\.providerChargeAttempt\?\{/);
  assert.match(pos,/provider:String\(session\.providerChargeAttempt\.provider\|\|""\)/);
  assert.match(pos,/startedAt:n\(session\.providerChargeAttempt\.startedAt\)/);
});

test("admin reconcile can recover only recent ambiguous Beam attempts with same provider",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("if(path==='/api/pos/payment-resolutions/reconcile'");
  const end=api.indexOf("if(path==='/api/pos/split/resolve'",start);
  const block=api.slice(start,end);
  assert.match(block,/attempt\?\.state!=='creating'/);
  assert.match(block,/String\(attempt\.provider\|\|''\)!=='beam'/);
  assert.match(block,/30\*60\*1000/);
  assert.match(block,/promptpay_recovery_window_elapsed/);
  assert.match(block,/promptPayConfig\(\)\.selectedProvider/);
  assert.match(block,/promptpay_provider_changed/);
  assert.match(block,/createPromptPayCharge\(\{amount:ctx\.total,reference:ctx\.id\}\)/);
  assert.match(block,/attachSplitPaymentProviderCharge/);
});

test("Orders explains ambiguous Beam identity recovery and fails closed outside safe path",async()=>{
  const ui=await read("app/orders/page.tsx");
  assert.match(ui,/recoverableAttempt/);
  assert.match(ui,/r\.providerAttempt\?\.state==="creating"/);
  assert.match(ui,/r\.providerAttempt\?\.provider==="beam"/);
  assert.match(ui,/กู้ด้วย Beam idempotency เดิม/);
  assert.match(ui,/promptpay_recovery_window_elapsed/);
  assert.match(ui,/promptpay_provider_changed/);
});
