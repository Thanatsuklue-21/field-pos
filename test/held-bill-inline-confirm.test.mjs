import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("held bills use in-app destructive confirmation instead of browser confirm",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.doesNotMatch(pos,/window\.confirm\("ยกเลิกบิลพักนี้\?"\)/);
  assert.match(pos,/heldDeleteConfirmId/);
  assert.match(pos,/role="alertdialog"/);
  assert.match(pos,/aria-label="ยืนยันลบบิลพัก"/);
  assert.match(pos,/>เก็บบิลไว้<\/button>/);
  assert.match(pos,/>ลบบิลพัก<\/button>/);
});

test("held bill delete confirmation explains financial and stock impact before removal",async()=>{
  const pos=await read("app/pos/page.tsx");
  const start=pos.indexOf('role="alertdialog"');
  const block=pos.slice(start,start+1800);
  assert.match(block,/ยังไม่ขายและยังไม่ตัด Stock/);
  assert.match(block,/การลบจะเอารายการนี้ออกจากเครื่องเท่านั้น/);
  assert.match(block,/heldBills\.removeHeld\(h\.id\)/);
  assert.match(block,/setHeldDeleteConfirmId\(null\)/);
});

test("closing held bills modal clears any staged destructive confirmation",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/onClick=\{\(\)=>\{setHeldDeleteConfirmId\(null\);setHeldOpen\(false\)\}\}/);
});
