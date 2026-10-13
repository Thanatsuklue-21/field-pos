import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {IDBFactory,IDBDatabase,IDBObjectStore} from 'fake-indexeddb';

async function storage(t){
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:new IDBFactory()});
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'indexedDB',descriptor);else delete globalThis.indexedDB});
  const source=await readFile(new URL('../lib/offline-db.ts',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  return import('data:text/javascript;base64,'+Buffer.from(code+'\n// '+t.name).toString('base64'));
}
const record={requestKey:'offline-request-1',body:{requestKey:'offline-request-1',date:'2026-10-13',total:50},createdAt:1,localNo:'OFF-1',status:'pending',attempts:0};

test('offline outbox persists, patches and deletes only completed writes',async t=>{
  const db=await storage(t);
  await db.offlineCashPut(record);
  assert.deepEqual(await db.offlineCashList(),[record]);
  await db.offlineCashPatch(record.requestKey,{attempts:1,status:'needs_review'});
  assert.equal((await db.offlineCashList())[0].attempts,1);
  await db.offlineCashDelete(record.requestKey);
  assert.deepEqual(await db.offlineCashList(),[]);
});

for(const operation of ['put','patch','delete'])test('aborted offline '+operation+' rejects and preserves the previous outbox',async t=>{
  const db=await storage(t);
  if(operation!=='put')await db.offlineCashPut(record);
  const original=IDBDatabase.prototype.transaction;
  const close=IDBDatabase.prototype.close;
  let closed=0;
  t.mock.method(IDBDatabase.prototype,'close',function(){closed++;return close.call(this)});
  const mocked=t.mock.method(IDBDatabase.prototype,'transaction',function(...args){
    const tx=original.apply(this,args);
    if(args[1]==='readwrite')queueMicrotask(()=>tx.abort());
    return tx;
  });
  const write=operation==='put'?db.offlineCashPut(record):operation==='patch'?db.offlineCashPatch(record.requestKey,{attempts:1}):db.offlineCashDelete(record.requestKey);
  await assert.rejects(write,{message:'offline_storage_write_failed'});
  assert.equal(closed,1);
  mocked.mock.restore();
  assert.deepEqual(await db.offlineCashList(),operation==='put'?[]:[record]);
});

test('synchronous quota failure rejects and closes the offline database',async t=>{
  const db=await storage(t);
  const quota=new DOMException('Quota exceeded','QuotaExceededError');
  t.mock.method(IDBObjectStore.prototype,'put',()=>{throw quota});
  await assert.rejects(db.offlineCashPut(record),error=>error.message==='offline_storage_write_failed'&&error.cause===quota);
  assert.deepEqual(await db.offlineCashList(),[]);
});
