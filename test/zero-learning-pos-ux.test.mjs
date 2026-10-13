import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("POS teaches the core sale flow with visible 1-2-3 guidance",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.ok(pos.includes('const orderStep=payOpen?3:cart.items.length?2:1'));
  assert.ok(pos.includes('["1","เลือกเมนู"]'));
  assert.ok(pos.includes('["2","ตรวจรายการ"]'));
  assert.ok(pos.includes('["3","รับเงิน"]'));
  assert.ok(pos.includes("แตะเมนู → ตรวจรายการ → รับเงิน"));
});

test("single-variant products add directly while multi-variant drinks still ask for a choice",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.ok(pos.includes("function chooseMenu(product:MenuItem)"));
  assert.ok(pos.includes("if(product.variants.length===1)"));
  assert.ok(pos.includes("addVariant(product,product.variants[0])"));
  assert.ok(pos.includes("setSelected(product)"));
  assert.ok(pos.includes("onClick={()=>chooseMenu(x)}"));
});

test("primary POS actions use operator language instead of developer checkout jargon",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.ok(pos.includes(">ชำระเงิน</button>"));
  assert.ok(pos.includes('"ยืนยันรับเงิน"'));
  assert.ok(pos.includes('"สร้าง QR ให้ลูกค้า"'));
  assert.ok(pos.includes("เลือกระดับหวาน / สูตร"));
  assert.ok(pos.includes("เลือกวิธีชำระ"));
  assert.ok(pos.includes("ยอดสินค้า"));
  assert.ok(pos.includes("รวมสุทธิ"));
});

test("cash payment provides common one-tap tender amounts",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.ok(pos.includes("const quickCashAmounts="));
  assert.ok(pos.includes("quickCashAmounts.map"));
  assert.ok(pos.includes("setReceived(String(amount))"));
  assert.ok(pos.includes("รับพอดี ฿{netPayable.toFixed(0)}"));
});

test("menu rendering and touch ergonomics stay mobile friendly",async()=>{
  const pos=await read("app/pos/page.tsx"),css=await read("app/globals.css");
  assert.ok(pos.includes('loading="lazy"'));
  assert.ok(pos.includes('decoding="async"'));
  assert.ok(pos.includes("pos-menu-card"));
  assert.ok(css.includes(".pos-menu-card{content-visibility:auto"));
  assert.ok(css.includes(".field-app-root button{min-block-size:44px;min-inline-size:44px}"));
  assert.ok(css.includes("input,select,textarea{font-size:16px}"));
});

test("phone navigation shows four daily actions plus More without horizontal scrolling",async()=>{
  const shell=await read("components/app-shell.tsx");
  assert.ok(shell.includes('const primaryMobile=["/pos","/queue","/orders","/stock"]'));
  assert.ok(shell.includes('const overflowMobile=["/expenses","/close","/settings"]'));
  assert.ok(shell.includes("mobilePrimary"));
  assert.ok(shell.includes("mobileMore"));
  assert.ok(shell.includes("MoreHorizontal"));
  assert.ok(shell.includes("overflow-hidden rounded-[20px]"));
});
