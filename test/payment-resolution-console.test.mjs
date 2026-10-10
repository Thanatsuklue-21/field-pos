import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("payment resolution endpoints are admin-only and provider-authoritative",async()=>{
  const api=await read("lib/api.mjs");
  const listStart=api.indexOf("if(path==='/api/pos/payment-resolutions'&&method==='GET')");
  const reconcileStart=api.indexOf("if(path==='/api/pos/payment-resolutions/reconcile'&&method==='POST')");
  const resolveStart=api.indexOf("if(path==='/api/pos/split/resolve'",reconcileStart);
  assert.ok(listStart>=0&&reconcileStart>listStart&&resolveStart>reconcileStart);
  const list=api.slice(listStart,reconcileStart);
  const reconcile=api.slice(reconcileStart,resolveStart);
  assert.match(list,/user\.role!=='admin'/);
  assert.match(reconcile,/user\.role!=='admin'/);
  assert.match(list,/getPromptPayCharge\(chargeId\)/);
  assert.match(reconcile,/getPromptPayCharge\(chargeId\)/);
  assert.doesNotMatch(reconcile,/b\.paid/);
  assert.doesNotMatch(reconcile,/b\.providerStatus/);
});

test("reconcile only finalizes verified paid charge or releases provider-final charge",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("if(path==='/api/pos/payment-resolutions/reconcile'");
  const end=api.indexOf("if(path==='/api/pos/split/resolve'",start);
  const block=api.slice(start,end);
  assert.match(block,/ctx\.status!=='requires_resolution'/);
  assert.match(block,/String\(live\.referenceId\|\|''\)!==ctx\.id/);
  assert.match(block,/promptpay_amount_mismatch/);
  assert.match(block,/if\(live\.paid===true\)/);
  assert.match(block,/paySplitPayment/);
  assert.match(block,/paymentReference:chargeId/);
  assert.match(block,/paymentVerified:chargeId/);
  assert.match(block,/\['failed','expired','reversed'\]\.includes\(status\)/);
  assert.match(block,/releaseSplitPaymentProviderSession/);
  assert.match(block,/outcome:'pending'/);
});

test("Orders exposes admin resolution evidence and never offers manual paid override",async()=>{
  const ui=await read("app/orders/page.tsx");
  assert.match(ui,/Payment Resolution Console/);
  assert.match(ui,/\/api\/pos\/payment-resolutions/);
  assert.match(ui,/\/api\/pos\/payment-resolutions\/reconcile/);
  assert.match(ui,/ตรวจ Provider และ Reconcile อย่างปลอดภัย/);
  assert.match(ui,/amountMismatch/);
  assert.match(ui,/refMismatch/);
  assert.match(ui,/provider_check_failed/);
  assert.match(ui,/resolutionBusy/);
  assert.doesNotMatch(ui,/mark.*paid/i);
  assert.doesNotMatch(ui,/force.*paid/i);
});

test("resolution console is visible only to admin",async()=>{
  const ui=await read("app/orders/page.tsx");
  assert.match(ui,/session\.user\.role==="admin"&&<div[^>]*>/);
  assert.match(ui,/if\(session\.user\.role!=="admin"\)\{setResolutions\(\[\]\);return\}/);
});
