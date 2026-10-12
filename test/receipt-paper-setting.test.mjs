import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("business settings expose a backward-compatible 80mm default and persist 58/80 only",async()=>{
  const api=await read("lib/api.mjs");
  assert.match(api,/receiptPaperWidth:Number\(doc\.settings\?\.receiptPaperWidth\)===58\?58:80/);
  assert.match(api,/receiptPaperWidth=b\.receiptPaperWidth===undefined\?undefined:Number\(b\.receiptPaperWidth\)/);
  assert.match(api,/!\[58,80\]\.includes\(receiptPaperWidth\).*invalid_receipt_paper_width/);
  assert.match(api,/doc\.settings\.receiptPaperWidth=receiptPaperWidth/);
  assert.match(api,/business_settings_update.*receiptPaperWidth/);
});

test("POS bootstrap carries the authoritative receipt paper width",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("if(path==='/api/pos/bootstrap'");
  const end=api.indexOf("const menuImageReadMatch",start);
  const block=api.slice(start,end);
  assert.match(block,/receiptPaperWidth:Number\(doc\.settings\?\.receiptPaperWidth\)===58\?58:80/);
});

test("Settings lets an admin choose only 58mm or 80mm and saves it with business settings",async()=>{
  const settings=await read("app/settings/page.tsx");
  assert.match(settings,/useState<58\|80>\(80\)/);
  assert.match(settings,/setReceiptPaperWidth\(Number\(x\.settings\.receiptPaperWidth\)===58\?58:80\)/);
  assert.match(settings,/receiptPaperWidth,deliveryGp/);
  assert.match(settings,/\(\[58,80\] as const\)\.map/);
  assert.match(settings,/>\{width\} mm<\/button>/);
});

test("POS receipt renderer follows the server bootstrap paper width instead of a hardcoded size",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/const receiptPaperWidth:58\|80=Number\(data\?\.settings\?\.receiptPaperWidth\)===58\?58:80/);
  assert.match(pos,/paperWidth=\{receiptPaperWidth\}/);
  assert.doesNotMatch(pos,/lastSale\?\.receipt&&<SaleReceipt sale=\{lastSale\.receipt\} paperWidth=\{80\}/);
});
