import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("provider release returns success from committed cancelled state without restoring stock twice",async()=>{
  const pos=await read("lib/pos-api.mjs");
  const start=pos.indexOf("export async function releaseSplitPaymentProviderSession");
  const end=pos.indexOf("export async function cancelSplitPayment",start);
  const block=pos.slice(start,end);
  assert.match(block,/session\.status==='cancelled'/);
  assert.match(block,/session\.providerReleasedAt/);
  assert.match(block,/stateReplay:true/);
  assert.ok(block.indexOf("stateReplay:true")<block.indexOf("restoreStock"));
});
