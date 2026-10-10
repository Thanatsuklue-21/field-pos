import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("PWA smoke tool checks exact deployment identity and install surface without writes",async()=>{
  const script=await read("scripts/pwa-smoke.mjs");
  for(const token of ["/manifest.webmanifest","/sw.js","/pos","/settings","/api/health","EXPECTED_SHA","build_sha_mismatch","SAFE_OFFLINE_ROUTES"])assert.ok(script.includes(token),token);
  assert.ok(script.includes('method')===false||!script.includes('method:"POST"'));
  assert.ok(!script.includes("/api/pos/checkout"));
  assert.ok(!script.includes("/api/pos/queue"));
  assert.ok(script.includes("VERCEL_AUTOMATION_BYPASS_SECRET"));
  assert.ok(script.includes('x-vercel-protection-bypass'));
  assert.ok(script.includes('redirect:"manual"'));
  assert.ok(script.includes("_cross_origin_redirect"));
  assert.ok(!script.includes("console.log(bypassSecret)"));
});

test("package exposes the release smoke command",async()=>{
  const pkg=JSON.parse(await read("package.json"));
  assert.equal(pkg.scripts["pwa:smoke"],"node scripts/pwa-smoke.mjs");
});
