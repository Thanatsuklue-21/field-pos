import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import ts from "typescript";
const source=ts.transpileModule(await readFile(new URL("../lib/offline-sales.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const verified={csrf:"verified-token",user:{id:"operator"}};
function client({status,deleteFails=false,online=true}={}){
  let calls=0;
  const rows=[{requestKey:"persisted-key",status:"pending",attempts:0,body:{requestKey:"persisted-key"}}],exports={};
  runInNewContext(source,{exports,Date,Error,navigator:{onLine:online},require(path){
    if(path==="@/lib/domain/availability.mjs")return {};
    if(path==="@/lib/api-client")return {api:async(path,init)=>{calls++;assert.equal(JSON.parse(init.body).requestKey,"persisted-key");if(status!==undefined)throw Object.assign(new Error("failure-"+status),{status});return {}}};
    if(path==="@/lib/offline-db")return {
      offlineCashList:async()=>rows.map(row=>({...row})),
      offlineCashPatch:async(key,patch)=>Object.assign(rows.find(row=>row.requestKey===key),patch),
      offlineCashDelete:async()=>{if(deleteFails)throw Error("offline_storage_failed");rows.length=0},
    };throw Error(path);
  }});
  return {sync:session=>exports.syncOfflineCashSales(session),rows,get calls(){return calls}};
}
for(const status of [0,401,403,408,425,429,500,503]){
  test(`sync status ${status} keeps bill pending and reports incomplete sync`,async()=>{
    const c=client({status});await assert.rejects(c.sync(verified));
    assert.equal(c.rows.length,1);assert.equal(c.rows[0].status,"pending");
    assert.equal(c.rows[0].lastError,"failure-"+status);
  });
}
test("confirmed business rejection retains a bill for review",async()=>{
  const c=client({status:409}),result=await c.sync(verified);
  assert.equal(result.needsReview,1);assert.equal(result.synced,0);assert.equal(c.rows[0].status,"needs_review");
});
test("server commit followed by local delete failure never reports sync success",async()=>{
  const c=client({deleteFails:true});await assert.rejects(c.sync(verified),/offline_storage_failed/);
  assert.equal(c.rows.length,1);assert.equal(c.calls,1);
});
for(const session of [{...verified,offline:true},{...verified,csrf:""}]){
  test(`unverified session cannot sync (${session.offline?"offline":"missing csrf"})`,async()=>{
    const c=client();await assert.rejects(c.sync(session),/offline_session_revalidation/);assert.equal(c.calls,0);
  });
}
test("offline network reports incomplete sync without sending checkout",async()=>{
  const c=client({online:false});await assert.rejects(c.sync(verified),/offline_write_blocked/);assert.equal(c.calls,0);
});
test("verified successful sync sends original request and deletes only after acceptance",async()=>{
  const c=client(),result=await c.sync(verified);assert.equal(result.synced,1);assert.equal(result.total,0);assert.equal(c.calls,1);
});
