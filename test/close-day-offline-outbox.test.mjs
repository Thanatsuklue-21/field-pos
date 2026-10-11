import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("close-day checks the local Offline cash outbox immediately before posting close",async()=>{
  const ui=await read("app/close/page.tsx");
  const start=ui.indexOf("async function close()");
  const end=ui.indexOf("return <section",start);
  const block=ui.slice(start,end);
  assert.match(block,/await refreshOfflineOutbox\(\)/);
  assert.match(block,/if\(outbox\.total>0\)/);
  assert.match(block,/มีบิล Offline ในเครื่อง/);
  assert.ok(block.indexOf("await refreshOfflineOutbox()")<block.indexOf('api<any>("/api/close-day"'));
});

test("close-day fails closed when IndexedDB outbox cannot be read",async()=>{
  const ui=await read("app/close/page.tsx");
  assert.match(ui,/offlineOutboxError/);
  assert.match(ui,/offline_outbox_unavailable/);
  assert.match(ui,/ตรวจ Offline outbox ในเครื่องไม่สำเร็จ/);
  assert.match(ui,/offlineOutbox===null\|\|offlineOutboxError\|\|offlineOutbox\.total>0/);
});

test("close-day surfaces a dedicated Offline blocker with a path back to POS sync",async()=>{
  const ui=await read("app/close/page.tsx");
  assert.match(ui,/ปิดวันไม่ได้ · Offline outbox ยังไม่พร้อม/);
  assert.match(ui,/ไป POS \/ Sync Offline/);
  assert.match(ui,/router\.push\("\/pos"\)/);
});
