import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("expired sessions with an attached PromptPay charge require resolution without restoring stock",async()=>{
  const pos=await read("lib/pos-api.mjs");
  const start=pos.indexOf("function cleanupExpiredPaymentSessions");
  const end=pos.indexOf("function prunePaymentSessions",start);
  const block=pos.slice(start,end);
  assert.match(block,/s\.providerCharge\?\.chargeId/);
  assert.match(block,/requires_resolution/);
  const providerBranch=block.slice(block.indexOf("providerCharge"));
  assert.ok(providerBranch.indexOf("requires_resolution")<providerBranch.indexOf("restoreStock"));
});

test("late verified PromptPay can finalize requires-resolution session but other methods cannot",async()=>{
  const pos=await read("lib/pos-api.mjs");
  const start=pos.indexOf("export async function paySplitPayment");
  const end=pos.indexOf("export async function listSplitPaymentSessions",start);
  const block=pos.slice(start,end);
  assert.match(block,/lateVerifiedPromptPay/);
  assert.match(block,/session\.status==='requires_resolution'/);
  assert.match(block,/String\(body\.paymentReference\|\|''\)===String\(session\.providerCharge\.chargeId\)/);
  assert.match(block,/session\.status==='collecting'\|\|lateVerifiedPromptPay/);
});

test("PromptPay webhook accepts verified success for collecting or requires-resolution session",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("if(path==='/api/payments/promptpay/webhook'");
  const end=api.indexOf("const sessionToken=cookie(req)",start);
  const block=api.slice(start,end);
  assert.match(block,/\['collecting','requires_resolution'\]\.includes\(ctx\.status\)/);
  assert.match(block,/paymentReference:live\.chargeId/);
  assert.match(block,/paymentVerified:live\.chargeId/);
});
