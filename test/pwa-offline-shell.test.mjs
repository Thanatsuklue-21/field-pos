import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("offline operator requires a fresh usable bootstrap cache",async()=>{
  const db=await read("lib/offline-db.ts"),operator=await read("lib/offline-operator.ts"),pos=await read("app/pos/page.tsx");
  assert.ok(db.includes("BOOTSTRAP_OFFLINE_MAX_AGE_MS=36*60*60*1000"));
  assert.ok(db.includes("cacheAgeMs<=BOOTSTRAP_OFFLINE_MAX_AGE_MS"));
  assert.ok(operator.includes("if(!storage?.cacheReady)return null"));
  assert.ok(pos.includes("BOOTSTRAP_CACHE_MAX_AGE_MS=BOOTSTRAP_OFFLINE_MAX_AGE_MS"));
});

test("service worker warms required Next static chunks and never caches APIs",async()=>{
  const sw=await read("public/sw.js");
  assert.ok(sw.includes('VERSION="field-pwa-v12"'));
  assert.ok(sw.includes('OPTIONAL_PRECACHE=["/manifest.webmanifest"'));
  assert.ok(sw.includes('SAFE_OFFLINE_ROUTES=["/pos","/settings"]'));
  assert.ok(sw.includes("nextStaticUrls"));
  assert.ok(sw.includes('url.pathname.startsWith("/_next/static/")'));
  assert.ok(sw.includes("await Promise.all(SAFE_OFFLINE_ROUTES.map"));
  assert.ok(sw.includes("await Promise.all([...assets].map"));
  assert.ok(sw.includes('url.pathname.startsWith("/api/")'));
  const install=sw.slice(sw.indexOf('self.addEventListener("install"'),sw.indexOf('self.addEventListener("activate"'));
  assert.ok(install.includes("warmShell()"));
  assert.ok(!install.includes("skipWaiting("));
});

test("unsafe navigation shells are never cached or served offline",async()=>{
  const sw=await read("public/sw.js");
  assert.ok(sw.includes("safe=SAFE_OFFLINE_ROUTES.includes(url.pathname)"));
  assert.ok(sw.includes("if(response?.ok&&safe)"));
  assert.ok(sw.includes('cache.put(url.pathname,response.clone())'));
  assert.ok(sw.includes('safe?(await cache.match(url.pathname'));
  assert.ok(sw.includes('):(await cache.match("/pos")'));
});
