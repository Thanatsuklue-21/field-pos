import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {buildPosGuidance} from "../lib/pos-guidance.mjs";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("merged beginner guide now follows actual POS state instead of cart state only",()=>{
  assert.equal(buildPosGuidance({cartQty:0,online:true}).key,"select");
  assert.equal(buildPosGuidance({cartQty:2,online:true}).key,"checkout");
  assert.equal(buildPosGuidance({cartQty:2,payOpen:true,online:true}).key,"payment");
  assert.equal(buildPosGuidance({lastSale:{queueNo:"Q12",pager:4},canQueue:true}).key,"handoff");
});

test("ambiguous payment recovery always outranks checkout or post-sale guidance",()=>{
  const guide=buildPosGuidance({
    recoveryBlocked:true,
    cartQty:3,payOpen:true,lastSale:{queueNo:"Q9",pager:2},
    canOrder:true,canQueue:true
  });
  assert.equal(guide.key,"recovery");
  assert.equal(guide.step,0);
  assert.equal(guide.action,"open_orders");
  assert.match(guide.message,/ป้องกันยอดหรือบิลซ้ำ/);
});

test("offline guidance explicitly restricts tender and shows pending sync",()=>{
  const guide=buildPosGuidance({online:false,offlinePending:2});
  assert.equal(guide.key,"offline");
  assert.equal(guide.step,1);
  assert.match(guide.message,/เฉพาะเงินสด/);
  assert.match(guide.message,/2 บิล/);
});

test("successful sale points a permitted operator to the in-POS queue hub",()=>{
  const guide=buildPosGuidance({lastSale:{queueNo:"Q7",pager:3},canQueue:true});
  assert.equal(guide.action,"open_queue");
  assert.match(guide.message,/บัตร 3/);
  assert.match(guide.actionLabel,/Q7/);
  assert.equal(buildPosGuidance({lastSale:{queueNo:"Q7",pager:3},canQueue:false}).action,"next_order");
});

test("POS keeps the merged three-step visual but derives it from state-aware guidance",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/buildPosGuidance/);
  assert.match(pos,/const guideStep=posGuide\.step/);
  assert.match(pos,/const guideMessage=posGuide\.message/);
  assert.match(pos,/data-pos-guidance=\{posGuide\.key\}/);
  assert.match(pos,/\[\["1","เลือกเมนู"\],\["2","ตรวจรายการ"\],\["3","รับชำระ"\]\]/);
  assert.doesNotMatch(pos,/const guideStep=payOpen\?3:cartQty>0\?2:1/);
});

test("guide actions stay inside existing safe POS and Operations Hub paths",async()=>{
  const pos=await read("app/pos/page.tsx");
  const start=pos.indexOf("function runGuideAction");
  const block=pos.slice(start,start+900);
  assert.match(block,/posGuide\.action==="checkout"\)\{openPayment\(\)/);
  assert.match(block,/posGuide\.action==="next_order"\)\{startNextOrder\(\)/);
  assert.match(block,/setOpsInitialTab\("queue"\);setLastSale\(null\);setOpsOpen\(true\)/);
  assert.match(block,/setOpsInitialTab\("orders"\);setOpsOpen\(true\)/);
  assert.doesNotMatch(block,/router\.push/);
});


test("recovery uses the detailed recovery card as the only visible action instead of duplicating guidance",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/posGuide\.key!=="recovery"&&<div data-pos-guidance/);
  assert.match(pos,/CRITICAL · ข้อมูล recovery การชำระผิดปกติ/);
  assert.match(pos,/ต้องตรวจรายการเงินสดค้างก่อนรับบิลใหม่/);
});
