import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("committed PromptPay release replays before restoreStock and without a second stock mutation",async()=>{
  const pos=await read("lib/pos-api.mjs");
  const start=pos.indexOf("export async function releaseSplitPaymentProviderSession");
  const end=pos.indexOf("export async function cancelSplitPayment",start);
  const block=pos.slice(start,end);
  assert.match(block,/session\.status==='cancelled'/);
  assert.match(block,/providerReleasedAt/);
  assert.match(block,/stateReplay:true/);
  assert.ok(block.indexOf("stateReplay:true")<block.indexOf("restoreStock"));
});

test("provider-release API short-circuits committed release before external provider lookup",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("if(path==='/api/pos/split/provider-release'");
  const end=api.indexOf("if(path==='/api/pos/split/cancel'",start);
  const block=api.slice(start,end);
  assert.match(block,/ctx\.status==='cancelled'/);
  assert.match(block,/ctx\.providerReleasedAt/);
  assert.match(block,/ctx\.providerFinalStatus/);
  assert.ok(block.indexOf("ctx.status==='cancelled'")<block.indexOf("getPromptPayCharge(chargeId)"));
});
