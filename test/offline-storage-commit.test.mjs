import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import ts from "typescript";

const source=ts.transpileModule(await readFile(new URL("../lib/offline-db.ts",import.meta.url),"utf8"),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;

function storage(mode="complete"){
  let closed=0,committed=false;
  const record={requestKey:"cash-key-123",createdAt:1,status:"pending",attempts:0,body:{},localNo:"OFF-1"};
  const db={close(){closed++},transaction(){
    const tx={error:new Error("disk failure"),objectStore(){return {
      put(){if(mode==="throw")throw Error("quota");return {}},delete(){return {}},
      get(){const request={result:record};queueMicrotask(()=>request.onsuccess?.());return request},
      getAll(){const request={result:[record]};queueMicrotask(()=>request.onsuccess?.());return request},
    }},abort(){queueMicrotask(()=>tx.onabort?.())}};
    setImmediate(()=>{if(mode==="complete"){committed=true;tx.oncomplete?.()}else if(mode!=="throw")tx[mode==="error"?"onerror":"onabort"]?.()});
    return tx;
  }};
  const indexedDB=mode==="unavailable"?undefined:{open(){if(mode==="open-throw")throw Error("blocked storage");const request={result:db};queueMicrotask(()=>request.onsuccess?.());return request}};
  const exports={};runInNewContext(source,{exports,indexedDB,Error,Date,Promise});
  return {api:exports,record,get closed(){return closed},get committed(){return committed}};
}

test("offline cash is acknowledged only after transaction commit",async()=>{
  const store=storage();const saving=store.api.offlineCashPut(store.record);
  await new Promise(resolve=>queueMicrotask(resolve));assert.equal(store.committed,false);
  await saving;assert.equal(store.committed,true);assert.equal(store.closed,1);
});

for(const mode of ["abort","error","throw"]){
  test(`offline cash ${mode} rejects instead of reporting a saved bill`,async()=>{
    const store=storage(mode);
    await assert.rejects(store.api.offlineCashPut(store.record),/offline_storage_failed/);
    assert.equal(store.committed,false);assert.equal(store.closed,1);
  });
}

for(const operation of ["offlineCashList","offlineCashDelete","offlineCashPatch"]){
  test(`${operation} fails closed when storage is unavailable`,async()=>{
    const store=storage("unavailable");
    await assert.rejects(store.api[operation](store.record.requestKey,{}),/offline_storage_unavailable/);
  });
  test(`${operation} rejects an aborted transaction and closes the connection`,async()=>{
    const store=storage("abort");
    await assert.rejects(store.api[operation](store.record.requestKey,{}),/offline_storage_failed/);
    assert.equal(store.closed,1);
  });
}

test("storage diagnostics never report READY for an aborted read transaction",async()=>{
  const store=storage("abort");
  await assert.rejects(store.api.clientStorageStatus(),/offline_storage_failed/);
  assert.equal(store.closed,1);
});

test("synchronous database open failure is reported as unavailable storage",async()=>{
  const store=storage("open-throw");
  await assert.rejects(store.api.offlineCashPut(store.record),/offline_storage_unavailable/);
  assert.equal((await store.api.clientStorageStatus()).indexedDbReady,false);
});

for(const operation of ["offlineCashList","offlineCashDelete","offlineCashPatch"]){
  test(`${operation} succeeds after commit and releases the connection`,async()=>{
    const store=storage();
    const result=await store.api[operation](store.record.requestKey,{attempts:1});
    assert.equal(store.committed,true);assert.equal(store.closed,1);
    if(operation==="offlineCashList")assert.equal(result[0].requestKey,store.record.requestKey);
  });
}

test("cache writes also reject aborted commits and close their connection",async()=>{
  const store=storage("abort");
  await assert.rejects(store.api.cachePut("/api/pos/bootstrap",{}),/offline_storage_failed/);
  assert.equal(store.closed,1);
});

test("readiness counts pending bills only after a completed read transaction",async()=>{
  const store=storage();const status=await store.api.clientStorageStatus();
  assert.equal(status.indexedDbReady,true);assert.equal(status.outboxPending,1);
  assert.equal(store.committed,true);assert.equal(store.closed,1);
});

const salesSource=ts.transpileModule(await readFile(new URL("../lib/offline-sales.ts",import.meta.url),"utf8"),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
for(const mode of ["complete","abort","throw"]){
  test(`offline checkout receipt waits for durable outbox result (${mode})`,async()=>{
    const store=storage(mode),exports={};
    runInNewContext(salesSource,{exports,Date,Error,require(path){
      if(path==="@/lib/offline-db")return store.api;
      if(path==="@/lib/api-client")return {};
      if(path==="@/lib/domain/availability.mjs")return {};
      throw Error("unexpected import: "+path);
    }});
    const checkout=exports.queueOfflineCashSale({requestKey:store.record.requestKey});
    if(mode==="complete"){
      const receipt=await checkout;
      assert.equal(store.committed,true);assert.equal(receipt.requestKey,store.record.requestKey);
    }else await assert.rejects(checkout,/offline_storage_failed/);
  });
}
