import test from "node:test";
import assert from "node:assert/strict";
import {buildEscPosReceipt,escpos,escPosReceiptCapabilities} from "../lib/receipt-escpos.mjs";

const utf8=text=>new TextEncoder().encode(String(text));
const sample={
  billNo:"F-0001",
  queueNo:"Q12",
  time:Date.UTC(2026,9,12,4,30),
  total:120,
  payment:"cash",
  received:200,
  change:80,
  discountTotal:5,
  pointsRedeemed:1,
  pointsAwarded:2,
  items:[
    {name:"มัทฉะลาเต้",variant:"หวานน้อย (50%)",qty:1,price:65},
    {name:"ชาไทย",variant:"หวานปกติ (100%)",qty:1,price:60}
  ]
};

const includesBytes=(haystack,needle)=>{
  outer:for(let i=0;i<=haystack.length-needle.length;i++){
    for(let j=0;j<needle.length;j++)if(haystack[i+j]!==needle[j])continue outer;
    return true;
  }
  return false;
};

test("ESC/POS control commands expose initialize align bold feed and cut",()=>{
  assert.deepEqual([...escpos.initialize()],[0x1b,0x40]);
  assert.deepEqual([...escpos.alignCenter()],[0x1b,0x61,0x01]);
  assert.deepEqual([...escpos.bold(true)],[0x1b,0x45,0x01]);
  assert.deepEqual([...escpos.bold(false)],[0x1b,0x45,0x00]);
  assert.deepEqual([...escpos.feed(3)],[0x1b,0x64,0x03]);
  assert.deepEqual([...escpos.cut()],[0x1d,0x56,0x41,0x00]);
});

test("receipt bytes require an explicit text encoder instead of assuming Thai UTF-8 support",()=>{
  assert.throws(()=>buildEscPosReceipt(sample),/escpos_text_encoder_required/);
  assert.throws(()=>buildEscPosReceipt(sample,{encodeText:()=> "wrong"}),/escpos_text_encoder_must_return_uint8array/);
});

test("receipt output contains server-authoritative sale details and final cut command",()=>{
  const out=buildEscPosReceipt(sample,{paperWidth:80,encodeText:utf8});
  for(const token of ["FIELD","BILL F-0001","QUEUE Q12","มัทฉะลาเต้","หวานน้อย (50%)","TOTAL 120.00","PAYMENT CASH","RECEIVED 200.00","CHANGE 80.00","POINTS USED 1","POINTS +2","THANK YOU"]){
    assert.equal(includesBytes(out,utf8(token)),true,token);
  }
  assert.deepEqual([...out.slice(-4)],[0x1d,0x56,0x41,0x00]);
});

test("58mm and 80mm layouts use bounded divider widths without changing receipt data",()=>{
  const small=buildEscPosReceipt(sample,{paperWidth:58,encodeText:utf8});
  const large=buildEscPosReceipt(sample,{paperWidth:80,encodeText:utf8});
  assert.equal(includesBytes(small,utf8("-".repeat(32))),true);
  assert.equal(includesBytes(large,utf8("-".repeat(42))),true);
  assert.equal(includesBytes(small,utf8("BILL F-0001")),true);
  assert.equal(includesBytes(large,utf8("BILL F-0001")),true);
});

test("capability metadata keeps transport external until hardware-specific driver is configured",()=>{
  assert.deepEqual(escPosReceiptCapabilities(),{
    requiresExplicitTextEncoder:true,
    supportsPaperWidths:[58,80],
    transport:"external",
    commands:["initialize","align","bold","feed","cut"]
  });
});
