import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
test('PromptPay API routes use provider adapter and preserve raw webhook body',async()=>{
  const api=await read('lib/api.mjs'),route=await read('app/api/[...route]/route.js');
  assert.match(api,/payment-promptpay\.mjs/);
  assert.match(api,/rawBody:req\.rawBody/);
  assert.match(api,/headers:req\.headers/);
  assert.match(route,/rawBody=raw/);
  assert.match(route,/body,rawBody/);
});
test('POS reserves stock before creating Beam QR and uses reservation id as idempotent reference',async()=>{
  const pos=await read('app/pos/page.tsx');
  assert.match(pos,/\/api\/pos\/split\/start/);
  assert.match(pos,/reference:next\.sessionId/);
  assert.ok(pos.indexOf('/api/pos/split/start')<pos.indexOf('/api/payments/promptpay/create'));
});
