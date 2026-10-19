import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

async function client(t,cache='const cacheGet=async()=>null; const cachePut=async()=>{};'){
  const source=await readFile(new URL('../lib/api-client.ts',import.meta.url),'utf8');
  const code=ts.transpileModule(source.replace(/^import .*offline-db.*;$/m,cache),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  return import('data:text/javascript;base64,'+Buffer.from(code+'\n// '+t.name).toString('base64'));
}

test('API preserves Headers and tuple headers including CSRF and explicit content type',async t=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  t.after(()=>Object.defineProperty(globalThis,'navigator',descriptor));
  const {api}=await client(t);
  const seen=[];
  t.mock.method(globalThis,'fetch',async(_path,init)=>{seen.push(init.headers);return Response.json({ok:true})});
  await api('/api/write',{method:'POST',headers:new Headers({'X-CSRF-Token':'csrf','Content-Type':'application/custom'})});
  await api('/api/write',{method:'POST',headers:[['X-CSRF-Token','tuple-csrf']]});
  assert.equal(seen[0].get('X-CSRF-Token'),'csrf');
  assert.equal(seen[0].get('Content-Type'),'application/custom');
  assert.equal(seen[1].get('X-CSRF-Token'),'tuple-csrf');
  assert.equal(seen[1].get('Content-Type'),'application/json');
});

test('canceling one GET does not cancel another caller while ordinary GETs coalesce',async t=>{
  const {api}=await client(t);
  const pending=[];
  t.mock.method(globalThis,'fetch',(_path,init)=>new Promise((resolve,reject)=>{
    pending.push(()=>resolve(Response.json({ok:true})));
    init.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
  }));
  const controller=new AbortController();
  const canceled=api('/api/read',{signal:controller.signal});
  const first=api('/api/read');
  const second=api('/api/read');
  assert.equal(pending.length,2);
  const rejected=assert.rejects(canceled,{name:'AbortError'});
  controller.abort();
  pending[1]();
  await rejected;
  assert.deepEqual(await first,{ok:true});
  assert.deepEqual(await second,{ok:true});
});

test('canceling bootstrap does not return stale cache or emit an offline event',async t=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'window');
  const events=[];
  Object.defineProperty(globalThis,'window',{configurable:true,value:{dispatchEvent:event=>events.push(event)}});
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'window',descriptor);else delete globalThis.window});
  const {api}=await client(t,'const cacheGet=async()=>({stale:true}); const cachePut=async()=>{};');
  const controller=new AbortController();
  t.mock.method(globalThis,'fetch',async()=>{controller.abort();throw controller.signal.reason});
  await assert.rejects(api('/api/pos/bootstrap',{signal:controller.signal}),{name:'AbortError'});
  assert.deepEqual(events,[]);
});

test('GET timeout includes reading a stalled JSON response body',async t=>{
  const {api}=await client(t);
  t.mock.timers.enable({apis:['setTimeout']});
  let bodyStarted;
  const started=new Promise(resolve=>{bodyStarted=resolve});
  t.mock.method(globalThis,'fetch',async(_path,init)=>({
    json:()=>new Promise((_resolve,reject)=>{
      init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
      bodyStarted();
    }),
    ok:true,status:200,
  }));
  const request=api('/api/read');
  const rejected=assert.rejects(request,{message:'network_unavailable',status:0});
  await started;
  t.mock.timers.tick(8000);
  await rejected;
});

test('unavailable IndexedDB preserves the network error instead of leaking a storage error',async t=>{
  const {api}=await client(t,'const cacheGet=async()=>{throw new Error("storage_denied")}; const cachePut=async()=>{};');
  t.mock.method(globalThis,'fetch',async()=>{throw new TypeError('fetch failed')});
  await assert.rejects(api('/api/pos/bootstrap'),error=>error.message==='network_unavailable'&&error.status===0&&error.cause.message==='fetch failed');
});


test('preloading safe bootstrap coalesces with the first POS bootstrap read',async t=>{
  const {api,preloadSafeGet}=await client(t);
  const pending=[];
  t.mock.method(globalThis,'fetch',(_path)=>new Promise(resolve=>pending.push(()=>resolve(Response.json({revision:1,menu:[],availabilityStock:{},settings:{}})))));
  const preload=preloadSafeGet('/api/pos/bootstrap');
  const read=api('/api/pos/bootstrap');
  assert.equal(pending.length,1);
  pending[0]();
  await preload;
  assert.equal((await read).revision,1);
});
