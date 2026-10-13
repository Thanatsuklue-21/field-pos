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
  assert.match(pos,/online=\{online\}/);
});

test("daily workspace covers queue orders stock quick expense and owner readiness",async()=>{
  const hub=await read("components/pos-daily-workspace.tsx");
  assert.match(hub,/FIELD DAILY WORKSPACE/);
  for(const label of ["คิว","ออเดอร์","สต็อก","รายจ่าย","สถานะ"])assert.match(hub,new RegExp(label));
  assert.match(hub,/\/api\/pos\/queue/);
  assert.match(hub,/\/api\/pos\/history/);
  assert.match(hub,/\/api\/expenses/);
  assert.match(hub,/\/api\/control-center/);
  assert.match(hub,/bootstrap\?\.menu/);
});

test("daily workspace quick expense reuses report permission and durable expense recovery",async()=>{
  const hub=await read("components/pos-daily-workspace.tsx");
  assert.match(hub,/session\.user\.permissions\?\.queue===true/);
  assert.match(hub,/session\.user\.permissions\?\.order===true/);
  assert.match(hub,/session\.user\.permissions\?\.stock===true/);
  assert.match(hub,/session\.user\.permissions\?\.report===true/);
  assert.match(hub,/prepareExpenseIntent/);
  assert.match(hub,/readExpenseIntent/);
  assert.match(hub,/sendExpenseIntent/);
  assert.match(hub,/method:"POST"/);
  assert.doesNotMatch(hub,/method:"DELETE"/);
  assert.match(hub,/X-CSRF-Token/);
  assert.match(hub,/highRiskExpense/);
  assert.match(hub,/cashTooLarge/);
  for(const href of ["/queue","/orders","/stock","/expenses","/control"])assert.match(hub,new RegExp('href="'+href.replaceAll("/","\\/")+'"'));
});

test("workspace exposes latest receipt through the existing Orders deep link",async()=>{
  const hub=await read("components/pos-daily-workspace.tsx");
  assert.match(hub,/ดูใบเสร็จล่าสุด/);
  assert.match(hub,/\/orders\?queue=/);
  const orders=await read("app/orders/page.tsx");
  assert.match(orders,/new URLSearchParams\(window\.location\.search\)\.get\("queue"\)/);
});

test("workspace fails safe offline while still exposing cached stock signals",async()=>{
  const hub=await read("components/pos-daily-workspace.tsx");
  assert.match(hub,/OFFLINE · ดูสัญญาณสต็อกจากข้อมูลล่าสุดได้/);
  assert.match(hub,/disabled=\{busy\|\|!online\}/);
  assert.match(hub,/เมนูที่เปิดขายยังไม่พบสัญญาณสต็อกต่ำ/);
});

test("workspace remains touch friendly and light-theme compliant",async()=>{
  const hub=await read("components/pos-daily-workspace.tsx");
  assert.match(hub,/min-h-12/);
  assert.match(hub,/h-11 w-11/);
  assert.doesNotMatch(hub,/bg-black\/[6789]/);
  assert.doesNotMatch(hub,/border-white\//);
});
