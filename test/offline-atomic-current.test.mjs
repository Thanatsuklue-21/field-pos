import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {IDBFactory,IDBObjectStore} from 'fake-indexeddb';
import * as money from '../lib/domain/money.mjs';
import * as availability from '../lib/domain/availability.mjs';

const compile=async file=>ts.transpileModule(await readFile(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const dbCode=await compile('lib/offline-db.ts'),salesCode=await compile('lib/offline-sales.ts');
const catalog=()=>({revision:5,settings:{},menu:[{id:'tea',name:'Tea',price:50,enabled:true,variants:[{label:'normal',available:true,recipeItems:{milk:2}}]}],availabilityStock:{milk:{qty:6,name:'Milk'}}});
const body=key=>({requestKey:key,date:'2026-10-19',cart:[{id:'tea',variant:'normal',qty:1}],total:50,received:50,offlineFulfilled:true});
function device(){
  const indexedDB=new IDBFactory();
  function restart(){
    const db={},sales={};
    runInNewContext(dbCode,{exports:db,indexedDB,Date,Error,Promise,DOMException});
    runInNewContext(salesCode,{exports:sales,Date,Error,Promise,require(path){
      if(path==='@/lib/offline-db')return db;
      if(path==='@/lib/api-client')return {};
      if(path==='@/lib/domain/money.mjs')return money;
      if(path==='@/lib/domain/availability.mjs')return availability;
      throw Error(path);
    }});
    return {db,sales};
  }
  return {restart};
}
test('atomic offline receipt survives cold module restart with its stock deduction',async()=>{
  const d=device(),{db,sales}=d.restart();await db.cachePut('/api/pos/bootstrap',catalog());
  const result=await sales.queueOfflineCashSale(body('atomic-bill-001'),{projectStock:true});
  assert.equal(result.bootstrap.availabilityStock.milk.qty,4);
  const restarted=d.restart();assert.equal((await restarted.db.cacheGet('/api/pos/bootstrap')).availabilityStock.milk.qty,4);
  assert.equal((await restarted.db.offlineCashList()).length,1);
});
test('stock-cache write failure rolls back the outbox bill and returns no receipt',async t=>{
  const {db,sales}=device().restart();await db.cachePut('/api/pos/bootstrap',catalog());
  const put=IDBObjectStore.prototype.put;
  const mock=t.mock.method(IDBObjectStore.prototype,'put',function(...args){if(this.name==='cache')throw new DOMException('Full','QuotaExceededError');return put.apply(this,args)});
  await assert.rejects(sales.queueOfflineCashSale(body('atomic-bill-002'),{projectStock:true}));mock.mock.restore();
  assert.equal((await db.offlineCashList()).length,0);assert.equal((await db.cacheGet('/api/pos/bootstrap')).availabilityStock.milk.qty,6);
});
test('concurrent offline captures use committed stock and cannot oversell',async()=>{
  const {db,sales}=device().restart();await db.cachePut('/api/pos/bootstrap',catalog());
  const results=await Promise.allSettled(Array.from({length:4},(_,i)=>sales.queueOfflineCashSale(body('atomic-concurrent-'+i),{projectStock:true})));
  assert.equal(results.filter(x=>x.status==='fulfilled').length,3);
  assert.equal((await db.offlineCashList()).length,3);assert.equal((await db.cacheGet('/api/pos/bootstrap')).availabilityStock.milk.qty,0);
});
test('duplicate request cannot replace a bill or deduct local stock twice',async()=>{
  const {db,sales}=device().restart();await db.cachePut('/api/pos/bootstrap',catalog());
  await sales.queueOfflineCashSale(body('atomic-duplicate'),{projectStock:true});
  await assert.rejects(sales.queueOfflineCashSale(body('atomic-duplicate'),{projectStock:true}));
  assert.equal((await db.offlineCashList()).length,1);assert.equal((await db.cacheGet('/api/pos/bootstrap')).availabilityStock.milk.qty,4);
});
test('pending offline debt blocks stale cloud cache replacement',async()=>{
  const {db,sales}=device().restart();await db.cachePut('/api/pos/bootstrap',catalog());
  await sales.queueOfflineCashSale(body('atomic-cloud-refresh'),{projectStock:true});
  await db.cachePut('/api/pos/bootstrap',catalog());
  assert.equal((await db.cacheGet('/api/pos/bootstrap')).availabilityStock.milk.qty,4);
  await db.offlineCashDelete('atomic-cloud-refresh');await db.cachePut('/api/pos/bootstrap',catalog());
  assert.equal((await db.cacheGet('/api/pos/bootstrap')).availabilityStock.milk.qty,6);
});
for(const invalid of ['missing','expired','variant','fractional','price'])test('atomic capture rejects '+invalid+' catalog/cart without saving a bill',async()=>{
  const {db,sales}=device().restart(),c=catalog(),b=body('atomic-invalid-'+invalid);
  if(invalid==='variant')b.cart[0].variant='unknown';
  if(invalid==='fractional')b.cart[0].qty=0.5;
  if(invalid==='price')b.total=49;
  if(invalid!=='missing')await db.cachePut('/api/pos/bootstrap',c);
  const originalNow=Date.now;
  try{if(invalid==='expired')Date.now=()=>originalNow()+25*60*60*1000;await assert.rejects(sales.queueOfflineCashSale(b,{projectStock:true}));}
  finally{Date.now=originalNow}
  assert.equal((await db.offlineCashList()).length,0);
});
