import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {buildPosGuidance} from "../lib/pos-guidance.mjs";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("new operator sees one deterministic next action for each POS state",()=>{
  const select=buildPosGuidance({cartQty:0,online:true});
  const checkout=buildPosGuidance({cartQty:2,online:true});
  const payment=buildPosGuidance({cartQty:2,payOpen:true,online:true});
  const handoff=buildPosGuidance({lastSale:{queueNo:"Q12",pager:4},canQueue:true});
  assert.deepEqual([select.key,checkout.key,payment.key,handoff.key],["select","checkout","payment","handoff"]);
  assert.deepEqual([select.progress,checkout.progress,payment.progress,handoff.progress],[1,2,3,4]);
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


test("novice-facing POS language is action-oriented Thai rather than implementation jargon",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/ตรวจรายการ \/ ชำระเงิน/);
  assert.match(pos,/ออเดอร์ปัจจุบัน/);
  assert.match(pos,/เลือกระดับความหวาน \/ สูตร/);
  assert.match(pos,/รับชำระเงิน ฿/);
  assert.match(pos,/ยอดรวม/);
  assert.match(pos,/orderOptionLabel\(i\.variant\)/);
  assert.match(pos,/orderOptionLabel\(v\.label\)/);
});

test("POS shows a four-stage visual flow but recovery blockers suppress false progress",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/aria-label="ขั้นตอนการขาย"/);
  for(const label of ["เลือกเมนู","ตรวจรายการ","รับชำระ","รับบัตร"])assert.match(pos,new RegExp(label));
  assert.match(pos,/posGuide\.progress>0/);
  const blocked=buildPosGuidance({recoveryBlocked:true,canOrder:true});
  assert.equal(blocked.progress,0);
});


test("recovery state uses the detailed recovery card as the single visible action instead of duplicating the guide",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/posGuide\.key!=="recovery"&&<div data-pos-guidance/);
  assert.match(pos,/CRITICAL · ข้อมูล recovery การชำระผิดปกติ/);
  assert.match(pos,/ต้องตรวจรายการเงินสดค้างก่อนรับบิลใหม่/);
});
