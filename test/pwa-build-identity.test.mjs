import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("build endpoint exposes only safe build identity metadata",async()=>{
  const api=await read("lib/api.mjs");
  const line=api.split("\n").find(x=>x.includes("path==='/api/build'"))||"";
  assert.ok(line.includes("VERCEL_GIT_COMMIT_SHA"));
  assert.ok(line.includes("VERCEL_ENV"));
  assert.ok(line.includes("buildSha"));
  assert.ok(line.includes("environment"));
  assert.ok(line.includes("return reply(res,200,{buildSha:buildSha||null,environment})"));
  assert.ok(!line.includes("TURSO_AUTH_TOKEN"));
  assert.ok(!line.includes("password"));
  assert.ok(!line.includes("csrf"));
});

test("health endpoint keeps its established minimal contract",async()=>{
  const api=await read("lib/api.mjs");
  assert.ok(api.includes("if(path==='/api/health'&&method==='GET'){await one(db,'SELECT 1 AS ok');return reply(res,200,{ok:true,storage:'turso'})}"));
});

test("PWA readiness fetches uncached build metadata and shows exact build identity",async()=>{
  const ui=await read("components/pwa-readiness.tsx");
  assert.ok(ui.includes('fetch("/api/build"'));
  assert.ok(ui.includes('cache:"no-store"'));
  assert.ok(ui.includes('"Build SHA"'));
  assert.ok(ui.includes('"Environment"'));
  assert.ok(ui.includes("build.buildSha.slice(0,10)"));
});
