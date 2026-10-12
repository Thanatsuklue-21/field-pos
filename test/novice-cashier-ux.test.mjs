import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("modifier dialog explains the next action and highlights the normal/default recipe",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/role="dialog" aria-modal="true" aria-labelledby="field-modifier-title"/);
  assert.match(pos,/แตะ 1 ตัวเลือก ระบบจะเพิ่มลงตะกร้าให้ทันที/);
  assert.match(pos,/isDefaultOrderOption/);
  assert.match(pos,/>แนะนำ<\/small>/);
  assert.match(pos,/min-h-14/);
  assert.match(pos,/aria-label=\{"เลือก "\+orderOptionLabel\(v\.label\)\+" สำหรับ "\+selected\.name\}/);
});

test("payment sheet exposes a plain three-step mental model and accessible close action",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/aria-labelledby="field-payment-title"/);
  assert.match(pos,/1 · ทวนรายการ/);
  assert.match(pos,/2 · เลือกวิธีจ่าย/);
  assert.match(pos,/3 · ยืนยันรับเงิน/);
  assert.match(pos,/aria-label="ปิดหน้าชำระเงิน"/);
});

test("PWA tests validate version contracts without pinning stale cache numbers",async()=>{
  const offline=await read("test/pwa-offline-shell.test.mjs");
  const pwa=await read("test/pwa.test.mjs");
  assert.doesNotMatch(offline,/field-pwa-v21/);
  assert.doesNotMatch(pwa,/field-pwa-v21/);
  assert.doesNotMatch(pwa,/8\.0\.0-pwa\.20/);
  assert.match(offline,/field-pwa-v\\d\+/);
  assert.match(pwa,/const appVersion=meta\.match/);
  assert.match(pwa,/FIELD_APP_VERSION/);
});
