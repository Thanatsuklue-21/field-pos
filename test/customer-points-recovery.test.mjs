import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import ts from "typescript";

const source=await readFile(new URL("../lib/customer-points-recovery.ts",import.meta.url),"utf8");
const exports={};
runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,encodeURIComponent,JSON,Number,Math,Error,Date});

class MemoryStorage{
  constructor(){this.map=new Map()}
  getItem(key){return this.map.has(key)?this.map.get(key):null}
  setItem(key,value){this.map.set(key,String(value))}
  removeItem(key){this.map.delete(key)}
}
const body=(extra={})=>({requestKey:"points:req:0001",customerId:"cus-1",pointsDelta:1,...extra});

test("customer points intent persists exact customer and blocks a different adjustment",()=>{
  const storage=new MemoryStorage(),intent=exports.prepareCustomerPointsIntent("owner",body(),storage);
  assert.deepEqual(JSON.parse(JSON.stringify(exports.readCustomerPointsIntent("owner",storage))),JSON.parse(JSON.stringify(intent)));
  assert.throws(()=>exports.prepareCustomerPointsIntent("owner",body({requestKey:"points:req:0002",pointsDelta:-1}),storage),/pending_customer_points_exists/);
});

test("ambiguous transport failure retains intent and exact replay clears it",async()=>{
  const storage=new MemoryStorage(),intent=exports.prepareCustomerPointsIntent("owner",body(),storage);
  await assert.rejects(()=>exports.sendCustomerPointsIntent(intent,async()=>{throw Object.assign(new Error("network_unavailable"),{status:0})},storage),/network_unavailable/);
  assert.equal(exports.readCustomerPointsIntent("owner",storage).body.requestKey,intent.body.requestKey);
  const seen=[];
  const result=await exports.sendCustomerPointsIntent(intent,async payload=>{
    seen.push(payload);
    return {ok:true,requestKey:payload.requestKey,performedBy:"owner",customerId:"cus-1",pointsDelta:1,pointsBefore:4,pointsAfter:5,customer:{id:"cus-1",points:5}};
  },storage);
  assert.equal(result.pointsAfter,5);
  assert.deepEqual(seen,[intent.body]);
  assert.equal(exports.readCustomerPointsIntent("owner",storage),null);
});

test("authoritative rejection clears intent but inexact ACK remains recoverable",async()=>{
  const rejectedStore=new MemoryStorage(),rejected=exports.prepareCustomerPointsIntent("owner",body(),rejectedStore);
  await assert.rejects(()=>exports.sendCustomerPointsIntent(rejected,async()=>{throw Object.assign(new Error("customer_not_found"),{status:404})},rejectedStore),/customer_not_found/);
  assert.equal(exports.readCustomerPointsIntent("owner",rejectedStore),null);

  const unknownStore=new MemoryStorage(),unknown=exports.prepareCustomerPointsIntent("owner",body(),unknownStore);
  await assert.rejects(()=>exports.sendCustomerPointsIntent(unknown,async()=>({ok:true,requestKey:unknown.body.requestKey,performedBy:"other",customerId:"cus-1",pointsDelta:1,pointsBefore:4,pointsAfter:5,customer:{id:"cus-1",points:5}}),unknownStore),/customer_points_ack_unknown/);
  assert.equal(exports.readCustomerPointsIntent("owner",unknownStore).body.requestKey,unknown.body.requestKey);
});

test("customer UI routes point changes through persisted recovery and reconnect replay",async()=>{
  const ui=await readFile(new URL("../app/customers/page.tsx",import.meta.url),"utf8");
  assert.match(ui,/prepareCustomerPointsIntent/);
  assert.match(ui,/sendCustomerPointsIntent/);
  assert.match(ui,/readCustomerPointsIntent/);
  assert.match(ui,/requestKey:crypto\.randomUUID\(\),customerId:id,pointsDelta:delta/);
  assert.match(ui,/window\.addEventListener\("online",recover\)/);
  assert.match(ui,/window\.addEventListener\("focus",recover\)/);
  assert.match(ui,/document\.addEventListener\("visibilitychange",visible\)/);
  assert.match(ui,/ห้ามกด \+\/− ซ้ำ/);
  assert.match(ui,/role="status" aria-live="polite" aria-atomic="true"/);
});
