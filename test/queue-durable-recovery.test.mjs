import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import ts from "typescript";

const source=await readFile(new URL("../lib/queue-action-recovery.ts",import.meta.url),"utf8");
const exports={};
runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,encodeURIComponent,decodeURIComponent,JSON,Number,Set,Error,Date});

class MemoryStorage{
  constructor(){this.map=new Map()}
  getItem(key){return this.map.has(key)?this.map.get(key):null}
  setItem(key,value){this.map.set(key,String(value))}
  removeItem(key){this.map.delete(key)}
  key(index){return [...this.map.keys()][index]??null}
  get length(){return this.map.size}
}
const body=(extra={})=>({requestKey:"queue:req:0001",orderId:"order-1",action:"complete_item",itemIndex:0,expectedReadyQty:0,...extra});

test("queue intent persists exact action and blocks a different action until resolved",()=>{
  const storage=new MemoryStorage();
  const intent=exports.prepareQueueActionIntent("staff-1",body(),storage);
  assert.deepEqual(JSON.parse(JSON.stringify(exports.readQueueActionIntent("staff-1",storage))),JSON.parse(JSON.stringify(intent)));
  assert.throws(()=>exports.prepareQueueActionIntent("staff-1",body({requestKey:"queue:req:0002",action:"call",itemIndex:undefined,expectedReadyQty:undefined}),storage),/pending_queue_action_exists/);
});

test("ambiguous transport failure retains queue intent for exact replay",async()=>{
  const storage=new MemoryStorage(),intent=exports.prepareQueueActionIntent("staff-1",body(),storage);
  await assert.rejects(()=>exports.sendQueueActionIntent(intent,async()=>{throw Object.assign(new Error("network_unavailable"),{status:0})},storage),/network_unavailable/);
  assert.equal(exports.readQueueActionIntent("staff-1",storage).body.requestKey,intent.body.requestKey);
  const seen=[];
  const result=await exports.sendQueueActionIntent(intent,async payload=>{
    seen.push(payload);
    return {ok:true,requestKey:payload.requestKey,performedBy:"staff-1",orderId:payload.orderId,action:payload.action,revision:7,orders:[]};
  },storage);
  assert.equal(result.revision,7);
  assert.deepEqual(seen,[intent.body]);
  assert.equal(exports.readQueueActionIntent("staff-1",storage),null);
});

test("pre-commit business rejection clears intent but unknown ACK does not",async()=>{
  const rejectedStore=new MemoryStorage(),rejected=exports.prepareQueueActionIntent("staff-1",body(),rejectedStore);
  await assert.rejects(()=>exports.sendQueueActionIntent(rejected,async()=>{throw Object.assign(new Error("queue_state_changed"),{status:409})},rejectedStore),/queue_state_changed/);
  assert.equal(exports.readQueueActionIntent("staff-1",rejectedStore),null);

  const unknownStore=new MemoryStorage(),unknown=exports.prepareQueueActionIntent("staff-1",body(),unknownStore);
  await assert.rejects(()=>exports.sendQueueActionIntent(unknown,async()=>({ok:true,requestKey:unknown.body.requestKey,performedBy:"other",orderId:"order-1",action:"complete_item",revision:8,orders:[]}),unknownStore),/queue_action_ack_unknown/);
  assert.equal(exports.readQueueActionIntent("staff-1",unknownStore).body.requestKey,unknown.body.requestKey);
});

test("queue UI routes every operator mutation through durable recovery and reconnect replay",async()=>{
  const ui=await readFile(new URL("../app/queue/page.tsx",import.meta.url),"utf8");
  assert.match(ui,/prepareQueueActionIntent/);
  assert.match(ui,/sendQueueActionIntent/);
  assert.match(ui,/readQueueActionIntent/);
  assert.match(ui,/controller\.abort\(\),20_000/);
  assert.match(ui,/window\.addEventListener\("online",recover\)/);
  assert.match(ui,/window\.addEventListener\("focus",recover\)/);
  assert.match(ui,/document\.addEventListener\("visibilitychange",visible\)/);
  for(const action of ["complete_item","waste_remake","call","call_item","return"]){
    assert.match(ui,new RegExp('postQueueAction\\(\\{requestKey:crypto\\.randomUUID\\(\\)[\\s\\S]{0,140}action:"'+action+'"'));
  }
  assert.match(ui,/ไม่ต้องกดปุ่มเดิมซ้ำ/);
  assert.match(ui,/ตรวจรายการเดิม/);
});

test("server queue acknowledgement echoes durable request identity before replay storage",async()=>{
  const pos=await readFile(new URL("../lib/pos-api.mjs",import.meta.url),"utf8");
  const start=pos.indexOf("export async function queuePosAction");
  const block=pos.slice(start,pos.indexOf("\nexport ",start+40)>0?pos.indexOf("\nexport ",start+40):undefined);
  assert.match(block,/const old=await replay\(tx,doc,body\.requestKey,context\)/);
  assert.match(block,/requestKey:body\.requestKey/);
  assert.match(block,/performedBy:user\.id/);
  assert.match(block,/rememberStatement\(doc,body\.requestKey,response,context,now\)/);
});
