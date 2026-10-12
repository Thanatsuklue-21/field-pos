import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("health endpoint keeps established DB-health contract",async()=>{
  const api=await read("lib/api.mjs");
  assert.ok(api.includes("if(path==='/api/health'&&method==='GET'){await one(db,'SELECT 1 AS ok');return reply(res,200,{ok:true,storage:'turso'})}"));
});

test("build endpoint exposes only non-sensitive release identity",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("path==='/api/build'");
  assert.ok(start>=0);
  const end=api.indexOf('routePath==="/api/health"',start);\n  const block=api.slice(start,end);
  assert.ok(block.includes("VERCEL_GIT_COMMIT_SHA"));
  assert.ok(block.includes("VERCEL_ENV"));
  assert.ok(block.includes("buildSha"));
  assert.ok(block.includes("environment"));
  assert.ok(block.includes("FIELD_DB_SCOPE"));
  assert.ok(block.includes("databaseScope"));
  assert.ok(block.includes('rawScope==="uat"||rawScope==="production"'));
  assert.ok(!block.includes("TURSO_AUTH_TOKEN"));
  assert.ok(!block.includes("password"));
  assert.ok(!block.includes("csrf"));
});

test("PWA readiness fetches uncached build metadata and shows exact build identity",async()=>{
  const ui=await read("components/pwa-readiness.tsx");
  assert.ok(ui.includes('fetch("/api/build"'));
  assert.ok(ui.includes('cache:"no-store"'));
  assert.ok(ui.includes('"Build SHA"'));
  assert.ok(ui.includes('"Environment"'));
  assert.ok(ui.includes("build.buildSha.slice(0,10)"));
});

test("route-level health reports missing preview Turso without throwing runtime errors",async()=>{
  const route=await read("app/api/[...route]/route.js");
  assert.ok(route.includes('routePath==="/api/health"'));
  assert.ok(route.includes("!process.env.TURSO_DATABASE_URL||!process.env.TURSO_AUTH_TOKEN"));
  assert.ok(route.includes('error:"turso_not_configured"'));
  assert.ok(route.includes("status:503"));
  assert.ok(route.includes('getDb().execute("SELECT 1 AS ok")'));
});

test("PWA readiness exposes backend UAT readiness without reusing production secrets",async()=>{
  const ui=await read("components/pwa-readiness.tsx");
  assert.ok(ui.includes('fetch("/api/health"'));
  assert.ok(ui.includes('"Backend / Turso"'));
  assert.ok(ui.includes('"UAT BLOCKED"'));
  assert.ok(ui.includes("ห้ามใช้ Production DB กับ Preview"));
});


test("Preview UAT readiness fails closed unless database scope is uat",async()=>{
  const route=await read("app/api/[...route]/route.js"),ui=await read("components/pwa-readiness.tsx");
  assert.ok(route.includes('rawScope==="uat"||rawScope==="production"?rawScope:rawScope?"invalid":"unconfigured"'));
  assert.ok(ui.includes('build.environment==="preview"?build.databaseScope==="uat"'));
  assert.ok(ui.includes('uatReady?"UAT READY":"UAT BLOCKED"'));
});
