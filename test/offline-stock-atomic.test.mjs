import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import ts from "typescript";
import * as availability from "../lib/domain/availability.mjs";

const compile=async path=>ts.transpileModule(await readFile(new URL("../"+path,import.meta.url),"utf8"),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
const dbSource=await compile("lib/offline-db.ts"),salesSource=await compile("lib/offline-sales.ts");
const stock=()=>({revision:5,settings:{},menu:[{id:"tea",enabled:true,variants:[{label:"normal",available:true,recipeItems:{milk:2}}]}],availabilityStock:{milk:{qty:6,name:"milk"}}});
const body=key=>({requestKey:key,cart:[{id:"tea",variant:"normal",qty:1}],total:50,received:50});

function device({failure=false,expired=false,missing=false}={}){
  const savedAt=Date.now()-(expired?37*60*60*1000:1000),cache=new Map(),outbox=new Map();
  if(!missing)cache.set("/api/pos/bootstrap",{value:stock(),savedAt});
  let closed=0;
  const indexedDB={open(){
    const request={result:{close(){closed++},transaction(names,mode){
      const scope=Array.isArray(names)?names:[names],staged={cache:new Map(cache),"cash-outbox":new Map(outbox)};
      let aborted=false;
      const tx={error:null,abort(){aborted=true;queueMicrotask(()=>tx.onabort?.())},objectStore(name){
        assert.ok(scope.includes(name));const rows=staged[name];
        return {get(key){const r={result:rows.get(key)};queueMicrotask(()=>r.onsuccess?.());return r},
          getAll(){const r={result:[...rows.values()]};queueMicrotask(()=>r.onsuccess?.());return r},
          put(value,key){if(failure&&name==="cache")throw Error("disk full");rows.set(key??value.requestKey,value)},
          add(value){if(rows.has(value.requestKey))throw Error("ConstraintError");rows.set(value.requestKey,value)},
        };
      }};
      setImmediate(()=>{
        if(aborted)return;
        if(mode==="readwrite"){cache.clear();outbox.clear();for(const [k,v] of staged.cache)cache.set(k,v);for(const [k,v] of staged["cash-outbox"])outbox.set(k,v)}
        tx.oncomplete?.();
      });return tx;
    }}};queueMicrotask(()=>request.onsuccess?.());return request;
  }};
  function modules(){
    const db={},sales={};runInNewContext(dbSource,{exports:db,indexedDB,Date,Error,Promise});
    runInNewContext(salesSource,{exports:sales,Date,Error,require(path){
      if(path==="@/lib/offline-db")return db;
      if(path==="@/lib/api-client")return {};
      if(path==="@/lib/domain/availability.mjs")return availability;
      throw Error(path);
    }});return {db,sales};
  }
  return {modules,cache,outbox,savedAt,get closed(){return closed}};
}

test("receipt commits bill and stock together and cold relaunch sees both",async()=>{
  const d=device();const {sales}=d.modules();
  const receipt=await sales.queueOfflineCashSale(body("bill-key-1"),{projectStock:true});
  assert.equal(receipt.bootstrap.availabilityStock.milk.qty,4);assert.equal(d.outbox.size,1);
  const restarted=d.modules();assert.equal((await restarted.db.cacheGet("/api/pos/bootstrap")).availabilityStock.milk.qty,4);
  assert.equal((await restarted.db.offlineCashList()).length,1);
  assert.equal(d.cache.get("/api/pos/bootstrap").savedAt,d.savedAt);
});
test("failed stock write rolls back the bill and stock and returns no receipt",async()=>{
  const d=device({failure:true});
  await assert.rejects(d.modules().sales.queueOfflineCashSale(body("bill-key-2"),{projectStock:true}),/offline_storage_failed/);
  assert.equal(d.outbox.size,0);assert.equal(d.cache.get("/api/pos/bootstrap").value.availabilityStock.milk.qty,6);
  assert.equal(d.closed,1);
});
test("successive bills use committed local stock and reject overselling",async()=>{
  const d=device(),{sales}=d.modules();
  for(let i=0;i<3;i++)await sales.queueOfflineCashSale(body("bill-seq-"+i),{projectStock:true});
  assert.equal(d.cache.get("/api/pos/bootstrap").value.availabilityStock.milk.qty,0);
  await assert.rejects(sales.queueOfflineCashSale(body("bill-seq-4"),{projectStock:true}),/offline_storage_failed/);
  assert.equal(d.outbox.size,3);
});
for(const options of [{expired:true},{missing:true}]){
  test(`unusable cached catalog blocks receipt (${Object.keys(options)[0]})`,async()=>{
    const d=device(options);
    await assert.rejects(d.modules().sales.queueOfflineCashSale(body("bill-key-3"),{projectStock:true}),/offline_storage_failed/);
    assert.equal(d.outbox.size,0);
  });
}
test("missing recipe/variant cannot create an untracked Offline sale",async()=>{
  const d=device(),b=body("bill-key-4");b.cart[0].variant="missing";
  await assert.rejects(d.modules().sales.queueOfflineCashSale(b,{projectStock:true}),/offline_storage_failed/);
  assert.equal(d.outbox.size,0);
});

test("duplicate request cannot overwrite its bill or deduct stock a second time",async()=>{
  const d=device(),{sales}=d.modules(),b=body("duplicate-key");
  await sales.queueOfflineCashSale(b,{projectStock:true});
  await assert.rejects(sales.queueOfflineCashSale(b,{projectStock:true}),/offline_storage_failed/);
  assert.equal(d.outbox.size,1);assert.equal(d.cache.get("/api/pos/bootstrap").value.availabilityStock.milk.qty,4);
});

test("reconnect cache refresh cannot erase stock consumed by unresolved Offline bills",async()=>{
  const d=device(),{sales,db}=d.modules();
  await sales.queueOfflineCashSale(body("pending-cache-key"),{projectStock:true});
  await db.cachePut("/api/pos/bootstrap",stock());
  assert.equal(d.cache.get("/api/pos/bootstrap").value.availabilityStock.milk.qty,4);
  assert.equal(d.cache.get("/api/pos/bootstrap").savedAt,d.savedAt);
});
test("resolved outbox allows a fresh Cloud catalog to replace local cache",async()=>{
  const d=device(),{db}=d.modules(),fresh=stock();fresh.availabilityStock.milk.qty=20;
  await db.cachePut("/api/pos/bootstrap",fresh);
  assert.equal(d.cache.get("/api/pos/bootstrap").value.availabilityStock.milk.qty,20);
});
