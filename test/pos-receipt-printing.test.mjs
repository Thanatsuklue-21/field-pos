import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {buildEscPosReceipt,receiptEscPosCapabilities} from "../lib/escpos-receipt.mjs";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

const sale={
  billNo:"FIELD-20261012-001",queueNo:"Q001",time:Date.now(),
  subtotal:100,discountTotal:10,total:90,payment:"cash",received:100,change:10,status:"paid",
  items:[{name:"Matcha Latte",variant:"50%",qty:1,price:90}]
};

test("completed checkout responses expose a server-authoritative receipt snapshot",async()=>{
  const api=await read("lib/pos-api.mjs");
  assert.match(api,/function saleReceiptView\(sale\)/);
  assert.match(api,/receipt:saleReceiptView\(sale\)/);
  assert.match(api,/receipt:completed&&sale\?saleReceiptView\(sale\):null/);
  assert.match(api,/items:\(sale\.items\|\|\[\]\)\.map/);
  const receiptView=api.slice(api.indexOf("function saleReceiptView"),api.indexOf("export async function checkoutPos"));
  assert.doesNotMatch(receiptView,/recipe:/);
  assert.doesNotMatch(receiptView,/unitCost:/);
});

test("POS prints the exact server receipt from the same post-sale card",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/SaleReceipt,\{type ReceiptSale\}/);
  assert.match(pos,/receipt\?:ReceiptSale/);
  assert.match(pos,/receipt:r\?\.receipt&&r\.receipt\.billNo\?r\.receipt:undefined/);
  assert.match(pos,/lastSale\?\.receipt&&<SaleReceipt/);
  assert.match(pos,/onClick=\{\(\)=>window\.print\(\)\}/);
  assert.match(pos,/>พิมพ์ใบเสร็จ<\/button>/);
});

test("offline sale never fabricates an authoritative receipt before sync",async()=>{
  const pos=await read("app/pos/page.tsx");
  const start=pos.indexOf("function finishOfflineSale");
  const end=pos.indexOf("function finishSale",start);
  const block=pos.slice(start,end);
  assert.doesNotMatch(block,/receipt:/);
  assert.match(pos,/ใบเสร็จจริงจะพิมพ์ได้หลังซิงก์สำเร็จ/);
});

test("receipt renderer supports both common thermal paper widths",async()=>{
  const receipt=await read("components/sale-receipt.tsx");
  assert.match(receipt,/paperWidth=80/);
  assert.match(receipt,/paperWidth\?:58\|80/);
  assert.match(receipt,/paperWidth===58\?3:5/);
  assert.match(receipt,/paperWidth===58\?52:70/);
});

test("ESC POS builder initializes printer, prints content and finishes with full cut",()=>{
  const payload=buildEscPosReceipt(sale,{paperWidth:80});
  assert.ok(payload instanceof Uint8Array);
  assert.deepEqual([...payload.slice(0,2)],[0x1b,0x40]);
  assert.deepEqual([...payload.slice(-4)],[0x1d,0x56,0x41,0x00]);
  const caps=receiptEscPosCapabilities();
  assert.deepEqual(caps.paperWidths,[58,80]);
  assert.equal(caps.requiresPrinterSpecificThaiEncoding,true);
});

test("ESC POS builder accepts printer-specific Thai encoding injection",()=>{
  const seen=[];
  const payload=buildEscPosReceipt(sale,{
    paperWidth:58,
    encodeText(value){seen.push(String(value));return Uint8Array.from([0x41])}
  });
  assert.ok(payload.length>10);
  assert.ok(seen.some(x=>x.includes("FIELD")));
  assert.ok(seen.some(x=>x.includes("ยอดสุทธิ")));
});
