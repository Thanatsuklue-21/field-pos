import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {inspectPaymentRecoveryRaw} from "../lib/payment-recovery-integrity.mjs";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("payment recovery integrity accepts absent and valid pending records",()=>{
  assert.deepEqual(inspectPaymentRecoveryRaw({promptRaw:null,cashRaw:null}),{ok:true});
  const prompt=JSON.stringify({requestKey:"p-1",cart:[],createdAt:1,paymentReference:""});
  const cash=JSON.stringify({body:{requestKey:"c-1",cart:[]},createdAt:1});
  assert.deepEqual(inspectPaymentRecoveryRaw({promptRaw:prompt,cashRaw:cash}),{ok:true});
});

test("payment recovery integrity rejects malformed JSON and invalid shapes",()=>{
  assert.deepEqual(inspectPaymentRecoveryRaw({promptRaw:"{bad"}),{ok:false,kind:"promptpay",reason:"malformed_json"});
  assert.deepEqual(inspectPaymentRecoveryRaw({cashRaw:"[]"}),{ok:false,kind:"cash",reason:"invalid_shape"});
  assert.deepEqual(inspectPaymentRecoveryRaw({promptRaw:JSON.stringify({requestKey:"",cart:[],createdAt:1})}),{ok:false,kind:"promptpay",reason:"invalid_shape"});
  assert.deepEqual(inspectPaymentRecoveryRaw({cashRaw:JSON.stringify({body:{requestKey:"c",cart:[]},createdAt:0})}),{ok:false,kind:"cash",reason:"invalid_created_at"});
});

test("POS fails closed before checkout, payment open and hold when recovery storage is corrupt",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/paymentRecoveryIntegrityIssue/);
  assert.match(pos,/CRITICAL · ข้อมูล recovery การชำระผิดปกติ/);
  assert.match(pos,/FAIL CLOSED/);
  const checkout=pos.slice(pos.indexOf("async function checkout()"),pos.indexOf("function openPayment()"));
  assert.ok(checkout.indexOf("paymentRecoveryIntegrityIssue()")<checkout.indexOf("setBusy(true)"));
  assert.match(checkout,/ห้ามรับชำระรายการใหม่/);
  const hold=pos.slice(pos.indexOf("function holdCurrentBill()"),pos.indexOf("function resumeHeldBill"));
  assert.match(hold,/paymentRecoveryIntegrityIssue\(\)/);
  const open=pos.slice(pos.indexOf("function openPayment()"),pos.indexOf("return <section",pos.indexOf("function openPayment()")));
  assert.match(open,/paymentRecoveryIntegrityIssue\(\)/);
});

test("corrupt recovery can only be cleared by explicit admin review",async()=>{
  const pos=await read("app/pos/page.tsx");
  const start=pos.indexOf("function clearCorruptRecovery()");
  const end=pos.indexOf("function clearReviewedCashPending",start);
  const block=pos.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(block,/session\.user\.role!=="admin"/);
  assert.match(block,/window\.confirm/);
  assert.match(block,/ตรวจ Orders และผู้ให้บริการ PromptPay/);
  assert.match(block,/localStorage\.removeItem\(PENDING_KEY\)/);
  assert.match(block,/localStorage\.removeItem\(CASH_PENDING_KEY\)/);
});
