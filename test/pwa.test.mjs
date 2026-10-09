import test from "node:test";
import assert from "node:assert/strict";
import {readFile,stat} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("PWA manifest is installable and uses FIELD non-black splash colors",async()=>{
  const manifest=await read("app/manifest.ts");
  assert.ok(manifest.includes('name:"FIELD POS"'));
  assert.ok(manifest.includes('start_url:"/pos"'));
  assert.ok(manifest.includes('display:"standalone"'));
  assert.ok(manifest.includes('orientation:"portrait-primary"'));
  assert.ok(manifest.includes("192x192"));
  assert.ok(manifest.includes("512x512"));
  assert.ok(manifest.includes('purpose:"any"'));
  assert.ok(manifest.includes('purpose:"maskable"'));
  assert.ok(manifest.includes("#F7F1E3"));
  assert.ok(manifest.includes("#1F4D3A"));
  await stat(new URL("../public/field-icon-192.png",import.meta.url));
  await stat(new URL("../public/field-icon-512.png",import.meta.url));
  await stat(new URL("../public/field-icon-180.png",import.meta.url));
});

test("service worker never caches API and only updates after explicit safe request",async()=>{
  const sw=await read("public/sw.js");
  assert.ok(sw.includes('request.method!=="GET"'));
  assert.ok(sw.includes('url.pathname.startsWith("/api/")'));
  assert.ok(sw.includes("SKIP_WAITING"));
  const install=sw.slice(sw.indexOf('self.addEventListener("install"'),sw.indexOf('self.addEventListener("activate"'));
  assert.ok(!install.includes("skipWaiting("));
});

test("PWA runtime blocks reload while transaction recovery state is active",async()=>{
  const runtime=await read("components/pwa-runtime.tsx");
  const safety=await read("lib/pwa-update-safety.ts");
  for(const token of ["field-pos-pending-promptpay-v1","field-pos-pending-cash-v1","field-pos-split-group-v1","field:transaction-busy","field:sync","pendingReloadRef","beforeinstallprompt"]){
    assert.ok((runtime+safety).includes(token),token);
  }
});

test("layout exposes standalone metadata apple icon and safe viewport",async()=>{
  const layout=await read("app/layout.tsx");
  assert.ok(layout.includes('manifest:"/manifest.webmanifest"'));
  assert.ok(layout.includes("field-icon-180.png"));
  assert.ok(layout.includes('viewportFit:"cover"'));
  assert.ok(layout.includes("mobile-web-app-capable"));
});

test("PWA readiness shows local cache outbox version and server readiness",async()=>{
  const ui=await read("components/pwa-readiness.tsx"),settings=await read("app/settings/page.tsx");
  for(const token of ["PWA Installable","Service Worker","App Update","IndexedDB","Offline Outbox","Recovery","Build SHA","Server Revision","PromptPay"])assert.ok(ui.includes(token),token);
  assert.ok(settings.includes("PwaReadiness"));
});

test("network status supports syncing and recoverable sync errors",async()=>{
  const net=await read("components/network-status.tsx");
  assert.ok(net.includes("syncing"));
  assert.ok(net.includes("sync_error"));
  assert.ok(net.includes("field:sync"));
});

test("POS menu images are lazy and PWA shell prioritizes core operator routes",async()=>{
  const pos=await read("app/pos/page.tsx"),shell=await read("components/app-shell.tsx");
  assert.ok(pos.includes('loading="lazy"'));
  assert.ok(pos.includes('decoding="async"'));
  assert.ok(shell.includes('primaryMobile=["/pos","/queue","/orders","/stock"]'));
  assert.ok(shell.includes('mobileOverflow(allowed)'));
});

test("service worker and manifest bypass deployment cache staleness",async()=>{
  const config=JSON.parse(await read("vercel.json"));
  const sw=(config.headers||[]).find(x=>x.source==="/sw.js");
  assert.ok(sw);
  const byKey=Object.fromEntries(sw.headers.map(x=>[x.key,x.value]));
  assert.ok((byKey["Cache-Control"]||"").includes("no-cache"));
  assert.equal(byKey["Service-Worker-Allowed"],"/");
});

test("safe offline settings route is precached with a bumped PWA cache version",async()=>{
  const sw=await read("public/sw.js"),meta=await read("lib/pwa-meta.ts");
  assert.ok(sw.includes('VERSION="field-pwa-v16"'));
  assert.ok(sw.includes('SAFE_OFFLINE_ROUTES=["/pos","/settings"]'));
  assert.ok(meta.includes('FIELD_APP_VERSION="8.0.0-pwa.15"'));
});

test("safe offline route chunks are warmed for both POS and Settings",async()=>{
  const sw=await read("public/sw.js");
  assert.ok(sw.includes('SAFE_OFFLINE_ROUTES=["/pos","/settings"]'));
  assert.ok(sw.includes("SAFE_OFFLINE_ROUTES.map"));
  assert.ok(sw.includes("for(const asset of nextStaticUrls"));
  assert.ok(sw.includes("await Promise.all([...assets].map"));
});

test("service worker refuses a new version when required offline shell assets cannot be warmed",async()=>{
  const sw=await read("public/sw.js");
  assert.ok(sw.includes("async function fetchRequired"));
  assert.ok(sw.includes('throw new Error("pwa_shell_fetch_failed:"'));
  assert.ok(sw.includes("await Promise.all(SAFE_OFFLINE_ROUTES.map"));
  assert.ok(sw.includes("await Promise.all([...assets].map"));
  assert.ok(sw.includes("OPTIONAL_PRECACHE"));
  const requiredSection=sw.slice(sw.indexOf("// Required offline routes"),sw.indexOf("// Manifest/icons"));
  assert.ok(!requiredSection.includes("Promise.allSettled"));
});
