import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("health check exposes only safe build identity metadata",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("path==='/api/health'");
  const block=api.slice(start,start+700);
  assert.ok(block.includes("VERCEL_GIT_COMMIT_SHA"));
  assert.ok(block.includes("VERCEL_ENV"));
  assert.ok(block.includes("buildSha"));
  assert.ok(block.includes("environment"));
  assert.ok(!block.includes("TURSO_AUTH_TOKEN"));
  assert.ok(!block.includes("password"));
  assert.ok(!block.includes("csrf"));
});

test("PWA readiness fetches uncached health and shows exact build identity",async()=>{
  const ui=await read("components/pwa-readiness.tsx");
  assert.ok(ui.includes('fetch("/api/health"'));
  assert.ok(ui.includes('cache:"no-store"'));
  assert.ok(ui.includes('"Build SHA"'));
  assert.ok(ui.includes('"Environment"'));
  assert.ok(ui.includes("build.buildSha.slice(0,10)"));
});
