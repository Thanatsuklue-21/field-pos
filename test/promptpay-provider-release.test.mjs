import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("provider-release API rechecks provider state before releasing stock",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("if(path==='/api/pos/split/provider-release'");
  const end=api.indexOf("if(path==='/api/pos/split/cancel'",start);
  const block=api.slice(start,end);
  assert.match(block,/getSplitPaymentProviderContext/);
  assert.match(block,/getPromptPayCharge/);
  assert.match(block,/if\(live\.paid\).*promptpay_already_paid/);
  assert.match(block,/\['failed','expired','reversed'\]\.includes\(finalStatus\)/);
  assert.match(block,/releaseSplitPaymentProviderSession/);
});

test("client never clears local PromptPay pending until server confirms provider release",async()=>{
  const pos=await read("app/pos/page.tsx");
  const start=pos.indexOf("async function cancelPendingReservation");
  const end=pos.indexOf("async function ensurePendingPrompt",start);
  const block=pos.slice(start,end);
  assert.match(block,/\/api\/pos\/split\/provider-release/);
  assert.match(block,/return true/);
  assert.match(block,/promptpay_provider_not_final/);
  const recover=pos.slice(pos.indexOf("async function recoverPending"),pos.indexOf("function errorText"));
  assert.match(recover,/const released=await cancelPendingReservation\(p\)/);
  assert.match(recover,/if\(released\)\{pendingClear\(\);return\}/);
  assert.match(recover,/Server ยังไม่ยืนยันการคืน Stock/);
});

test("checkout keeps pending evidence when provider release is unconfirmed",async()=>{
  const pos=await read("app/pos/page.tsx");
  const start=pos.indexOf('if(method==="promptpay")');
  const end=pos.indexOf('if(["bank","card"].includes(method))',start);
  const block=pos.slice(start,end);
  assert.match(block,/const released=await cancelPendingReservation\(resumed\)/);
  assert.match(block,/if\(released\)pendingClear\(\)/);
  assert.match(block,/promptpay_release_unconfirmed/);
});
