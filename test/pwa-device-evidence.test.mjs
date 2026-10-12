import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import ts from "typescript";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

async function loadStore(){
  const raw=await read("lib/device-uat-evidence.ts");
  const source=ts.transpileModule(raw,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const data=new Map();
  const localStorage={
    getItem:key=>data.has(key)?data.get(key):null,
    setItem:(key,value)=>data.set(key,String(value)),
    removeItem:key=>data.delete(key)
  };
  const exports={};
  runInNewContext(source,{exports,window:{},localStorage,Date});
  return {api:exports,data};
}

test("device UAT evidence requires an exact 40-character build SHA",async()=>{
  const {api,data}=await loadStore();
  assert.equal(api.blankDeviceUatEvidence("abc","phone"),null);
  assert.equal(api.writeDeviceUatCheck("abc","phone","layout_no_overlap",true),null);
  assert.equal(data.size,0);
});

test("device UAT evidence persists checks only for the same build and target class",async()=>{
  const {api}=await loadStore();
  const shaA="a".repeat(40),shaB="b".repeat(40);
  const saved=api.writeDeviceUatCheck(shaA,"phone","keyboard_checkout",true);
  assert.equal(saved.checks.keyboard_checkout,true);
  const firstProgress=api.deviceUatProgress(saved);assert.equal(firstProgress.passed,1);assert.equal(firstProgress.total,5);assert.equal(firstProgress.complete,false);

  const same=api.readDeviceUatEvidence(shaA,"phone");
  assert.equal(same.checks.keyboard_checkout,true);

  const otherBuild=api.readDeviceUatEvidence(shaB,"phone");
  assert.equal(otherBuild.checks.keyboard_checkout,false);
  assert.equal(api.deviceUatProgress(otherBuild).passed,0);

  const otherTarget=api.readDeviceUatEvidence(shaA,"tablet");
  assert.equal(otherTarget.checks.keyboard_checkout,false);
});

test("all five operator confirmations are required for local evidence completion",async()=>{
  const {api}=await loadStore(),sha="c".repeat(40);
  let evidence=api.readDeviceUatEvidence(sha,"tablet");
  for(const id of api.DEVICE_UAT_CHECK_IDS)evidence=api.writeDeviceUatCheck(sha,"tablet",id,true);
  const progress=api.deviceUatProgress(evidence);assert.equal(progress.passed,5);assert.equal(progress.total,5);assert.equal(progress.complete,true);
});

test("device UAT evidence store contains no transaction or identity payload fields",async()=>{
  const source=await read("lib/device-uat-evidence.ts");
  for(const forbidden of ["password","csrf","customerId","paymentReference","requestKey","cart","saleId","orderId"])assert.ok(!source.includes(forbidden),forbidden);
});

test("Preview readiness labels local evidence as operator-confirmed and non-release approval",async()=>{
  const ui=await read("components/pwa-device-uat-evidence.tsx"),readiness=await read("components/pwa-readiness.tsx");
  for(const text of ["DEVICE UAT · LOCAL EVIDENCE","คีย์บอร์ด","Offline","กลับ Online","App update","ไม่ถือว่า Production-ready"])assert.ok(ui.includes(text),text);
  assert.ok(ui.includes("buildSha.slice(0,10)"));
  assert.ok(readiness.includes('build.environment==="preview"&&<PwaDeviceUatEvidence'));
  assert.ok(readiness.includes('targetClass={state?.targetClass||"other"}'));
});
