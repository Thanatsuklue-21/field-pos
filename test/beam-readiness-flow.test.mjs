import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('POS PromptPay reserves stock before creating provider QR',async()=>{
  const pos=await read('app/pos/page.tsx');
  const checkout=pos.slice(pos.indexOf('async function checkout()'),pos.indexOf('function openPayment()'));
  assert.match(checkout,/\/api\/pos\/split\/start/);
  assert.match(checkout,/mode:"promptpay_full"/);
  assert.match(checkout,/ensurePendingPrompt/);
  assert.ok(checkout.indexOf('/api/pos/split/start')<checkout.indexOf('/api/payments/promptpay/create'));
  assert.match(pos,/PromptPay ยังไม่เปิดรับเงินจริง/);
  assert.match(pos,/promptConfig\?\.ready!==true/);
});

test('Beam webhook can finalize the reserved payment server-side',async()=>{
  const api=await read('lib/api.mjs');
  const start=api.indexOf("if(path==='/api/payments/promptpay/webhook'");
  const end=api.indexOf("const sessionToken=cookie(req)",start);
  const seg=api.slice(start,end);
  assert.match(seg,/getSplitPaymentProviderContext/);
  assert.match(seg,/getPromptPayCharge/);
  assert.match(seg,/paySplitPayment/);
  assert.match(seg,/promptpay_amount_mismatch/);
  assert.match(seg,/provider-fail:/);
});

test('readiness requires Beam webhook configuration before enabling PromptPay',async()=>{
  const api=await read('lib/api.mjs');
  assert.match(api,/promptpay\.ready===true/);
  assert.match(api,/beam_webhook_not_configured/);
  const settings=await read('app/settings/page.tsx');
  assert.match(settings,/Webhook/);
  assert.match(settings,/readiness\.readyForPromptPay/);
});
