import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

async function client(t){
  const source=await readFile(new URL('../lib/api-client.ts',import.meta.url),'utf8');
  const code=ts.transpileModule(source.replace(/^import .*offline-db.*;$/m,'const cacheGet=async()=>null; const cachePut=async()=>{};'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
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
  const rejected=assert.rejects(canceled,{message:'network_unavailable'});
  controller.abort();
  pending[1]();
  await rejected;
  assert.deepEqual(await first,{ok:true});
  assert.deepEqual(await second,{ok:true});
});
