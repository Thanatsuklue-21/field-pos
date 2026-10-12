import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("unresolved PromptPay blocks cash bank card and delivery checkout before a new request",async()=>{
  const pos=await read("app/pos/page.tsx");
  const start=pos.indexOf("async function checkout()");
  const end=pos.indexOf("function openPayment()",start);
  const block=pos.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(block,/const unresolvedPrompt=pendingRead\(\)/);
  assert.match(block,/if\(unresolvedPrompt&&method!=="promptpay"\)/);
  assert.match(block,/ป้องกันรับเงินซ้ำ/);
  assert.ok(block.indexOf('if(unresolvedPrompt&&method!=="promptpay")')<block.indexOf("setBusy(true)"));
  assert.ok(block.indexOf('if(unresolvedPrompt&&method!=="promptpay")')<block.indexOf('api<any>("/api/pos/checkout"'));
});

test("PromptPay checkout remains allowed so the exact pending charge can be resumed",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/if\(method==="promptpay"\)\{/);
  assert.match(pos,/const existing=pendingRead\(\)/);
  assert.match(pos,/paymentReference=resumed\.paymentReference/);
  assert.match(pos,/requestKey=resumed\.requestKey/);
});
