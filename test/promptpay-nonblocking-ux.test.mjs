import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("PromptPay checkout no longer blocks the cashier in a 15 minute polling loop",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.doesNotMatch(pos,/deadline=Date\.now\(\)\+15\*60\*1000/);
  assert.doesNotMatch(pos,/while\(!st\.paid&&Date\.now\(\)<deadline\)/);
  assert.match(pos,/QR พร้อมชำระ · ระบบตรวจ QR เดิมอัตโนมัติทุก 3 วินาที/);
  assert.match(pos,/setInterval\(tick,3000\)/);
});

test("PromptPay background reconciliation is serialized and reuses the existing pending record",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/promptReconcileRef=useRef\(false\)/);
  const start=pos.indexOf("async function recoverPending");
  const end=pos.indexOf("function errorText",start);
  const block=pos.slice(start,end);
  assert.match(block,/if\(promptReconcileRef\.current\)return/);
  assert.match(block,/promptReconcileRef\.current=true/);
  assert.match(block,/promptReconcileRef\.current=false/);
  assert.match(block,/pendingRead\(\)/);
  assert.match(block,/paymentReference:p\.paymentReference/);
});

test("an unresolved PromptPay locks order edits and alternate tenders",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/const hasPendingPrompt=!!pendingRead\(\)/);
  assert.match(pos,/unresolvedPrompt&&method!==\"promptpay\"/);
  assert.match(pos,/ช่องทางรับเงินอื่นถูกพักเพื่อป้องกันรับเงินซ้ำ/);
  assert.match(pos,/disabled=\{busy\|\|hasPendingPrompt\}/);
  assert.match(pos,/disabled=\{!online\|\|hasPendingPrompt\}/);
  assert.match(pos,/disabled=\{hasPendingPrompt\|\|maxRedeemPoints<1\}/);
  assert.match(pos,/กำลังรอผล QR เดิม/);
});

test("PromptPay paid recovery still finalizes through the existing durable session path",async()=>{
  const pos=await read("app/pos/page.tsx");
  const start=pos.indexOf("async function finalizePending");
  const end=pos.indexOf("async function cancelPendingReservation",start);
  const block=pos.slice(start,end);
  assert.match(block,/\/api\/pos\/split\/status/);
  assert.match(block,/\/api\/pos\/split\/pay/);
  assert.match(block,/pendingClear\(\)/);
  assert.match(block,/finishSale\(/);
});
