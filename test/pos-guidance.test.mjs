import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {buildPosGuidance} from "../lib/pos-guidance.mjs";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("new operator sees one deterministic next action for each POS state",()=>{
  assert.equal(buildPosGuidance({cartQty:0,online:true}).key,"select");
  assert.equal(buildPosGuidance({cartQty:2,online:true}).key,"checkout");
  assert.equal(buildPosGuidance({cartQty:2,payOpen:true,online:true}).key,"payment");
  assert.equal(buildPosGuidance({lastSale:{queueNo:"Q12",pager:4},canQueue:true}).key,"handoff");
});

test("payment recovery blocks every lower priority sales instruction",()=>{
  const guide=buildPosGuidance({
    recoveryBlocked:true,
    cashRecoveryBlocked:false,
    cartQty:3,
    payOpen:true,
    lastSale:{queueNo:"Q9",pager:2},
    canOrder:true,
    canQueue:true
  });
  assert.equal(guide.key,"recovery");
  assert.equal(guide.action,"open_orders");
});

test("post-sale guide prefers in-POS queue context when permitted",()=>{
  const guide=buildPosGuidance({lastSale:{queueNo:"Q7",pager:3},canQueue:true});
  assert.equal(guide.action,"open_queue");
  assert.match(guide.title,/บัตร 3/);
  assert.match(guide.actionLabel,/Q7/);
  const restricted=buildPosGuidance({lastSale:{queueNo:"Q7",pager:3},canQueue:false});
  assert.equal(restricted.action,"next_order");
});

test("offline guidance is explicit and never suggests online payment",()=>{
  const guide=buildPosGuidance({online:false,offlinePending:2,cartQty:0});
  assert.equal(guide.key,"offline");
  assert.match(guide.title,/เงินสด/);
  assert.match(guide.detail,/2 รายการ/);
  assert.equal(guide.action,null);
});

test("POS renders the guide and routes its actions without page navigation",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/buildPosGuidance/);
  assert.match(pos,/data-pos-guidance=\{posGuide\.key\}/);
  assert.match(pos,/posGuide\.action==="checkout"/);
  assert.match(pos,/posGuide\.action==="open_queue"/);
  assert.match(pos,/setOpsInitialTab\("queue"\);setLastSale\(null\);setOpsOpen\(true\)/);
  assert.match(pos,/posGuide\.action==="open_orders"/);
  assert.match(pos,/setOpsInitialTab\("orders"\);setOpsOpen\(true\)/);
});

test("mobile shell keeps only sales and queue as primary destinations",async()=>{
  const shell=await read("components/app-shell.tsx");
  const nav=await read("lib/mobile-navigation.ts");
  assert.match(shell,/const primaryMobile=\["\/pos","\/queue"\]/);
  assert.doesNotMatch(shell,/const primaryMobile=\["\/pos","\/queue","\/orders","\/stock"\]/);
  assert.match(nav,/const PRIMARY=\["\/pos","\/queue"\]/);
  assert.match(nav,/const PRIORITY=\["\/orders","\/stock","\/expenses","\/close","\/settings"\]/);
});
