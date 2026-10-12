import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import ts from "typescript";
const source=ts.transpileModule(await readFile(new URL("../components/network-status.tsx",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function indicator(){
  let status="online";const listeners={},exports={},navigator={onLine:true};
  runInNewContext(source,{exports,navigator,window:{addEventListener(type,handler){listeners[type]=handler},removeEventListener(){}},require(path){
    if(path==="react")return {useState:()=>[status,next=>{status=typeof next==="function"?next(status):next}],useEffect:fn=>fn()};
    if(path==="react/jsx-runtime")return {jsx:()=>null,jsxs:()=>null};
    if(path==="lucide-react")return {};throw Error(path);
  }});exports.default();
  return {event(type,next){listeners[type]?.({type,detail:{status:next}})},navigator,get status(){return status}};
}
for(const sync of ["syncing","sync_error"]){
  test(`ordinary API success cannot hide ${sync}`,()=>{
    const ui=indicator();ui.event("field:sync",sync);ui.event("field:network","online");assert.equal(ui.status,sync);
  });
}
test("reconnect retains unresolved sync error until explicit sync success",()=>{
  const ui=indicator();ui.event("field:sync","sync_error");ui.navigator.onLine=false;ui.event("offline");
  assert.equal(ui.status,"offline");ui.navigator.onLine=true;ui.event("online");assert.equal(ui.status,"sync_error");
  ui.event("field:sync","online");assert.equal(ui.status,"online");
});
test("normal cache/offline status still follows network signals without a sync failure",()=>{
  const ui=indicator();ui.event("field:network","cached");assert.equal(ui.status,"cached");
  ui.event("field:network","online");assert.equal(ui.status,"online");
});
