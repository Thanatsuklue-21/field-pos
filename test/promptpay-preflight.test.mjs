import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {validatePromptPayAmount} from "../lib/payment-promptpay.mjs";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("PromptPay create validates provider amount before acquiring a creation lock",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("if(path==='/api/payments/promptpay/create'");
  const end=api.indexOf("if(path==='/api/payments/promptpay/status'",start);
  const block=api.slice(start,end);
  assert.match(block,/validatePromptPayAmount\(ctx\.total\)/);
  assert.match(block,/beginSplitPaymentProviderCharge/);
  assert.ok(block.indexOf("validatePromptPayAmount(ctx.total)")<block.indexOf("beginSplitPaymentProviderCharge"));
});

test("Beam and Opn enforce their provider minimum before any external creation attempt",()=>{
  const oldProvider=process.env.PROMPTPAY_PROVIDER;
  try{
    process.env.PROMPTPAY_PROVIDER="beam";
    assert.deepEqual(validatePromptPayAmount(1),{provider:"beam",min:1,max:150000,amount:1});
    assert.throws(()=>validatePromptPayAmount(.99),/promptpay_amount_out_of_range/);

    process.env.PROMPTPAY_PROVIDER="opn";
    assert.deepEqual(validatePromptPayAmount(20),{provider:"opn",min:20,max:150000,amount:20});
    assert.throws(()=>validatePromptPayAmount(19.99),/promptpay_amount_out_of_range/);
  }finally{
    if(oldProvider===undefined)delete process.env.PROMPTPAY_PROVIDER;
    else process.env.PROMPTPAY_PROVIDER=oldProvider;
  }
});

test("operator gets a clear action for PromptPay amount-range rejection",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/promptpay_amount_out_of_range/);
  assert.match(pos,/ยอดนี้อยู่นอกช่วงที่ระบบ QR รองรับ/);
});
