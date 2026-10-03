import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {
  beamPromptPayConfig,
  createBeamPromptPayCharge,
  getBeamPromptPayCharge,
  verifyBeamPromptPayWebhook
} from '../lib/payment-beam.mjs';

const originalFetch=globalThis.fetch;
const originalEnv={
  BEAM_MERCHANT_ID:process.env.BEAM_MERCHANT_ID,
  BEAM_API_KEY:process.env.BEAM_API_KEY,
  BEAM_WEBHOOK_HMAC_KEY:process.env.BEAM_WEBHOOK_HMAC_KEY,
  BEAM_ENV:process.env.BEAM_ENV,
  PUBLIC_ORIGIN:process.env.PUBLIC_ORIGIN
};

function restore(name,value){if(value===undefined)delete process.env[name];else process.env[name]=value}

test.afterEach(()=>{
  globalThis.fetch=originalFetch;
  for(const [name,value] of Object.entries(originalEnv))restore(name,value);
});

test('Beam config exposes readiness without secrets',()=>{
  process.env.BEAM_MERCHANT_ID='merchant_test';
  process.env.BEAM_API_KEY='secret-api-key';
  process.env.BEAM_WEBHOOK_HMAC_KEY=Buffer.from('webhook-secret').toString('base64');
  process.env.BEAM_ENV='playground';
  const cfg=beamPromptPayConfig();
  assert.equal(cfg.provider,'beam');
  assert.equal(cfg.configured,true);
  assert.equal(cfg.mode,'test');
  assert.equal(cfg.webhookConfigured,true);
  assert.equal(cfg.ready,true);
  assert.deepEqual(cfg.missing,[]);
  assert.equal(JSON.stringify(cfg).includes('secret-api-key'),false);
});


test('Beam readiness reports missing server configuration without exposing values',()=>{
  delete process.env.BEAM_MERCHANT_ID;
  delete process.env.BEAM_API_KEY;
  delete process.env.BEAM_WEBHOOK_HMAC_KEY;
  const cfg=beamPromptPayConfig();
  assert.equal(cfg.configured,false);
  assert.equal(cfg.ready,false);
  assert.deepEqual(cfg.missing,['BEAM_MERCHANT_ID','BEAM_API_KEY','BEAM_WEBHOOK_HMAC_KEY']);
});

test('create Beam PromptPay charge sends satang, idempotency key and returns data URL',async()=>{
  process.env.BEAM_MERCHANT_ID='merchant_test';
  process.env.BEAM_API_KEY='api_test';
  process.env.BEAM_ENV='playground';
  process.env.PUBLIC_ORIGIN='https://field.example';
  globalThis.fetch=async(url,init)=>{
    assert.equal(url,'https://playground.api.beamcheckout.com/api/v1/charges');
    assert.equal(init.method,'POST');
    assert.equal(init.headers['x-beam-idempotency-key'],'req-12345678');
    assert.match(String(init.headers.Authorization),/^Basic /);
    const body=JSON.parse(String(init.body));
    assert.equal(body.amount,5500);
    assert.equal(body.currency,'THB');
    assert.equal(body.referenceId,'req-12345678');
    assert.equal(body.paymentMethod.paymentMethodType,'QR_PROMPT_PAY');
    assert.equal(body.returnUrl,'https://field.example/pos');
    return new Response(JSON.stringify({
      actionRequired:'ENCODED_IMAGE',
      chargeId:'ch_2xTsz7Qit55pahSvKfJG3UMkpFQ',
      encodedImage:{expiry:'2026-10-03T10:20:00Z',imageBase64Encoded:'aGVsbG8='},
      paymentMethodType:'QR_PROMPT_PAY'
    }),{status:201,headers:{'content-type':'application/json'}});
  };
  const out=await createBeamPromptPayCharge({amount:55,reference:'req-12345678'});
  assert.equal(out.provider,'beam');
  assert.equal(out.amount,55);
  assert.equal(out.paid,false);
  assert.equal(out.qrUrl,'data:image/png;base64,aGVsbG8=');
});

test('get Beam charge recognizes SUCCEEDED',async()=>{
  process.env.BEAM_MERCHANT_ID='merchant_test';
  process.env.BEAM_API_KEY='api_test';
  process.env.BEAM_ENV='playground';
  globalThis.fetch=async()=>new Response(JSON.stringify({
    chargeId:'ch_2xTsz7Qit55pahSvKfJG3UMkpFQ',
    referenceId:'req-1',
    status:'SUCCEEDED',
    amount:6500,
    currency:'THB'
  }),{status:200,headers:{'content-type':'application/json'}});
  const out=await getBeamPromptPayCharge('ch_2xTsz7Qit55pahSvKfJG3UMkpFQ');
  assert.equal(out.paid,true);
  assert.equal(out.amount,65);
});

test('Beam webhook validates HMAC over exact raw body',async()=>{
  process.env.BEAM_MERCHANT_ID='merchant_test';
  const secret=Buffer.from('webhook-secret');
  process.env.BEAM_WEBHOOK_HMAC_KEY=secret.toString('base64');
  const rawBody='{"chargeId":"ch_2xTsz7Qit55pahSvKfJG3UMkpFQ","merchantId":"merchant_test","referenceId":"req-1","status":"SUCCEEDED","currency":"THB","amount":5500}';
  const signature=createHmac('sha256',secret).update(Buffer.from(rawBody)).digest('base64');
  const event=JSON.parse(rawBody);
  const out=await verifyBeamPromptPayWebhook(event,{rawBody,headers:{'x-beam-signature':signature,'x-beam-event':'charge.succeeded'}});
  assert.equal(out.ok,true);
  assert.equal(out.charge.paid,true);
  assert.equal(out.charge.amount,55);
  await assert.rejects(
    ()=>verifyBeamPromptPayWebhook(event,{rawBody,headers:{'x-beam-signature':'AAAA','x-beam-event':'charge.succeeded'}}),
    /invalid_webhook_signature/
  );
});
