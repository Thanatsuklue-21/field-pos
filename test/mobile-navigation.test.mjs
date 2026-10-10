import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import ts from "typescript";
const exports={};
runInNewContext(ts.transpileModule(await readFile(new URL("../lib/mobile-navigation.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
const more=routes=>Array.from(exports.mobileOverflow(routes.map(path=>[path])),row=>row[0]);
const primary=["/pos","/queue","/orders","/stock"];
const all=["/dashboard",...primary,"/products","/costs","/expenses","/customers","/recipes","/close","/reports","/backup","/users","/audit","/settings"];
test("every permitted admin destination is reachable on a phone",()=>{
  const overflow=more(all);
  assert.deepEqual(new Set([...primary,...overflow]),new Set(all));
  assert.equal(overflow.length,all.length-primary.length);
});
test("operational overflow actions retain priority before administration",()=>{
  assert.deepEqual(more(all).slice(0,3),["/expenses","/close","/settings"]);
});
test("restricted staff menu never gains admin destinations",()=>{
  assert.deepEqual(more(["/pos","/queue","/settings"]),["/settings"]);
});
test("offline operator can reach only the permitted safe overflow",()=>{
  assert.deepEqual(more(["/pos","/settings"]),["/settings"]);
});
test("no session and primary-only permissions do not invent menu actions",()=>{
  assert.deepEqual(more([]),[]);assert.deepEqual(more(primary),[]);
});
test("building mobile destinations leaves permission-filtered input intact",()=>{
  const input=Object.freeze(all.map(path=>Object.freeze([path]))),before=JSON.stringify(input);
  exports.mobileOverflow(input);assert.equal(JSON.stringify(input),before);
});
