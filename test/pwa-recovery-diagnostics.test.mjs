import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("recovery diagnostics expose only counts and presence flags",async()=>{
  const helper=await read("lib/recovery-diagnostics.ts");
  assert.ok(helper.includes('field-pos-held-carts-v1'));
  assert.ok(helper.includes('field-pos-pending-promptpay-v1'));
  assert.ok(helper.includes('field-pos-pending-cash-v1'));
  assert.ok(helper.includes('field-pos-split-group-v1'));
  assert.ok(helper.includes('field-pos-edit-cash-v1'));
  for(const sensitive of [".body",".customerId",".paymentReference",".received",".total"])assert.ok(!helper.includes(sensitive),sensitive);
});

test("PWA snapshot publishes recovery diagnostics without transaction payloads",async()=>{
  const runtime=await read("components/pwa-runtime.tsx"),meta=await read("lib/pwa-meta.ts");
  assert.ok(runtime.includes("readRecoveryDiagnostics(cartCountRef.current)"));
  for(const token of ["recoveryCartItems","recoveryHeldBills","recoveryPromptPay","recoveryCash","recoverySplit","recoveryEditCash"]){
    assert.ok(runtime.includes(token),token);
    assert.ok(meta.includes(token),token);
  }
});

test("readiness panel summarizes recovery state as clear or coarse labels",async()=>{
  const ui=await read("components/pwa-readiness.tsx");
  assert.ok(ui.includes('["Recovery",recoveryLabel,recoveryParts.length===0]'));
  assert.ok(ui.includes('"Cart "+state?.recoveryCartItems'));
  assert.ok(ui.includes('"Held "+state?.recoveryHeldBills'));
  assert.ok(ui.includes('state?.recoveryPromptPay?"PromptPay":null'));
  assert.ok(ui.includes('state?.recoveryCash?"Cash":null'));
  assert.ok(ui.includes('state?.recoverySplit?"Split":null'));
  assert.ok(ui.includes('state?.recoveryEditCash?"Edit":null'));
  assert.ok(ui.includes(':"CLEAR"'));
});
