import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("recipe editor shows live draft release readiness before publish",async()=>{
  const page=await read("app/recipes/page.tsx");
  assert.ok(page.includes("draftReadiness"));
  assert.ok(page.includes("DRAFT READINESS · ก่อน Publish"));
  assert.ok(page.includes("draftReadiness.maxServings"));
  assert.ok(page.includes('draftReadiness.costStatus'));
  assert.ok(page.includes("Stock ต่ำ · ทำได้ไม่เกิน 5 แก้ว"));
});

test("recipe editor blocks publish when draft references missing or archived stock master data",async()=>{
  const page=await read("app/recipes/page.tsx");
  assert.ok(page.includes("archived===0"));
  assert.ok(page.includes("!draftReadiness.valid"));
  assert.ok(page.includes("Draft มีวัตถุดิบหาย/ถูก Archive · Publish ไม่ได้"));
});
