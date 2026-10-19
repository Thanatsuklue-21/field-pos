import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("refund flow stays inside the app instead of browser confirm/prompt",async()=>{
  const ui=await read("app/orders/page.tsx");
  const start=ui.indexOf("function refundSaleUi");
  const end=ui.indexOf("async function voidCash",start);
  const block=ui.slice(start,end);
  assert.match(block,/setRefundReview/);
  assert.match(block,/confirmRefund/);
  assert.doesNotMatch(block,/window\.confirm/);
  assert.doesNotMatch(block,/window\.prompt/);
});

test("guided refund requires reason and external-payment evidence before enabling submit",async()=>{
  const ui=await read("app/orders/page.tsx");
  assert.match(ui,/refundReview\.reason\.trim\(\)\.length<2/);
  assert.match(ui,/refundReview\.manualConfirmed/);
  assert.match(ui,/refundReview\.manualReference\.trim\(\)/);
  assert.match(ui,/คืนเงินจริงให้ลูกค้าผ่านช่องทางภายนอกแล้ว/);
  assert.match(ui,/เลขอ้างอิง \/ หมายเหตุการคืนเงิน/);
});

test("guided refund still enters the durable order-mutation recovery path",async()=>{
  const ui=await read("app/orders/page.tsx");
  const start=ui.indexOf("async function confirmRefund");
  const end=ui.indexOf("async function voidCash",start);
  const block=ui.slice(start,end);
  assert.match(block,/prepareOrderMutationIntent/);
  assert.match(block,/setPendingOrderMutation\(intent\)/);
  assert.match(block,/submitOrderMutation\(intent,false\)/);
  assert.match(block,/riskConfirmed:true/);
  assert.match(block,/manualConfirmed:review\.external\.length>0/);
});
