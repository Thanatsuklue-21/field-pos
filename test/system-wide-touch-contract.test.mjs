import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=path=>readFile(new URL("../"+path,import.meta.url),"utf8");

test("system-wide interaction contract keeps actionable controls finger-safe and keyboard-visible",async()=>{
  const css=await read("app/globals.css");
  assert.ok(css.includes('.field-app-root :is(button,a[href],[role="button"]){'));
  assert.ok(css.includes("min-block-size:44px;"));
  assert.ok(css.includes("min-inline-size:44px;"));
  assert.ok(css.includes(':is(button,a[href],[role="button"]):focus-visible'));
  assert.ok(css.includes(':is(input,select,textarea):focus-visible'));
});

test("queue controls do not fall below the FIELD touch baseline",async()=>{
  const queue=await read("app/queue/page.tsx");
  assert.ok(queue.includes('className="grid h-11 w-11 shrink-0 place-items-center rounded-full'));
  assert.ok(queue.includes('aria-label="ปิดข้อความแจ้งเตือน"'));
  assert.equal(queue.includes("min-h-10 w-full"),false);
});

test("settings exposes the notification control as a real accessible switch",async()=>{
  const settings=await read("app/settings/page.tsx");
  assert.ok(settings.includes('role="switch"'));
  assert.ok(settings.includes("aria-checked={notifications}"));
  assert.ok(settings.includes('aria-label="การแจ้งเตือน"'));
  assert.ok(settings.includes('className={"flex h-11 w-14 items-center rounded-full p-1 '));
  assert.ok(settings.includes('aria-label="รีเฟรชความพร้อมระบบ"'));
  assert.ok(settings.includes('aria-label="รีเฟรชข้อมูลทดสอบ"'));
});

test("secondary operator/admin screens keep small actions explicit",async()=>{
  const orders=await read("app/orders/page.tsx");
  const recipes=await read("app/recipes/page.tsx");
  const reports=await read("app/reports/page.tsx");
  const close=await read("app/close/page.tsx");

  assert.ok(orders.includes('aria-label="ปิดข้อความ"'));
  assert.ok(recipes.includes('aria-label="ยกเลิกการแก้ไขความคิดเห็น"'));
  assert.ok(recipes.includes('aria-label={"แก้ไขความคิดเห็นของ "+c.authorName}'));
  assert.ok(recipes.includes('aria-label={"ลบวัตถุดิบลำดับ "+(index+1)}'));
  assert.equal(reports.includes("min-h-10"),false);
  assert.equal(close.includes("min-h-10"),false);
});
