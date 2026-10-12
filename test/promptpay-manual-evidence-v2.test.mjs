import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("Opn charge normalization exposes FIELD session reference",async()=>{
  const opn=await read("lib/payment-opn.mjs");
  assert.match(opn,/provider:'opn'/);
  assert.match(opn,/description\|\|''\)\.startsWith\('FIELD '\)/);
  assert.match(opn,/String\(charge\.description\)\.slice\(6\)/);
  assert.match(opn,/form\.description='FIELD '\+ref/);
});

test("manual Charge ID reconcile fetches provider evidence before binding or resolving",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("if(path==='/api/pos/payment-resolutions/reconcile'");
  const end=api.indexOf("if(path==='/api/pos/split/resolve'",start);
  const block=api.slice(start,end);
  assert.match(block,/manualChargeId=String\(b\.chargeId\|\|''\)\.trim\(\)/);
  assert.match(block,/getPromptPayCharge\(manualChargeId\)/);
  assert.match(block,/String\(evidenced\.referenceId\|\|''\)!==ctx\.id/);
  assert.match(block,/promptpay_amount_mismatch/);
  assert.match(block,/attemptProvider&&evidenceProvider&&attemptProvider!==evidenceProvider/);
  assert.match(block,/attachSplitPaymentProviderCharge/);
  assert.ok(block.indexOf("getPromptPayCharge(manualChargeId)")<block.indexOf("attachSplitPaymentProviderCharge"));
  assert.doesNotMatch(block,/b\.paid/);
  assert.doesNotMatch(block,/b\.providerStatus/);
});

test("Orders accepts Charge ID evidence but keeps provider authoritative",async()=>{
  const ui=await read("app/orders/page.tsx");
  assert.match(ui,/resolutionChargeIds/);
  assert.match(ui,/Charge ID จาก Provider/);
  assert.match(ui,/ch_\.\.\. \/ chrg_\.\.\./);
  assert.match(ui,/Server จะดึงข้อมูลจาก Provider และตรวจ Session \/ ยอด \/ THB/);
  assert.match(ui,/chargeId:manualChargeId\|\|undefined/);
  assert.doesNotMatch(ui,/mark.*paid/i);
  assert.doesNotMatch(ui,/force.*release/i);
});
