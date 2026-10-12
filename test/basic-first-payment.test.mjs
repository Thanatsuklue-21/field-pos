import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("payment sheet keeps the normal cashier path visible before advanced options",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/const \[showAdvancedPayment,setShowAdvancedPayment\]=useState\(false\)/);
  assert.match(pos,/ตัวเลือกเพิ่มเติม · สมาชิก \/ แยกบิล/);
  assert.match(pos,/>เงินสด<\/button>/);
  assert.match(pos,/QR พร้อมเพย์/);
  assert.match(pos,/>โอนธนาคาร<\/button>/);
  assert.match(pos,/รับพอดี ฿\{formatMoney\(netPayable\)\}/);
  assert.match(pos,/onClick=\{checkout\}/);
});

test("split bill and loyalty controls live behind one advanced disclosure",async()=>{
  const pos=await read("app/pos/page.tsx");
  const advancedStart=pos.indexOf('aria-expanded={advancedPaymentOpen}');
  const cashStart=pos.indexOf('{method==="cash"&&',advancedStart);
  assert.ok(advancedStart>0&&cashStart>advancedStart);
  const advanced=pos.slice(advancedStart,cashStart);
  assert.match(advanced,/แยกบิล \/ จ่ายแยกตามคน/);
  assert.match(advanced,/ลูกค้าทั่วไป \/ ไม่สะสมแต้ม/);
  assert.match(advanced,/ใช้ได้สูงสุด/);
  assert.match(advanced,/advancedPaymentOpen&&/);
});

test("advanced payment state auto-stays visible instead of hiding active discounts or split state",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/const advancedPaymentActive=splitBill\|\|!!customerId\|\|pointsRedeemed>0\|\|!!splitGroup/);
  assert.match(pos,/const advancedPaymentOpen=showAdvancedPayment\|\|advancedPaymentActive/);
  assert.match(pos,/advancedPaymentActive&&advancedPaymentOpen/);
  assert.match(pos,/ยกเลิกสมาชิก\/แต้ม\/แยกบิลก่อนจึงจะซ่อนส่วนนี้ได้/);
  assert.match(pos,/setShowAdvancedPayment\(!!customerId\|\|!!splitGroup\)/);
});

test("advanced disclosure remains presentation-only and preserves existing transaction fields",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/checkoutMode=splitBill\?"split_bill":"full"/);
  assert.match(pos,/customerId:customerId\|\|null,pointsRedeemed:redeemPoints/);
  assert.match(pos,/targetOrderId:splitGroup\?\.orderId\|\|undefined/);
  assert.match(pos,/payment:method==="delivery"\?"other":method/);
});
