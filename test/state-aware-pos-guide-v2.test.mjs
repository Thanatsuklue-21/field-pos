import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {buildPosGuidance} from "../lib/pos-guidance.mjs";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("state-aware guide follows select cart and payment state",()=>{
  assert.equal(buildPosGuidance({cartQty:0,online:true}).key,"select");
  assert.equal(buildPosGuidance({cartQty:2,online:true}).key,"checkout");
  assert.equal(buildPosGuidance({cartQty:2,payOpen:true,online:true}).key,"payment");
});

test("ambiguous payment recovery outranks all routine guidance",()=>{
  const guide=buildPosGuidance({recoveryBlocked:true,cartQty:3,payOpen:true,canOrder:true});
  assert.equal(guide.key,"recovery");
  assert.equal(guide.step,0);
  assert.equal(guide.action,"open_orders");
  assert.match(guide.message,/ป้องกันยอดหรือบิลซ้ำ/);
});

test("offline guide states the safe tender and pending sync count",()=>{
  const guide=buildPosGuidance({online:false,offlinePending:2});
  assert.equal(guide.key,"offline");
  assert.equal(guide.step,1);
  assert.match(guide.message,/เฉพาะเงินสด/);
  assert.match(guide.message,/2 บิล/);
});

test("cart guidance exposes one safe next action that reuses openPayment",async()=>{
  const guide=buildPosGuidance({cartQty:2,online:true});
  assert.equal(guide.action,"checkout");
  const pos=await read("app/pos/page.tsx");
  const start=pos.indexOf("function runGuideAction");
  const block=pos.slice(start,start+600);
  assert.match(block,/posGuide\.action==="checkout"\)\{openPayment\(\)/);
  assert.match(block,/posGuide\.action==="open_orders"\)\{setOpsInitialTab\("orders"\);setOpsOpen\(true\)/);
  assert.doesNotMatch(block,/router\.push/);
});

test("guide is derived from existing transaction state and adds no payment mutation path",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/data-pos-guidance=\{posGuide\.key\}/);
  assert.match(pos,/recoveryBlocked:!!recoveryIntegrityIssue/);
  assert.match(pos,/cashRecoveryBlocked:!!cashRecoveryReview/);
  assert.match(pos,/offlineSession:!!session\.offline/);
  assert.match(pos,/offlinePending:offlineStats\.pending/);
  const guide=await read("lib/pos-guidance.mjs");
  assert.doesNotMatch(guide,/api\(/);
  assert.doesNotMatch(guide,/fetch\(/);
});
