import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("FIELD exposes an installable PWA manifest from the current app",async()=>{
  const manifest=await read("app/manifest.ts");
  assert.match(manifest,/name:"FIELD POS"/);
  assert.match(manifest,/short_name:"FIELD"/);
  assert.match(manifest,/start_url:"\/pos"/);
  assert.match(manifest,/display:"standalone"/);
  assert.match(manifest,/field-pos-icon\.svg/);
  assert.match(manifest,/field-pos-icon-maskable\.svg/);
});

test("PWA registration is attached to the real app shell",async()=>{
  const layout=await read("app/layout.tsx");
  const reg=await read("components/pwa-register.tsx");
  assert.match(layout,/PwaRegister/);
  assert.match(layout,/<PwaRegister\/>/);
  assert.match(reg,/navigator\.serviceWorker\.register\("\/sw\.js"/);
  assert.match(reg,/scope:"\/"}/);
});

test("PWA viewport enables safe-area insets on cutout and gesture devices",async()=>{
  const layout=await read("app/layout.tsx");
  const css=await read("app/globals.css");
  assert.match(layout,/import type \{Metadata,Viewport\} from "next"/);
  assert.match(layout,/export const viewport:Viewport=/);
  assert.match(layout,/width:"device-width"/);
  assert.match(layout,/initialScale:1/);
  assert.match(layout,/viewportFit:"cover"/);
  assert.match(css,/env\(safe-area-inset-top\)/);
  assert.match(css,/env\(safe-area-inset-bottom\)/);
});

test("service worker never owns API or mutation requests",async()=>{
  const sw=await read("public/sw.js");
  assert.match(sw,/if\(request\.method!==\"GET\"\)return/);
  assert.match(sw,/if\(url\.pathname\.startsWith\("\/api\/"\)\)return/);
  assert.doesNotMatch(sw,/method:\s*["']POST["']/);
  assert.doesNotMatch(sw,/method:\s*["']PUT["']/);
  assert.doesNotMatch(sw,/method:\s*["']DELETE["']/);
  assert.doesNotMatch(sw,/backgroundSync|sync\.register|request\.clone\(\).*fetch/s);
});

test("offline cache is limited to POS shell and static assets",async()=>{
  const sw=await read("public/sw.js");
  assert.match(sw,/const SHELL="\/pos"/);
  assert.match(sw,/request\.mode===\"navigate\"/);
  assert.match(sw,/url\.pathname===\"\/pos\"/);
  assert.match(sw,/STATIC_DESTINATIONS/);
  assert.match(sw,/style/);
  assert.match(sw,/script/);
  assert.match(sw,/font/);
  assert.match(sw,/image/);
  assert.doesNotMatch(sw,/\/orders|\/stock|\/close|\/expenses/);
});
