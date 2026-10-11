import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("FIELD catch-all API prefers Singapore for Thailand counter latency",async()=>{
  const route=await read("app/api/[...route]/route.js");
  assert.match(route,/export const runtime="nodejs"/);
  assert.match(route,/export const preferredRegion="sin1"/);
});

test("health and build remain fast paths before schema initialization",async()=>{
  const route=await read("app/api/[...route]/route.js");
  const health=route.indexOf('routePath==="/api/health"');
  const build=route.indexOf('routePath==="/api/build"');
  const schema=route.indexOf("await ensureDbSchema()");
  assert.ok(health>0&&build>0&&schema>health&&schema>build);
});
