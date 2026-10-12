import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("PromptPay create route acquires a server creation lock before calling the provider",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("if(path==='/api/payments/promptpay/create'");
  const end=api.indexOf("if(path==='/api/payments/promptpay/status'",start);
  const block=api.slice(start,end);
  assert.match(block,/beginSplitPaymentProviderCharge/);
  assert.match(block,/selectedProvider/);
  assert.match(block,/attemptKey:'promptpay:'\+reference/);
  assert.ok(block.indexOf("beginSplitPaymentProviderCharge")<block.indexOf("createPromptPayCharge"));
});

test("creation lock only permits same Beam retry and fails closed for ambiguous non-idempotent attempts",async()=>{
  const pos=await read("lib/pos-api.mjs");
  const start=pos.indexOf("export async function beginSplitPaymentProviderCharge");
  const end=pos.indexOf("export async function attachSplitPaymentProviderCharge",start);
  const block=pos.slice(start,end);
  assert.match(block,/attempt\?\.state==='creating'/);
  assert.match(block,/String\(attempt\.provider\)==='beam'/);
  assert.match(block,/retryAllowed:true/);
  assert.match(block,/promptpay_charge_creation_unknown/);
});

test("operator sees explicit fail-closed guidance for unknown QR creation outcome",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/promptpay_charge_creation_unknown/);
  assert.match(pos,/ระบบหยุดสร้าง QR ใหม่เพื่อป้องกันเก็บเงินซ้ำ/);
});
