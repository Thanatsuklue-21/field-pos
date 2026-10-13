import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("modifier dialog explains one next action and highlights the normal/default recipe",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/role="dialog" aria-modal="true" aria-labelledby="field-modifier-title"/);
  assert.match(pos,/เลือกระดับความหวาน \/ สูตร/);
  assert.match(pos,/แตะ 1 ตัวเลือก ระบบจะเพิ่มลงตะกร้าให้ทันที/);
  assert.match(pos,/isDefaultOrderOption/);
  assert.match(pos,/>แนะนำ<\/small>/);
  assert.match(pos,/min-h-14/);
  assert.match(pos,/ลดจำนวนรายการในตะกร้า หรืออัปเดต Stock ก่อนเพิ่มเมนูนี้/);
});

test("payment sheet gives a simple three-step mental model with accessible close control",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/aria-labelledby="field-payment-title"/);
  assert.match(pos,/paymentStage/);
  assert.match(pos,/\[\["1","ทวนรายการ"\],\["2","เลือกวิธีจ่าย"\],\["3","ยืนยันรับเงิน"\]\]/);
  assert.match(pos,/active=paymentStage===step/);
  assert.match(pos,/aria-label="ปิดหน้าชำระเงิน"/);
});
