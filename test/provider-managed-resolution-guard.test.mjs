import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("generic split resolve rejects provider-managed PromptPay sessions",async()=>{
  const pos=await read("lib/pos-api.mjs");
  const start=pos.indexOf("export async function resolveSplitPayment");
  const end=pos.indexOf("export async function getQueueSnapshot",start);
  const block=pos.slice(start,end);
  assert.match(block,/session\.mode==='promptpay_full'/);
  assert.match(block,/session\.providerCharge\?\.chargeId/);
  assert.match(block,/session\.providerChargeAttempt\?\.state==='creating'/);
  assert.match(block,/split_session_provider_managed/);
  assert.ok(block.indexOf("split_session_provider_managed")<block.indexOf("session.status='collecting'"));
});

test("provider-authoritative Payment Resolution Console remains the PromptPay path",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("if(path==='/api/pos/payment-resolutions/reconcile'");
  const end=api.indexOf("if(path==='/api/pos/split/resolve'",start);
  const block=api.slice(start,end);
  assert.match(block,/getPromptPayCharge\(chargeId\)/);
  assert.match(block,/paySplitPayment/);
  assert.match(block,/releaseSplitPaymentProviderSession/);
});
