import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("kitchen delivery recovery is visible inside the POS operations hub",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  assert.match(hub,/\/api\/pos\/kitchen\/status/);
  assert.match(hub,/แจ้งบาร์ผ่าน LINE ค้าง/);
  assert.match(hub,/ลองส่งแจ้งบาร์ที่ค้างอีกครั้ง/);
  assert.match(hub,/ไม่ต้องทำรายการขายหรือรับเงินซ้ำ/);
  assert.match(hub,/kitchenStatus\.retryable/);
  assert.match(hub,/kitchenStatus\.blocked/);
  assert.match(hub,/kitchenStatus\.stale/);
});

test("only admin can execute kitchen retry while queue operators can see status",async()=>{
  const api=await read("lib/api.mjs");
  const statusStart=api.indexOf("if(path==='/api/pos/kitchen/status'");
  const retryStart=api.indexOf("if(path==='/api/pos/kitchen/retry'");
  assert.ok(statusStart>0&&retryStart>statusStart);
  const statusBlock=api.slice(statusStart,retryStart);
  const retryBlock=api.slice(retryStart,retryStart+700);
  assert.match(statusBlock,/queue_permission_required/);
  assert.match(retryBlock,/user\.role!==['"]admin['"]/);
  assert.match(retryBlock,/drainKitchenOutbox/);
  assert.match(retryBlock,/getKitchenOutboxStatus/);
});

test("compact kitchen recovery does not touch payment stock or queue state",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  const start=hub.indexOf("async function retryKitchenNotifications");
  const end=hub.indexOf("async function runQuickQueueAction",start);
  const block=hub.slice(start,end);
  assert.match(block,/\/api\/pos\/kitchen\/retry/);
  assert.doesNotMatch(block,/\/api\/pos\/checkout|\/api\/stock|sendQueueActionDurably/);
});
