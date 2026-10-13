import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("POS opens the daily workspace in-place and blocks it during payment mutation",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/PosDailyWorkspace/);
  assert.match(pos,/setWorkspaceOpen\(true\)/);
  assert.match(pos,/>งานร้าน<\/button>/);
  assert.match(pos,/disabled=\{busy\|\|payOpen\}/);
  assert.match(pos,/bootstrap=\{data\}/);
});

test("daily workspace covers queue orders stock and owner readiness without route switching",async()=>{
  const hub=await read("components/pos-daily-workspace.tsx");
  assert.match(hub,/FIELD DAILY WORKSPACE/);
  for(const label of ["คิว","ออเดอร์","สต็อก","สถานะ"])assert.match(hub,new RegExp(label));
  assert.match(hub,/\/api\/pos\/queue/);
  assert.match(hub,/\/api\/pos\/history/);
  assert.match(hub,/\/api\/control-center/);
  assert.match(hub,/bootstrap\?\.menu/);
});

test("daily workspace is permission-aware and keeps high-risk mutations on full flows",async()=>{
  const hub=await read("components/pos-daily-workspace.tsx");
  assert.match(hub,/session\.user\.permissions\?\.queue===true/);
  assert.match(hub,/session\.user\.permissions\?\.order===true/);
  assert.match(hub,/session\.user\.permissions\?\.stock===true/);
  assert.match(hub,/session\.user\.role==="admin"/);
  assert.doesNotMatch(hub,/method:"POST"/);
  for(const href of ["/queue","/orders","/stock","/control"])assert.match(hub,new RegExp('href="'+href.replaceAll("/","\\/")+'"'));
});

test("workspace fails safe offline while still exposing cached stock signals",async()=>{
  const hub=await read("components/pos-daily-workspace.tsx");
  assert.match(hub,/OFFLINE · ดูสัญญาณสต็อกจากข้อมูลล่าสุดได้/);
  assert.match(hub,/disabled=\{busy\|\|session\.offline\}/);
  assert.match(hub,/เมนูที่เปิดขายยังไม่พบสัญญาณสต็อกต่ำ/);
});

test("workspace remains touch friendly and light-theme compliant",async()=>{
  const hub=await read("components/pos-daily-workspace.tsx");
  assert.match(hub,/min-h-12/);
  assert.match(hub,/h-11 w-11/);
  assert.doesNotMatch(hub,/bg-black\/[6789]/);
  assert.doesNotMatch(hub,/border-white\//);
});
