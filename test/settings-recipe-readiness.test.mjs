import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

test("System Readiness surfaces invalid active recipe stock references",async()=>{
  const page=await readFile(new URL("../app/settings/page.tsx",import.meta.url),"utf8");
  assert.ok(page.includes("สูตรอ้าง Stock ใช้ไม่ได้"));
  assert.ok(page.includes("readiness.menu?.invalidRecipeIngredients"));
});
