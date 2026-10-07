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
  for(const token of ["field-pos-pending-promptpay-v1","field-pos-pending-cash-v1","field-pos-split-group-v1","field:transaction-busy","field:sync","pendingReloadRef","beforeinstallprompt"]){
    assert.ok(runtime.includes(token),token);
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
  for(const token of ["Service Worker","IndexedDB","Offline Outbox","Server Revision","PromptPay"])assert.ok(ui.includes(token),token);
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
  assert.ok(shell.includes('mobileOrder=["/pos","/queue","/orders","/stock"'));
});

test("service worker and manifest bypass deployment cache staleness",async()=>{
  const config=JSON.parse(await read("vercel.json"));
  const sw=(config.headers||[]).find(x=>x.source==="/sw.js");
  assert.ok(sw);
  const byKey=Object.fromEntries(sw.headers.map(x=>[x.key,x.value]));
  assert.ok((byKey["Cache-Control"]||"").includes("no-cache"));
  assert.equal(byKey["Service-Worker-Allowed"],"/");
});
