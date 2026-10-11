import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {shouldRetainQueuePending,validatePendingQueueAction} from "../lib/queue-action-recovery.mjs";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("queue pending records require a stable request key, order and action",()=>{
  const row={body:{requestKey:"queue-key-0001",orderId:"order-1",action:"waste_remake",itemIndex:0},createdAt:1};
  assert.equal(validatePendingQueueAction(row),row);
  for(const bad of [
    null,
    {body:null,createdAt:1},
    {body:{requestKey:"x",orderId:"order-1",action:"call"},createdAt:1},
    {body:{requestKey:"queue-key-0001",orderId:"",action:"call"},createdAt:1},
    {body:{requestKey:"queue-key-0001",orderId:"order-1",action:""},createdAt:1},
    {body:{requestKey:"queue-key-0001",orderId:"order-1",action:"call"},createdAt:0}
  ]) assert.throws(()=>validatePendingQueueAction(bad),/queue_recovery_corrupt/);
});

test("queue pending is retained only for ambiguous transport/server outcomes",()=>{
  for(const error of [
    Object.assign(new Error("network"),{status:0}),
    Object.assign(new Error("timeout"),{status:408}),
    Object.assign(new Error("too_early"),{status:425}),
    Object.assign(new Error("rate"),{status:429}),
    Object.assign(new Error("server"),{status:503})
  ]) assert.equal(shouldRetainQueuePending(error),true);
  for(const status of [400,401,403,404,409,422]){
    assert.equal(shouldRetainQueuePending(Object.assign(new Error("rejected"),{status})),false);
  }
});

test("queue UI persists exact action body before sending and replays the same pending request",async()=>{
  const queue=await read("app/queue/page.tsx");
  const start=queue.indexOf("async function sendQueueAction");
  const end=queue.indexOf("useEffect(()=>",start);
  const block=queue.slice(start,end);
  assert.match(block,/queuePendingRead\(\)/);
  assert.match(block,/queuePendingWrite\(body\)/);
  assert.match(block,/body:JSON\.stringify\(pending\.body\)/);
  assert.ok(block.indexOf("queuePendingWrite(body)")<block.indexOf('api<any>("/api/pos/queue"'));
  assert.match(block,/if\(!shouldRetainQueuePending\(e\)\)queuePendingClear\(\)/);

  const recoverStart=queue.indexOf('setBusy("recover:"');
  const recoverBlock=queue.slice(recoverStart,recoverStart+1700);
  assert.match(recoverBlock,/sendQueueAction\(pending\.body\)/);
  assert.match(recoverBlock,/ใช้ request key เดิมและไม่ทำรายการซ้ำ/);
});

test("all operator queue mutations use durable sendQueueAction including WASTE and handoff",async()=>{
  const queue=await read("app/queue/page.tsx");
  for(const action of ["complete_item","waste_remake","call","call_item","return"]){
    assert.match(queue,new RegExp('sendQueueAction\\(\\{requestKey:crypto\\.randomUUID\\(\\).*action:"'+action+'"'));
  }
  const sendStart=queue.indexOf("async function sendQueueAction");
  const sendEnd=queue.indexOf("useEffect(()=>",sendStart);
  const outside=queue.slice(0,sendStart)+queue.slice(sendEnd);
  assert.doesNotMatch(outside,/api<any>\("\/api\/pos\/queue",\{method:"POST"/);
});

test("queue write timeout is enabled only after durable action recovery exists",async()=>{
  const client=await read("lib/api-client.ts");
  const queue=await read("app/queue/page.tsx");
  const recovery=await read("lib/queue-action-recovery.mjs");
  assert.match(client,/RECOVERABLE_WRITE_PATHS=new Set\(\[[\s\S]*"\/api\/pos\/queue"/);
  assert.match(recovery,/field-pos-pending-queue-action-v1/);
  assert.match(queue,/QUEUE_PENDING_KEY/);
  assert.match(queue,/queue_action_pending/);
  assert.match(queue,/queue_recovery_storage_unavailable/);
});

test("server queue action idempotency still precedes mutation and WASTE is replay-safe",async()=>{
  const pos=await read("lib/pos-api.mjs");
  const start=pos.indexOf("export async function queuePosAction");
  const block=pos.slice(start);
  assert.match(block,/const old=await replay\(tx,doc,body\.requestKey,context\)/);
  assert.ok(block.indexOf("const old=await replay")<block.indexOf("if(action==='waste_remake')"));
  const core=await read("test/core-integration.test.mjs");
  assert.match(core,/const body=\{requestKey:'remake-waste-0001'/);
  assert.match(core,/const replay=await queuePosAction/);
});


test("pending queue action retries automatically on reconnect focus and visible resume with a mutex",async()=>{
  const queue=await read("app/queue/page.tsx");
  assert.match(queue,/queueRecoveryRef=useRef\(false\)/);
  assert.match(queue,/if\(disposed\|\|queueRecoveryRef\.current\)return/);
  assert.match(queue,/queueRecoveryRef\.current=true/);
  assert.match(queue,/queueRecoveryRef\.current=false/);
  assert.match(queue,/window\.addEventListener\("online",onOnline\)/);
  assert.match(queue,/window\.addEventListener\("focus",onFocus\)/);
  assert.match(queue,/document\.addEventListener\("visibilitychange",onVisible\)/);
  assert.match(queue,/document\.visibilityState==="visible"/);
  assert.match(queue,/sendQueueAction\(pending\.body\)/);
});
