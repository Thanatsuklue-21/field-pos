import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('PromptPay create and recovery reject non-THB charges before returning or attaching them', async () => {
  const source=await readFile(new URL('../lib/api.mjs', import.meta.url),'utf8');
  const recovered=source.indexOf("if(String(existing.currency||'').toUpperCase()!=='THB')return reply(res,409,{error:'promptpay_currency_mismatch'});");
  const recoveredReturn=source.indexOf("return reply(res,200,{...existing,recoveredFromSession:true});", recovered);
  assert.ok(recovered>=0, 'recovered provider charges must validate THB currency');
  assert.ok(recoveredReturn>recovered, 'currency validation must happen before returning a recovered charge');

  const created=source.indexOf("if(String(charge.currency||'').toUpperCase()!=='THB')return reply(res,409,{error:'promptpay_currency_mismatch'});");
  const attach=source.indexOf('await attachSplitPaymentProviderCharge', created);
  assert.ok(created>=0, 'new provider charges must validate THB currency');
  assert.ok(attach>created, 'currency validation must happen before attaching a new provider charge');
});
