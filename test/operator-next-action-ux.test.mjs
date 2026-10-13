import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("queue tells a first-time operator one next action and current stage",async()=>{
  const queue=await read("app/queue/page.tsx");
  assert.ok(queue.includes("const queueStage=task?1:firstReady&&!firstCalled?2:waitingPickup.length>0?3:1"));
  assert.ok(queue.includes("const queueInstruction=task"));
  assert.ok(queue.includes("ตอนนี้ทำอะไร"));
  assert.ok(queue.includes("ขั้น {queueStage}/3"));
  assert.ok(queue.includes('["1 ทำเครื่องดื่ม","2 เรียกบัตร","3 ส่งมอบ"]'));
  assert.ok(queue.includes("เสร็จแล้ว · {task.item.name} ครบ"));
});

test("queue guidance does not replace FIFO or durable queue action authority",async()=>{
  const queue=await read("app/queue/page.tsx");
  assert.ok(queue.includes("nextTask(orders)"));
  assert.ok(queue.includes("sendQueueActionDurably"));
  assert.ok(queue.includes('action:"complete_item"'));
  assert.ok(queue.includes('action:"call"'));
  assert.ok(queue.includes('action:"return"'));
});

test("menu grid defers offscreen rendering and mobile inputs avoid browser zoom",async()=>{
  const pos=await read("app/pos/page.tsx"),css=await read("app/globals.css");
  assert.ok(pos.includes("pos-menu-card"));
  assert.ok(css.includes(".pos-menu-card{content-visibility:auto;contain-intrinsic-size:190px}"));
  assert.ok(css.includes(".field-app-root input"));
  assert.ok(css.includes("font-size:16px"));
});
