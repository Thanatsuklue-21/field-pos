import test from 'node:test';
import assert from 'node:assert/strict';
import {createPromptPayCharge,getPromptPayCharge,promptPayConfig} from '../lib/payment-opn.mjs';

const originalFetch=globalThis.fetch;
const originalKey=process.env.OMISE_SECRET_KEY;

test.afterEach(()=>{
  globalThis.fetch=originalFetch;
  if(originalKey===undefined)delete process.env.OMISE_SECRET_KEY;
  else process.env.OMISE_SECRET_KEY=originalKey;
});

test('PromptPay config exposes mode but never secret',()=>{
  process.env.OMISE_SECRET_KEY='skey_test_secret-value';
  const cfg=promptPayConfig();
  assert.equal(cfg.configured,true);
  assert.equal(cfg.mode,'test');
  assert.equal(JSON.stringify(cfg).includes('secret-value'),false);
});

test('createPromptPayCharge normalizes baht to satang and returns QR metadata',async()=>{
  process.env.OMISE_SECRET_KEY='skey_test_123';
  globalThis.fetch=async(url,init)=>{
    assert.equal(url,'https://api.omise.co/charges');
    assert.equal(init.method,'POST');
    assert.match(String(init.headers.Authorization),/^Basic /);
    const form=new URLSearchParams(String(init.body));
    assert.equal(form.get('amount'),'5500');
    assert.equal(form.get('currency'),'THB');
    assert.equal(form.get('source[type]'),'promptpay');
    return new Response(JSON.stringify({
      id:'chrg_test123',status:'pending',amount:5500,currency:'THB',
      source:{scannable_code:{image:{download_uri:'https://example.test/qr.png'}}}
    }),{status:200,headers:{'content-type':'application/json'}});
  };
  const out=await createPromptPayCharge({amount:55,reference:'A001'});
  assert.equal(out.chargeId,'chrg_test123');
  assert.equal(out.amount,55);
  assert.equal(out.paid,false);
  assert.equal(out.qrUrl,'https://example.test/qr.png');
});

test('getPromptPayCharge recognizes successful payment',async()=>{
  process.env.OMISE_SECRET_KEY='skey_test_123';
  globalThis.fetch=async()=>new Response(JSON.stringify({
    id:'chrg_test123',status:'successful',paid:true,amount:6500,currency:'THB',
    source:{scannable_code:{image:{download_uri:'https://example.test/qr.png'}}}
  }),{status:200,headers:{'content-type':'application/json'}});
  const out=await getPromptPayCharge('chrg_test123');
  assert.equal(out.paid,true);
  assert.equal(out.status,'successful');
  assert.equal(out.amount,65);
});

test('PromptPay rejects unsafe charge ids before network access',async()=>{
  process.env.OMISE_SECRET_KEY='skey_test_123';
  let called=false;globalThis.fetch=async()=>{called=true;throw new Error('should not call')};
  await assert.rejects(()=>getPromptPayCharge('../bad'),/invalid_charge_id/);
  assert.equal(called,false);
});
