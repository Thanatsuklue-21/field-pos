import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {orderStatusLabel,paymentMethodLabel,paymentSummaryLabel,saleStatusLabel} from "../lib/operator-labels.mjs";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("operator labels translate known financial and production states into plain Thai",()=>{
  assert.equal(paymentMethodLabel("cash"),"เงินสด");
  assert.equal(paymentMethodLabel("promptpay"),"พร้อมเพย์");
  assert.equal(paymentMethodLabel("split"),"หลายช่องทาง");
  assert.equal(paymentSummaryLabel("split",["cash","promptpay"]),"เงินสด + พร้อมเพย์");
  assert.equal(saleStatusLabel("paid"),"ชำระแล้ว");
  assert.equal(saleStatusLabel("refunded"),"คืนเงินแล้ว");
  assert.equal(orderStatusLabel("assigned"),"รอทำ");
  assert.equal(orderStatusLabel("making"),"กำลังทำ");
  assert.equal(orderStatusLabel("ready"),"พร้อมส่งมอบ");
  assert.equal(orderStatusLabel("returned"),"ส่งมอบแล้ว");
});

test("unknown machine codes fail to a neutral operator phrase instead of leaking implementation jargon",()=>{
  assert.equal(paymentMethodLabel("future_gateway"),"ไม่ทราบช่องทาง");
  assert.equal(saleStatusLabel("future_state"),"ไม่ทราบสถานะ");
  assert.equal(orderStatusLabel("future_state"),"ไม่ทราบสถานะ");
});

test("Today Workspace renders translated queue sale and payment labels",async()=>{
  const hub=await read("components/pos-daily-workspace.tsx");
  assert.match(hub,/orderStatusLabel\(order\.status\)/);
  assert.match(hub,/paymentSummaryLabel\(latestOrder\.payment,latestOrder\.paymentMethods\)/);
  assert.match(hub,/paymentSummaryLabel\(sale\.payment,sale\.paymentMethods\)/);
  assert.match(hub,/saleStatusLabel\(sale\.status\)/);
  assert.match(hub,/orderStatusLabel\(sale\.orderStatus\)/);
  assert.doesNotMatch(hub,/>\{order\.status\}<\/span>/);
  assert.doesNotMatch(hub,/>\{sale\.payment\}<\/span>/);
});

test("Orders screen uses plain Thai table headers and shared labels on mobile desktop and detail views",async()=>{
  const orders=await read("app/orders/page.tsx");
  assert.match(orders,/คิว \/ บิล/);
  assert.match(orders,/>วันที่<\/th>/);
  assert.match(orders,/>ช่องทาง<\/th>/);
  assert.match(orders,/>สถานะ<\/th>/);
  assert.match(orders,/paymentSummaryLabel\(x\.payment,x\.paymentMethods\)/);
  assert.match(orders,/saleStatusLabel\(x\.status\)/);
  assert.match(orders,/saleStatusLabel\(detail\.status\)/);
  assert.doesNotMatch(orders,/>\{x\.status\}<\/span>/);
  assert.doesNotMatch(orders,/>\{detail\.status\}<\/span>/);
});

test("printed receipt shares the same payment and status vocabulary",async()=>{
  const receipt=await read("components/sale-receipt.tsx");
  assert.match(receipt,/paymentMethodLabel\(sale\.payment\)/);
  assert.match(receipt,/saleStatusLabel\(sale\.status\)/);
  assert.doesNotMatch(receipt,/sale\.payment==="promptpay"\?"PromptPay"/);
});
