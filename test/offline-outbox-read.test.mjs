import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadBrowserModule} from './helpers/load-browser-module.mjs';
const good={requestKey:'offline-0001',body:{requestKey:'offline-0001',date:'2026-10-13'},createdAt:1,localNo:'OFF-1',status:'pending',attempts:0};

async function driver(t,{rows=[],open='success',read='success'}={}){
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
  let closed=0,transactions=0;
  const request={result:rows};
  const tx={objectStore:()=>({getAll:()=>request})};
  const db={close:()=>{closed++},transaction:()=>{
    transactions++;
    if(read==='throw')throw new DOMException('Denied','SecurityError');
    queueMicrotask(()=>{
      if(read==='error'){request.onerror?.();return}
      if(read==='missing'){tx.oncomplete?.();return}
      request.onsuccess?.();
      if(read==='abort'){tx.onabort?.();return}
      tx.oncomplete?.();
    });
    return tx;
  }};
  const openRequest={result:db};
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:open==='unavailable'?undefined:{open:()=>{
    if(open==='throw')throw new DOMException('Denied','SecurityError');
    queueMicrotask(()=>{if(open==='error')openRequest.onerror?.();else if(open==='blocked')openRequest.onblocked?.();else openRequest.onsuccess?.()});
    return openRequest;
  }}});
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'indexedDB',descriptor);else delete globalThis.indexedDB});
  const module=await loadBrowserModule('lib/offline-db.ts',{id:t.name});
  return {...module,get closed(){return closed},get transactions(){return transactions},lateOpen:()=>openRequest.onsuccess?.()};
}

test('only a completed readable empty outbox returns zero rows',async t=>{
  const db=await driver(t);
  assert.deepEqual(await db.offlineCashList(),[]);
  assert.equal(db.closed,1);
});

test('readable outbox preserves pending and needs-review bills in creation order',async t=>{
  const earlier={...good,createdAt:0,status:'needs_review'};
  const db=await driver(t,{rows:[good,earlier]});
  assert.deepEqual(await db.offlineCashList(),[earlier,good]);
  assert.equal(db.closed,1);
});

for(const open of ['unavailable','throw','error','blocked'])test('POS cannot treat '+open+' IndexedDB as an empty outbox',async t=>{
  const db=await driver(t,{open});
  await assert.rejects(db.offlineCashList(),{message:'offline_storage_unavailable'});
  assert.equal(db.transactions,0);
  if(open==='blocked'){db.lateOpen();assert.equal(db.closed,1)}
});

for(const read of ['error','abort','throw','missing'])test('failed/incomplete outbox read '+read+' rejects and closes the connection',async t=>{
  const db=await driver(t,{rows:[good],read});
  await assert.rejects(db.offlineCashList(),{message:'offline_storage_unavailable'});
  assert.equal(db.closed,1);
});

for(const rows of [null,[{...good,body:{...good.body,requestKey:'different'}}],[{...good,status:'unknown'}],[{...good,body:{...good.body,date:''}}]])test('malformed outbox result '+JSON.stringify(rows)+' fails closed',async t=>{
  const db=await driver(t,{rows});
  await assert.rejects(db.offlineCashList(),{message:'offline_storage_unavailable'});
  assert.equal(db.closed,1);
});

test('POS validates existing offline bills before capturing another offline sale',async()=>{
  const source=await readFile(new URL('../app/pos/page.tsx',import.meta.url),'utf8');
  const start=source.indexOf('if(offlineAtStart)'),end=source.indexOf('if(method==="promptpay")',start);
  const block=source.slice(start,end);
  assert.ok(block.indexOf('await refreshOfflineStats()')>=0);
  assert.ok(block.indexOf('await refreshOfflineStats()')<block.indexOf('queueOfflineCashSale(body)'));
  assert.match(source,/ยังอ่านบิลที่เก็บในเครื่องไม่ได้/);
  assert.match(source,/ห้ามล้างข้อมูลแอปหรือเบราว์เซอร์/);
});

test('unreadable outbox produces neither a zero summary nor sync mutations',async()=>{
  const api=await loadBrowserModule('lib/offline-sales.ts',{
    id:'unreadable-summary-sync',
    replace:source=>source
      .replace(/^import .*api-client.*;$/m,'export const mutations=[]; const api=async()=>{mutations.push("checkout");return {}};')
      .replace(/^import .*offline-db.*;$/m,'const offlineCashList=async()=>{throw new Error("offline_storage_unavailable")}; const offlineCashPatch=async()=>mutations.push("patch"); const offlineCashDelete=async()=>mutations.push("delete"); const offlineCashPut=async()=>mutations.push("put");')
  });
  await assert.rejects(api.getOfflineCashSummary(),{message:'offline_storage_unavailable'});
  await assert.rejects(api.syncOfflineCashSales({user:{id:'owner'},csrf:'test'}),{message:'offline_storage_unavailable'});
  assert.deepEqual(api.mutations,[]);
});
