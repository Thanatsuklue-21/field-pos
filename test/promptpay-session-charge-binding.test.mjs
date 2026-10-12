import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const api=readFileSync(new URL('../lib/api.mjs',import.meta.url),'utf8');

test('split PromptPay checkout is bound to the server-attached charge',()=>{
  assert.match(api,/const ctx=await getSplitPaymentProviderContext\(\{db,sessionId:String\(b\.sessionId\|\|''\)\}\)/);
  assert.match(api,/boundChargeId!==String\(b\.paymentReference\|\|''\).*promptpay_session_charge_mismatch/s);
  assert.match(api,/getPromptPayCharge\(boundChargeId\)/);
  assert.match(api,/String\(charge\.referenceId\|\|ctx\.id\)!==String\(ctx\.id\).*promptpay_reference_mismatch/s);
  assert.match(api,/Math\.abs\(Number\(charge\.amount\)-Number\(ctx\.total\)\)>0\.009.*promptpay_amount_mismatch/s);
});

test('split PromptPay checkout does not trust a client-selected paid charge directly',()=>{
  const splitPay=api.indexOf("if(path==='/api/pos/split/pay'");
  const splitStatus=api.indexOf("if(path==='/api/pos/split/status'",splitPay);
  assert.ok(splitPay>=0&&splitStatus>splitPay);
  const block=api.slice(splitPay,splitStatus);
  assert.doesNotMatch(block,/getPromptPayCharge\(b\.paymentReference\)/);
  assert.match(block,/promptpay_session_charge_mismatch/);
});
