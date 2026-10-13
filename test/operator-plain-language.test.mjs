import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("critical operator recovery copy explains the action without engineering jargon",async()=>{
  const pos=await read("app/pos/page.tsx");
  const queue=await read("app/queue/page.tsx");
  const orders=await read("app/orders/page.tsx");
  const hub=await read("components/pos-operations-hub.tsx");
  const expense=await read("lib/expense-client.ts");
  const queueClient=await read("lib/queue-client.ts");
  const combined=[pos,queue,orders,hub,expense,queueClient].join("\n");

  for(const oldCopy of [
    "ข้อมูล recovery การชำระ",
    "กำลังตรวจ request เดิมกับ Server",
    "Server ไม่พบ replay",
    "เก็บ request เดิมไว้",
    "Server ปฏิเสธรายการเงินสดเดิม",
    "ยังอ่าน recovery storage ไม่ได้",
    "ล้าง recovery storage ไม่สำเร็จ",
    "Queue action เดิม",
    "Server ยังไม่ยืนยัน Queue action",
    "ข้อมูล Queue recovery",
    "VOID/Refund เดิม",
    "Server ยังไม่ยืนยัน VOID/Refund",
    "ยังไม่ดึงคิวจาก Server",
    "Server บังคับ FIFO"
  ]) assert.equal(combined.includes(oldCopy),false,oldCopy);

  assert.match(pos,/ข้อมูลติดตามรายการชำระก่อนหน้าในเครื่องมีปัญหา/);
  assert.match(pos,/ระบบกำลังตรวจรายการเดิมก่อน ห้ามกดรับเงินซ้ำ/);
  assert.match(queue,/การกดคิวก่อนหน้ายังตรวจสอบไม่เสร็จ · ห้ามกดซ้ำ/);
  assert.match(orders,/การยกเลิกหรือคืนเงินก่อนหน้าที่ยังตรวจสอบไม่เสร็จ/);
  assert.match(expense,/ค่าใช้จ่ายรายการก่อนหน้าที่ยังตรวจสอบไม่เสร็จ/);
  assert.match(queueClient,/เก็บข้อมูลเดิมไว้เพื่อป้องกันตัดสต็อกหรือเปลี่ยนคิวซ้ำ/);
  assert.match(hub,/ระบบไม่อนุญาตให้ข้ามคิว/);
});

test("plain-language copy keeps the safety instruction explicit",async()=>{
  const files=await Promise.all([
    read("app/pos/page.tsx"),
    read("app/queue/page.tsx"),
    read("app/orders/page.tsx"),
    read("lib/expense-client.ts")
  ]);
  const copy=files.join("\n");
  assert.match(copy,/ห้ามกดรับเงินซ้ำ/);
  assert.match(copy,/ห้ามกดซ้ำ/);
  assert.match(copy,/ป้องกันบิลซ้ำ/);
  assert.match(copy,/ป้องกันยอดซ้ำ/);
});
