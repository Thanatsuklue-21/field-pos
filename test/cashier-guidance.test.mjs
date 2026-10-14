import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {cashierNextAction} from "../lib/cashier-guidance.mjs";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("cashier guidance starts with a concrete menu action",()=>{
  const g=cashierNextAction({cartQty:0,payOpen:false});
  assert.equal(g.step,1);
  assert.match(g.title,/แตะเมนู/);
  assert.match(g.detail,/ระดับหวาน|สูตร/);
});

test("cashier guidance keeps adding items natural before payment",()=>{
  const g=cashierNextAction({cartQty:2,payOpen:false});
  assert.equal(g.step,2);
  assert.equal(g.title,"ลูกค้าสั่งครบหรือยัง?");
  assert.match(g.detail,/แตะเมนูต่อ/);
  assert.match(g.detail,/กดชำระเงิน/);
});

test("cash guidance handles empty short exact and change states",()=>{
  const empty=cashierNextAction({cartQty:1,payOpen:true,method:"cash",payable:55,received:""});
  assert.match(empty.title,/รับเงินจากลูกค้า/);
  assert.match(empty.detail,/รับพอดี/);

  const short=cashierNextAction({cartQty:1,payOpen:true,method:"cash",payable:55,received:"50"});
  assert.equal(short.tone,"warn");
  assert.match(short.title,/ยังไม่พอ/);

  const exact=cashierNextAction({cartQty:1,payOpen:true,method:"cash",payable:55,received:"55"});
  assert.match(exact.title,/ยอดพอดี/);

  const change=cashierNextAction({cartQty:1,payOpen:true,method:"cash",payable:55,received:"100"});
  assert.match(change.title,/ทอน 45 บาท/);
  assert.match(change.detail,/สร้างคิวหลังรับเงินสำเร็จ/);
});

test("PromptPay guidance explicitly avoids duplicate QR creation",()=>{
  const g=cashierNextAction({cartQty:1,payOpen:true,method:"promptpay",payable:55});
  assert.match(g.title,/สแกน QR/);
  assert.match(g.detail,/ไม่ต้องสร้าง QR ใหม่/);
});

test("POS renders the guidance in both ordering and payment contexts",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/cashierNextAction/);
  assert.match(pos,/ลูกค้าสั่งครบหรือยัง/);
  assert.match(pos,/เพิ่ม \/ ตรวจ/);
  const matches=pos.match(/cashierGuide\.title/g)||[];
  assert.ok(matches.length>=2);
  assert.match(pos,/aria-live="polite"/);
});
