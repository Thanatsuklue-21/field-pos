import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("cash payment offers bill-aware quick amounts and keeps exact-cash shortcut",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/const quickCashAmounts=useMemo\(\(\)=>\{/);
  assert.match(pos,/const common=\[20,50,100,500,1000\]/);
  assert.match(pos,/Math\.ceil\(netPayable\/10\)\*10/);
  assert.match(pos,/common\.filter\(value=>value>=netPayable\)/);
  assert.match(pos,/slice\(0,4\)/);
  assert.match(pos,/รับพอดี ฿\{formatMoney\(netPayable\)\}/);
  assert.match(pos,/แตะจำนวนเงินที่ลูกค้าจ่าย/);
  assert.match(pos,/aria-label=\{"รับเงินสด "\+amount\+" บาท"\}/);
});

test("cash presets never suggest less than the payable amount",async()=>{
  const pos=await read("app/pos/page.tsx");
  const start=pos.indexOf("const quickCashAmounts=useMemo");
  const end=pos.indexOf("},[netPayable]);",start);
  const block=pos.slice(start,end);
  assert.match(block,/filter\(value=>value>=netPayable&&value>0\)/);
  assert.match(block,/sort\(\(a,b\)=>a-b\)/);
});

test("primary cashier payment actions use plain Thai copy",async()=>{
  const pos=await read("app/pos/page.tsx");
  for(const text of [
    "สร้าง QR พร้อมเพย์",
    "ยืนยันออเดอร์เดลิเวอรี",
    "ยืนยันรับโอน",
    "ยืนยันรับบัตร",
    "บันทึกเงินสดออฟไลน์",
    "ยืนยันรับเงิน",
    "กำลังรอยืนยันการชำระ…",
    "กำลังบันทึกบิล…"
  ]) assert.match(pos,new RegExp(text));
  for(const old of ["CREATE QR / PAY","CONFIRM PAYMENT","SAVE OFFLINE CASH","WAITING FOR PAYMENT"])
    assert.doesNotMatch(pos,new RegExp(old));
});

test("cash input has an explicit accessible label and change remains visible",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/aria-label="จำนวนเงินสดที่รับจากลูกค้า"/);
  assert.match(pos,/cashDelta>=0\?"เงินทอน":"ขาดอีก"/);
  assert.match(pos,/formatMoney\(Math\.abs\(cashDelta\)\)/);
});
