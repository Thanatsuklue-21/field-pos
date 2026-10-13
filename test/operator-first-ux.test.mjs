import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("POS teaches the three-step selling flow inline",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.ok(pos.includes('label:"เลือกเมนู"'));
  assert.ok(pos.includes('label:"ตรวจออเดอร์"'));
  assert.ok(pos.includes('label:"รับชำระ"'));
  assert.ok(pos.includes("operatorStage=payOpen?3:cart.items.length>0?2:1"));
  assert.ok(pos.includes("operator-step"));
});

test("cash checkout exposes common tender amounts and Thai-first actions",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.ok(pos.includes("[100,500,1000].map"));
  assert.ok(pos.includes("ตรวจรายการ / ชำระ"));
  assert.ok(pos.includes("ยืนยันรับเงิน"));
  assert.ok(pos.includes("สร้าง QR ให้ลูกค้าสแกน"));
  assert.ok(pos.includes(">เงินสด</button>"));
});

test("variant and payment surfaces use operator language instead of training jargon",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.ok(pos.includes("เลือกระดับหวาน / ตัวเลือก"));
  assert.ok(pos.includes("ขั้นตอน 3 · รับชำระเงิน"));
  assert.ok(pos.includes("ออเดอร์ปัจจุบัน"));
  assert.ok(pos.includes("รายการที่เลือก"));
  assert.ok(!pos.includes(">CHECKOUT</button>"));
  assert.ok(!pos.includes(">CHECKOUT / PAY</button>"));
});

test("mobile operator controls are protected by touch-target CSS",async()=>{
  const css=await read("app/globals.css");
  assert.ok(css.includes(".operator-surface button"));
  assert.ok(css.includes("min-block-size:44px"));
  assert.ok(css.includes('.operator-step[data-active="true"]'));
});
