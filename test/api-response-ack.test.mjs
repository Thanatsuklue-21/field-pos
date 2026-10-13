import test from 'node:test';
import assert from 'node:assert/strict';
import {loadBrowserModule} from './helpers/load-browser-module.mjs';
const load=id=>loadBrowserModule('lib/api-client.ts',{id,replace:source=>source.replace(/^import .*offline-db.*;$/m,'const cacheGet=async()=>null; const cachePut=async()=>{};')});
for(const payload of ['', '<html>gateway</html>','null','"ok"','{}','[]','{"ok":true}'])test('HTTP success with unreadable/incomplete ACK retains ambiguity: '+JSON.stringify(payload),async t=>{
  const {api}=await load(t.name);
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator});
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(payload,{status:200})});
  await assert.rejects(api('/api/pos/checkout',{method:'POST',body:'{}'}),{message:'network_unavailable',status:0});
  assert.equal(calls,1);
});
test('complete server checkout ACK remains accepted',async t=>{
  const {api}=await load(t.name);
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator});
  const ack={ok:true,orderId:'order-1',saleIds:['sale-1'],queueNo:'A001',total:55,received:100,change:45};
  t.mock.method(globalThis,'fetch',async()=>Response.json(ack));
  assert.deepEqual(await api('/api/pos/checkout',{method:'POST',body:'{}'}),ack);
});
test('non-JSON HTTP error retains its actual status',async t=>{
  const {api}=await load(t.name);
  t.mock.method(globalThis,'fetch',async()=>new Response('Forbidden',{status:403}));
  await assert.rejects(api('/api/expenses'),{status:403});
});
