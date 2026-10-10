import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("close-day GET exposes only today's paid-sale orders that still block handoff",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("if(path==='/api/close-day'&&method==='GET')");
  const end=api.indexOf("if(path==='/api/cash-shift/open'",start);
  const block=api.slice(start,end);
  assert.match(block,/const todaySaleIds=new Set/);
  assert.match(block,/const orderBlockers=/);
  assert.match(block,/!\['returned','void','refunded','cancelled'\]\.includes/);
  assert.match(block,/todaySaleIds\.has\(id\)/);
  assert.match(block,/remainingPrep/);
  assert.match(block,/remainingHandoff/);
  assert.match(block,/closeBlockedByOrders:orderBlockers\.length>0/);
});

test("close-day POST returns actionable open-order metadata",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("if(path==='/api/close-day'&&method==='POST')");
  const end=api.indexOf("if(path==='/api/management/dashboard'",start);
  const block=api.slice(start,end);
  assert.match(block,/const openOrders=/);
  assert.match(block,/close_day_open_orders/);
  assert.match(block,/count:openOrders\.length/);
  assert.match(block,/orderIds:openOrders\.slice\(0,20\)/);
  assert.match(block,/queueNos:openOrders\.slice\(0,20\)/);
});

test("Close Day disables close while open orders exist and links directly to Queue",async()=>{
  const ui=await read("app/close/page.tsx");
  assert.match(ui,/type OrderBlocker=/);
  assert.match(ui,/orderBlockers\.length/);
  assert.match(ui,/ปิดวันไม่ได้ · มีออเดอร์ค้าง/);
  assert.match(ui,/router\.push\("\/queue"\)/);
  assert.match(ui,/มีคิวค้าง/);
  const closeFn=ui.slice(ui.indexOf("async function close()"),ui.indexOf("return <section",ui.indexOf("async function close()")));
  assert.match(closeFn,/if\(orderBlockers\.length\)/);
});

test("Close Day blocker card shows production, call and handoff progress without mutating queue",async()=>{
  const ui=await read("app/close/page.tsx");
  assert.match(ui,/พร้อม \{o\.ready\}\/\{o\.cups\}/);
  assert.match(ui,/เรียกแล้ว \{o\.called\}\/\{o\.cups\}/);
  assert.match(ui,/เหลือทำ/);
  assert.match(ui,/เหลือเรียก\/ส่งมอบ/);
  assert.doesNotMatch(ui,/\/api\/pos\/queue[^\n]*method:"POST"/);
});
