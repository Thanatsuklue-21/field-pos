import test from "node:test";
import assert from "node:assert/strict";
import {buildPosGuidance} from "../lib/pos-guidance.mjs";

test("recovery blocker always wins and prevents a new payment",()=>{
  const g=buildPosGuidance({recoveryBlocked:true,cartQty:2,payOpen:true,reviewConfirmed:true});
  assert.equal(g.key,"recovery");
  assert.equal(g.step,0);
});

test("closed day and unavailable stock are explicit operator blockers",()=>{
  assert.equal(buildPosGuidance({salesClosed:true}).key,"day_closed");
  assert.equal(buildPosGuidance({allUnavailable:true}).key,"stock_block");
});

test("cart guidance moves a novice from selection to checkout",()=>{
  const g=buildPosGuidance({cartQty:2});
  assert.equal(g.key,"checkout");
  assert.equal(g.action,"checkout");
  assert.equal(g.step,2);
});

test("payment must be reviewed before money collection guidance",()=>{
  const g=buildPosGuidance({payOpen:true,reviewConfirmed:false,method:"cash",netPayable:70});
  assert.equal(g.key,"payment_review");
  assert.match(g.message,/ทวนชื่อเมนู/);
});

test("cash guidance distinguishes missing, short, exact, and change states",()=>{
  assert.equal(buildPosGuidance({payOpen:true,reviewConfirmed:true,method:"cash",netPayable:70,cashReceived:null}).key,"cash_receive");
  const short=buildPosGuidance({payOpen:true,reviewConfirmed:true,method:"cash",netPayable:70,cashReceived:50});
  assert.equal(short.key,"cash_short");
  assert.match(short.message,/฿20/);
  const exact=buildPosGuidance({payOpen:true,reviewConfirmed:true,method:"cash",netPayable:70,cashReceived:70});
  assert.equal(exact.key,"cash_ready");
  assert.match(exact.message,/พอดียอด/);
  const change=buildPosGuidance({payOpen:true,reviewConfirmed:true,method:"cash",netPayable:70,cashReceived:100});
  assert.equal(change.key,"cash_ready");
  assert.match(change.message,/ทอน ฿30/);
});

test("busy transaction tells the operator not to press twice",()=>{
  const g=buildPosGuidance({payOpen:true,busy:true,reviewConfirmed:true,method:"cash",netPayable:70,cashReceived:100});
  assert.equal(g.key,"payment_busy");
  assert.match(g.message,/อย่ากดซ้ำ/);
});

test("PromptPay readiness is visible before the operator attempts collection",()=>{
  assert.equal(buildPosGuidance({payOpen:true,reviewConfirmed:true,method:"promptpay",promptReady:false}).key,"promptpay_blocked");
  assert.equal(buildPosGuidance({payOpen:true,reviewConfirmed:true,method:"promptpay",promptReady:true}).key,"promptpay_ready");
});

test("successful sale keeps handoff instruction above operational blockers",()=>{
  const g=buildPosGuidance({lastSale:{pager:12,queueNo:"Q12"},salesClosed:true,allUnavailable:true,canQueue:true});
  assert.equal(g.key,"handoff");
  assert.match(g.message,/12/);
  assert.equal(g.action,"open_queue");
});
