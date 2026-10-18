import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("queue waste/remake uses an in-app review instead of browser confirm",async()=>{
  const queue=await read("app/queue/page.tsx");
  assert.match(queue,/import ModalFocus from "@\/components\/modal-focus"/);
  assert.match(queue,/queue-waste-review-title/);
  assert.match(queue,/ตรวจอีกครั้งก่อนบันทึก/);
  assert.match(queue,/ชงเสีย \/ ทำใหม่ 1 แก้ว/);
  assert.match(queue,/ไม่ใช่การ Refund หรือ Void/);
  assert.match(queue,/data-queue-waste-confirm/);
  assert.doesNotMatch(queue,/window\.confirm\("บันทึก “ชงเสีย \/ ทำใหม่”/);
});

test("waste review re-resolves the live FIFO order before mutating stock",async()=>{
  const queue=await read("app/queue/page.tsx");
  const start=queue.indexOf("async function confirmWasteRemake");
  const end=queue.indexOf("async function callOrder",start);
  const block=queue.slice(start,end);
  assert.match(block,/orders\.find\(row=>row\.id===review\.orderId\)/);
  assert.match(block,/item\.id!==review\.itemId/);
  assert.match(block,/await load\(\)\.catch/);
  assert.match(block,/await wasteRemake\(order,item,review\.itemIndex\)/);
});

test("queue waste review explains irreversible effects before the red action",async()=>{
  const queue=await read("app/queue/page.tsx");
  assert.match(queue,/บันทึก WASTE 1 แก้ว/);
  assert.match(queue,/ลงค่าใช้จ่าย WASTE อัตโนมัติ/);
  assert.match(queue,/หักวัตถุดิบเพิ่มตามสูตรที่ใช้ตอนขาย/);
  assert.match(queue,/คงคิวเดิมไว้ แล้วทำเมนูนี้ใหม่ต่อ/);
  assert.match(queue,/bg-red-700/);
  assert.match(queue,/ยังไม่บันทึก/);
  assert.match(queue,/min-h-12/);
});
