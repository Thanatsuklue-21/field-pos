import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("PromptPay create is server-authoritative and durable",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("if(path==='/api/payments/promptpay/create'");
  const end=api.indexOf("if(path==='/api/payments/promptpay/status'",start);
  const block=api.slice(start,end);
  assert.match(block,/getSplitPaymentProviderContext/);
  assert.match(block,/ctx\.providerCharge\?\.chargeId/);
  assert.match(block,/beginSplitPaymentProviderCharge/);
  assert.match(block,/createPromptPayCharge\(\{amount:ctx\.total,reference\}\)/);
  assert.match(block,/attachSplitPaymentProviderCharge/);
  assert.doesNotMatch(block,/amount:b\.amount/);
});

test("expired provider-managed sessions retain stock for reconciliation",async()=>{
  const posApi=await read("lib/pos-api.mjs");
  const start=posApi.indexOf("function cleanupExpiredPaymentSessions");
  const end=posApi.indexOf("function prunePaymentSessions",start);
  const block=posApi.slice(start,end);
  assert.match(block,/providerCharge\?\.chargeId/);
  assert.match(block,/providerChargeAttempt\?\.state==='creating'/);
  assert.match(block,/requires_resolution/);
  assert.match(block,/stockRestored:false/);
});

test("late verified PromptPay can settle only the attached provider charge",async()=>{
  const posApi=await read("lib/pos-api.mjs");
  const start=posApi.indexOf("export async function paySplitPayment");
  const end=posApi.indexOf("export async function listSplitPaymentSessions",start);
  const block=posApi.slice(start,end);
  assert.match(block,/lateProviderPayment/);
  assert.match(block,/session\.providerCharge\?\.chargeId/);
  assert.match(block,/body\.paymentReference/);
  assert.match(block,/requires_resolution/);
});

test("provider final failure releases stock through verified provider route",async()=>{
  const api=await read("lib/api.mjs");
  assert.match(api,/\/api\/pos\/split\/provider-release/);
  assert.match(api,/getPromptPayCharge\(chargeId\)/);
  assert.match(api,/promptpay_provider_not_final/);
  assert.match(api,/releaseSplitPaymentProviderSession/);
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/\/api\/pos\/split\/provider-release/);
});

test("ordinary cancel and manual resolution cannot bypass provider-managed PromptPay",async()=>{
  const posApi=await read("lib/pos-api.mjs");
  assert.match(posApi,/split_session_provider_managed/);
  assert.match(posApi,/split_resolution_provider_managed/);
});

test("PromptPay client no longer supplies an authoritative amount to charge creation",async()=>{
  const pos=await read("app/pos/page.tsx");
  const start=pos.indexOf("async function ensurePendingPrompt");
  const end=pos.indexOf("async function recoverPending",start);
  const block=pos.slice(start,end);
  assert.match(block,/JSON\.stringify\(\{reference:next\.sessionId\}\)/);
  assert.doesNotMatch(block,/amount:next\.total,reference:next\.sessionId/);
});
