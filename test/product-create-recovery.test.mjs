import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import ts from "typescript";

const source=await readFile(new URL("../lib/product-create-recovery.ts",import.meta.url),"utf8");
const exports={};
runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,encodeURIComponent,JSON,Number,Error,Date,Math});

class MemoryStorage{
  constructor(){this.map=new Map()}
  getItem(key){return this.map.has(key)?this.map.get(key):null}
  setItem(key,value){this.map.set(key,String(value))}
  removeItem(key){this.map.delete(key)}
}
const image="data:image/jpeg;base64,/9j/2Q==";
const body=(extra={})=>({requestKey:"product:req:0001",name:"Matcha Latte",category:"OTHER",prepBaseId:"MATCHA",price:90,imageDataUrl:image,...extra});

test("product create intent persists image and blocks changed create while unresolved",()=>{
  const storage=new MemoryStorage(),intent=exports.prepareProductCreateIntent("owner",body(),storage);
  assert.deepEqual(JSON.parse(JSON.stringify(exports.readProductCreateIntent("owner",storage))),JSON.parse(JSON.stringify(intent)));
  assert.equal(exports.readProductCreateIntent("owner",storage).body.imageDataUrl,image);
  assert.throws(()=>exports.prepareProductCreateIntent("owner",body({requestKey:"product:req:0002",price:95}),storage),/pending_product_create_exists/);
});

test("lost product create response keeps intent and exact replay clears it",async()=>{
  const storage=new MemoryStorage(),intent=exports.prepareProductCreateIntent("owner",body(),storage);
  await assert.rejects(()=>exports.sendProductCreateIntent(intent,async()=>{throw Object.assign(new Error("network_unavailable"),{status:0})},storage),/network_unavailable/);
  assert.equal(exports.readProductCreateIntent("owner",storage).body.requestKey,intent.body.requestKey);
  const seen=[];
  const result=await exports.sendProductCreateIntent(intent,async payload=>{
    seen.push(payload);
    return {ok:true,requestKey:payload.requestKey,performedBy:"owner",product:{id:"menu-1",name:payload.name,category:payload.category,prepBaseId:payload.prepBaseId,price:payload.price,enabled:false,image:"/api/menu-images/menu-1?v=1"}};
  },storage);
  assert.equal(result.product.id,"menu-1");assert.deepEqual(seen,[intent.body]);assert.equal(exports.readProductCreateIntent("owner",storage),null);
});

test("authoritative product validation clears recovery but inexact ACK does not",async()=>{
  const rejectedStore=new MemoryStorage(),rejected=exports.prepareProductCreateIntent("owner",body(),rejectedStore);
  await assert.rejects(()=>exports.sendProductCreateIntent(rejected,async()=>{throw Object.assign(new Error("invalid_product"),{status:400})},rejectedStore),/invalid_product/);
  assert.equal(exports.readProductCreateIntent("owner",rejectedStore),null);

  const unknownStore=new MemoryStorage(),unknown=exports.prepareProductCreateIntent("owner",body(),unknownStore);
  await assert.rejects(()=>exports.sendProductCreateIntent(unknown,async()=>({ok:true,requestKey:unknown.body.requestKey,performedBy:"other",product:{id:"menu-1",name:"Matcha Latte",category:"OTHER",prepBaseId:"MATCHA",price:90,enabled:false,image:"/api/menu-images/menu-1?v=1"}}),unknownStore),/product_create_ack_unknown/);
  assert.equal(exports.readProductCreateIntent("owner",unknownStore).body.requestKey,unknown.body.requestKey);
});

test("product UI persists new Product and image before send and recovers on reconnect",async()=>{
  const ui=await readFile(new URL("../app/products/page.tsx",import.meta.url),"utf8");
  assert.match(ui,/prepareProductCreateIntent/);
  assert.match(ui,/sendProductCreateIntent/);
  assert.match(ui,/readProductCreateIntent/);
  assert.match(ui,/imageDataUrl:pendingImage\|\|""/);
  assert.match(ui,/window\.addEventListener\("online",recover\)/);
  assert.match(ui,/window\.addEventListener\("focus",recover\)/);
  assert.match(ui,/document\.addEventListener\("visibilitychange",visible\)/);
  assert.match(ui,/role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(ui,/ข้อมูลถูกล็อกเพื่อป้องกันการสร้าง Product ID ซ้ำ/);
  const create=ui.slice(ui.indexOf("if(!edit.id){"),ui.indexOf("setBusy(true);setMsg",ui.indexOf("if(!edit.id){")));
  const prepared=create.indexOf("prepareProductCreateIntent");
  const persisted=create.indexOf("setPendingProductCreate(intent)",prepared);
  const sent=create.indexOf("await submitProductIntent(intent,false)",persisted);
  assert.ok(prepared>=0&&persisted>prepared&&sent>persisted);
  assert.doesNotMatch(create,/api\("\/api\/admin\/products"/);
});
