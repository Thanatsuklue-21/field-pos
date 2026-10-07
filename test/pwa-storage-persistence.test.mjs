import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("PWA runtime reports browser storage persistence without blocking launch",async()=>{
  const runtime=await read("components/pwa-runtime.tsx");
  const meta=await read("lib/pwa-meta.ts");
  assert.ok(runtime.includes('navigator.storage.persisted'));
  assert.ok(runtime.includes('navigator.storage.estimate'));
  assert.ok(runtime.includes('storagePersistenceSupported:persistenceSupported'));
  assert.ok(meta.includes("storagePersisted:boolean|null"));
  assert.ok(meta.includes("storageUsage:number|null"));
  assert.ok(meta.includes("storageQuota:number|null"));
});

test("persistent storage is opt-in from readiness UI",async()=>{
  const runtime=await read("components/pwa-runtime.tsx");
  const readiness=await read("components/pwa-readiness.tsx");
  assert.ok(runtime.includes('navigator.storage.persist()'));
  assert.ok(runtime.includes("PWA_PERSIST_STORAGE_REQUEST_EVENT"));
  assert.ok(readiness.includes("PERSISTENT"));
  assert.ok(readiness.includes("BEST EFFORT"));
  assert.ok(readiness.includes("ขอเก็บข้อมูล Offline แบบถาวร"));
  assert.ok(readiness.includes("PWA_PERSIST_STORAGE_REQUEST_EVENT"));
});
