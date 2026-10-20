import test from 'node:test';
import assert from 'node:assert/strict';
import {loadBrowserModule} from './helpers/load-browser-module.mjs';

const body={requestKey:'offline-ack-001',payment:'cash',total:0.1,received:0.3,offlineFulfilled:true};
const valid={ok:true,orderId:'order-1',saleIds:['sale-1'],queueNo:'A001',total:0.1,received:0.3,change:0.2,offlineFulfilled:true,pager:0};
async function setup(t,response){
  const navigatorDescriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  t.after(()=>{if(navigatorDescriptor)Object.defineProperty(globalThis,'navigator',navigatorDescriptor);else delete globalThis.navigator});
  const driver={rows:[{requestKey:body.requestKey,body:{...body},status:'pending',attempts:0}],sent:[],deleted:[],response};
  const id='__offlineAck_'+t.name.replace(/\W/g,'_');globalThis[id]=driver;t.after(()=>delete globalThis[id]);
  const module=await loadBrowserModule('lib/offline-sales.ts',{id:t.name,replace:source=>source
      .replace(/^import .*availability.mjs.*;$/m,'const cartAvailability=()=>{throw new Error("unexpected_capture")};')
    .replace(/^import .*api-client.*;$/m,`const d=globalThis[${JSON.stringify(id)}]; const api=async(path,init)=>{d.sent.push(JSON.parse(init.body));if(d.response instanceof Error)throw d.response;return d.response};`)
    .replace(/^import .*offline-db.*;$/m,'const offlineCashList=async()=>d.rows; const offlineCashPatch=async(key,patch)=>Object.assign(d.rows.find(x=>x.requestKey===key),patch); const offlineCashDelete=async key=>{d.deleted.push(key);d.rows=d.rows.filter(x=>x.requestKey!==key)}; const offlineCashPut=async()=>{};')
    .replace(/from "@\/lib\/domain\/money.mjs"/,`from ${JSON.stringify(new URL('../lib/domain/money.mjs',import.meta.url).href)}`)
  });
  return {driver,...module};
}
for(const [name,response] of Object.entries({empty:{},notOk:{...valid,ok:false},wrongTotal:{...valid,total:0.2},wrongReceived:{...valid,received:0.4},wrongChange:{...valid,change:0.3},notFulfilled:{...valid,offlineFulfilled:false},liveQueue:{...valid,pager:1},noOrder:{...valid,orderId:''},noSale:{...valid,saleIds:[]},invalidAmount:{...valid,total:'0.1'}})){
  test('offline sync retains the original bill on '+name+' ACK',async t=>{
    const api=await setup(t,response),result=await api.syncOfflineCashSales({csrf:'test'});
    assert.equal(result.synced,0);assert.equal(result.pending,1);assert.deepEqual(api.driver.deleted,[]);
    assert.equal(api.driver.rows[0].requestKey,body.requestKey);assert.equal(api.driver.rows[0].status,'pending');
    api.driver.response=valid;
    const replay=await api.syncOfflineCashSales({csrf:'test'});
    assert.equal(replay.synced,1);assert.equal(replay.pending,0);
    assert.deepEqual(api.driver.sent,[body,body]);
  });
}

for(const status of [401,403,408,425,429])test('transient/auth '+status+' keeps offline bill pending for exact replay',async t=>{
  const api=await setup(t,Object.assign(new Error('session_or_retry_required'),{status}));
  const result=await api.syncOfflineCashSales({csrf:'test'});
  assert.equal(result.pending,1);assert.equal(result.needsReview,0);assert.equal(api.driver.deleted.length,0);
  api.driver.response=valid;assert.equal((await api.syncOfflineCashSales({csrf:'fresh-session'})).synced,1);
  assert.deepEqual(api.driver.sent,[body,body]);
});
