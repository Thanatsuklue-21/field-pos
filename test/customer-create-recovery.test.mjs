import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import ts from "typescript";

const source=await readFile(new URL("../lib/customer-create-recovery.ts",import.meta.url),"utf8");
const exports={};
runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,encodeURIComponent,JSON,Number,Error,Date,Math});

class MemoryStorage{
  constructor(){this.map=new Map()}
  getItem(key){return this.map.has(key)?this.map.get(key):null}
  setItem(key,value){this.map.set(key,String(value))}
  removeItem(key){this.map.delete(key)}
}
const body=(extra={})=>({requestKey:"customer:req:0001",name:"Somchai",phone:"",lineId:"somchai-line",...extra});

test("customer create intent persists exact identity and blocks a changed customer",()=>{
  const storage=new MemoryStorage(),intent=exports.prepareCustomerCreateIntent("owner",body(),storage);
  assert.deepEqual(JSON.parse(JSON.stringify(exports.readCustomerCreateIntent("owner",storage))),JSON.parse(JSON.stringify(intent)));
  assert.throws(()=>exports.prepareCustomerCreateIntent("owner",body({requestKey:"customer:req:0002",name:"Somying"}),storage),/pending_customer_create_exists/);
});

test("lost customer create response keeps intent and exact replay clears it",async()=>{
  const storage=new MemoryStorage(),intent=exports.prepareCustomerCreateIntent("owner",body(),storage);
  await assert.rejects(()=>exports.sendCustomerCreateIntent(intent,async()=>{throw Object.assign(new Error("network_unavailable"),{status:0})},storage),/network_unavailable/);
  assert.equal(exports.readCustomerCreateIntent("owner",storage).body.requestKey,intent.body.requestKey);
  const seen=[];
  const result=await exports.sendCustomerCreateIntent(intent,async payload=>{
    seen.push(payload);
    return {ok:true,requestKey:payload.requestKey,performedBy:"owner",customer:{id:"cus-1",name:payload.name,phone:payload.phone,lineId:payload.lineId,points:0,visits:0,totalSpend:0,lastVisit:0}};
  },storage);
  assert.equal(result.customer.id,"cus-1");assert.deepEqual(seen,[intent.body]);
  assert.equal(exports.readCustomerCreateIntent("owner",storage),null);
});

test("authoritative customer create rejection clears recovery while inexact ACK stays pending",async()=>{
  const rejectedStore=new MemoryStorage(),rejected=exports.prepareCustomerCreateIntent("owner",body({phone:"0812345678"}),rejectedStore);
  await assert.rejects(()=>exports.sendCustomerCreateIntent(rejected,async()=>{throw Object.assign(new Error("customer_phone_exists"),{status:409})},rejectedStore),/customer_phone_exists/);
  assert.equal(exports.readCustomerCreateIntent("owner",rejectedStore),null);

  const unknownStore=new MemoryStorage(),unknown=exports.prepareCustomerCreateIntent("owner",body(),unknownStore);
  await assert.rejects(()=>exports.sendCustomerCreateIntent(unknown,async()=>({ok:true,requestKey:unknown.body.requestKey,performedBy:"other",customer:{id:"cus-1",name:"Somchai",phone:"",lineId:"somchai-line",points:0,visits:0,totalSpend:0}}),unknownStore),/customer_create_ack_unknown/);
  assert.equal(exports.readCustomerCreateIntent("owner",unknownStore).body.requestKey,unknown.body.requestKey);
});

test("customer UI persists create before send and recovers the exact request on reconnect",async()=>{
  const ui=await readFile(new URL("../app/customers/page.tsx",import.meta.url),"utf8");
  assert.match(ui,/prepareCustomerCreateIntent/);
  assert.match(ui,/sendCustomerCreateIntent/);
  assert.match(ui,/readCustomerCreateIntent/);
  assert.match(ui,/requestKey:crypto\.randomUUID\(\),name:name\.trim\(\),phone:phone\.trim\(\),lineId:lineId\.trim\(\)/);
  assert.match(ui,/window\.addEventListener\("online",recover\)/);
  assert.match(ui,/ข้อมูลถูกล็อกเพื่อป้องกัน Customer ID ซ้ำ/);
  assert.match(ui,/ห้ามสร้างลูกค้าใหม่แทน/);
  const add=ui.slice(ui.indexOf("async function add()"),ui.indexOf("async function points(",ui.indexOf("async function add()")));
  const prepared=add.indexOf("prepareCustomerCreateIntent");
  const persisted=add.indexOf("setPendingCustomerCreate(intent)",prepared);
  const sent=add.indexOf("await submitCustomerCreate(intent,false)",persisted);
  assert.ok(prepared>=0&&persisted>prepared&&sent>persisted);
  assert.doesNotMatch(add,/api\("\/api\/customers"/);
});
