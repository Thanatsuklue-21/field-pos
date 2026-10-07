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

test("service worker warms Next static chunks during install without caching APIs",async()=>{
  const sw=await read("public/sw.js");
  assert.ok(sw.includes('VERSION="field-pwa-v4"'));
  assert.ok(sw.includes('"/manifest.webmanifest"'));
  assert.ok(sw.includes('"/settings"'));
  assert.ok(sw.includes("nextStaticUrls"));
  assert.ok(sw.includes('url.pathname.startsWith("/_next/static/")'));
  assert.ok(sw.includes("Promise.allSettled(assets.map"));
  assert.ok(sw.includes('url.pathname.startsWith("/api/")'));
  const install=sw.slice(sw.indexOf('self.addEventListener("install"'),sw.indexOf('self.addEventListener("activate"'));
  assert.ok(install.includes("warmShell()"));
  assert.ok(!install.includes("skipWaiting("));
});
