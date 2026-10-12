import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("close-day GET exposes today's collecting and resolution payment blockers",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("if(path==='/api/close-day'&&method==='GET')");
  const end=api.indexOf("if(path==='/api/cash-shift/open'",start);
  const block=api.slice(start,end);
  assert.match(block,/paymentBlockers/);
  assert.match(block,/\['collecting','requires_resolution'\]\.includes/);
  assert.match(block,/s\.date===today/);
  assert.match(block,/chargeId/);
  assert.match(block,/providerStatus/);
  assert.match(block,/closeBlockedByPayments:paymentBlockers\.length>0/);
});

test("close-day POST returns actionable pending payment metadata",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("if(path==='/api/close-day'&&method==='POST')");
  const end=api.indexOf("if(path==='/api/management/dashboard'",start);
  const block=api.slice(start,end);
  assert.match(block,/const pendingPayments=/);
  assert.match(block,/close_day_pending_payments/);
  assert.match(block,/count:pendingPayments\.length/);
  assert.match(block,/sessionIds:pendingPayments\.slice\(0,20\)/);
});

test("Close Day shows blockers before operator submits, deep-links the exact payment, and disables close button",async()=>{
  const ui=await read("app/close/page.tsx");
  assert.match(ui,/type PaymentBlocker=/);
  assert.match(ui,/paymentBlockers\.length/);
  assert.match(ui,/ปิดวันไม่ได้ · มี Payment ค้าง/);
  assert.match(ui,/router\.push\("\/orders\?resolution="\+encodeURIComponent\(paymentBlockers\[0\]\.id\)\)/);
  assert.match(ui,/router\.push\("\/orders\?resolution="\+encodeURIComponent\(p\.id\)\)/);
  assert.match(ui,/paymentBlockers\.length>0/);
  const closeFn=ui.slice(ui.indexOf("async function close()"),ui.indexOf("return <section",ui.indexOf("async function close()")));
  assert.match(closeFn,/if\(paymentBlockers\.length\)/);
});

test("Orders shows collecting blockers read-only and only allows reconcile for requires_resolution",async()=>{
  const ui=await read("app/orders/page.tsx");
  assert.match(ui,/r\.status==="requires_resolution"/);
  assert.match(ui,/รายการยังอยู่สถานะ collecting/);
  assert.match(ui,/แสดงหลักฐานแบบ read-only/);
  assert.match(ui,/ผล Provider และ flow ฝั่ง Server/);
  const api=await read("lib/api.mjs");
  const start=api.indexOf("if(path==='/api/pos/payment-resolutions'&&method==='GET')");
  const end=api.indexOf("if(path==='/api/pos/payment-resolutions/reconcile'",start);
  const block=api.slice(start,end);
  assert.match(block,/\['collecting','requires_resolution'\]\.includes/);
});
