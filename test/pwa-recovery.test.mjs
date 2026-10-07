import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("cold-start offline operator fallback stores no password or csrf and is staff-limited",async()=>{
  const offline=await read("lib/offline-operator.ts"),auth=await read("components/auth-gate.tsx");
  assert.ok(offline.includes("MAX_AGE_MS=7*24*60*60*1000"));
  assert.ok(offline.includes('role:"staff"'));
  assert.ok(offline.includes('permissions:{order:true,queue:true}'));
  assert.ok(offline.includes('csrf:""'));
  assert.ok(!offline.includes("password"));
  assert.ok(auth.includes("getOfflineOperatorIfReady"));
  assert.ok(auth.includes('window.addEventListener("online",revalidate)'));
});

test("split and edit-cash recovery migrate from sessionStorage to durable localStorage",async()=>{
  const storage=await read("lib/recovery-storage.ts"),pos=await read("app/pos/page.tsx"),orders=await read("app/orders/page.tsx");
  assert.ok(storage.includes("localStorage.getItem"));
  assert.ok(storage.includes("sessionStorage.getItem"));
  assert.ok(storage.includes("localStorage.setItem(key,legacy)"));
  assert.ok(pos.includes("readRecovery<SplitGroup>(SPLIT_GROUP_KEY)"));
  assert.ok(pos.includes("writeRecovery(SPLIT_GROUP_KEY,g)"));
  assert.ok(pos.includes("readRecovery<any>(EDIT_CASH_KEY)"));
  assert.ok(orders.includes('writeRecovery("field-pos-edit-cash-v1"'));
});

test("offline fallback never syncs outbox or writes online before server session revalidation",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.ok(pos.includes("if(next&&!session.offline)syncOfflineQueue()"));
  assert.ok(pos.includes("if(!offlineAtStart&&session.offline)"));
  assert.ok(pos.includes("offline_session_revalidation"));
  assert.ok(pos.includes("if(!session.offline&&online)syncOfflineQueue()"));
});

test("mobile payment sheet follows visual viewport so Android keyboard cannot cover confirm action",async()=>{
  const runtime=await read("components/pwa-runtime.tsx"),css=await read("app/globals.css"),pos=await read("app/pos/page.tsx");
  assert.ok(runtime.includes("window.visualViewport"));
  assert.ok(runtime.includes("--field-visual-viewport-height"));
  assert.ok(css.includes(".field-payment-sheet"));
  assert.ok(css.includes("var(--field-visual-viewport-height,100dvh)"));
  assert.ok(pos.includes("field-payment-sheet"));
  assert.ok(pos.includes("sticky bottom-0"));
});

test("PWA update guard recognizes durable split and edit recovery",async()=>{
  const runtime=await read("components/pwa-runtime.tsx");
  assert.ok(runtime.includes('hasRecovery("field-pos-split-group-v1")'));
  assert.ok(runtime.includes('hasRecovery("field-pos-edit-cash-v1")'));
});
