import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import ts from "typescript";

const source=await readFile(new URL("../lib/navigation-groups.ts",import.meta.url),"utf8");
const exports={};
runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});

const all=[
  "/dashboard","/pos","/queue","/products","/stock","/costs","/expenses","/customers",
  "/recipes","/close","/orders","/reports","/backup","/users","/audit","/settings"
];
const grouped=routes=>exports.splitNavigation(routes.map(path=>[path]));

test("novice shell exposes only daily top-level destinations while preserving every route",()=>{
  const result=grouped(all);
  assert.deepEqual(result.front.map(x=>x[0]),["/pos","/dashboard","/close"]);
  assert.deepEqual(result.operations.map(x=>x[0]),["/queue","/orders","/stock","/expenses"]);
  const reachable=new Set([...result.front,...result.operations,...result.management].map(x=>x[0]));
  assert.deepEqual(reachable,new Set(all));
});

test("technical destinations stay behind store management instead of crowding front counter navigation",()=>{
  const result=grouped(all);
  for(const route of ["/products","/costs","/customers","/recipes","/reports","/backup","/users","/audit","/settings"]){
    assert.ok(result.management.some(x=>x[0]===route),route);
    assert.ok(!result.front.some(x=>x[0]===route),route);
  }
});

test("restricted operator permissions are never expanded by grouping",()=>{
  const input=["/pos","/queue","/orders","/settings"];
  const result=grouped(input);
  const reachable=[...result.front,...result.operations,...result.management].map(x=>x[0]);
  assert.deepEqual(new Set(reachable),new Set(input));
  assert.deepEqual(result.front.map(x=>x[0]),["/pos"]);
  assert.deepEqual(result.operations.map(x=>x[0]),["/queue","/orders"]);
  assert.deepEqual(result.management.map(x=>x[0]),["/settings"]);
});

test("app shell uses one collapsed store-management disclosure on desktop and grouped mobile sections",async()=>{
  const shell=await readFile(new URL("../components/app-shell.tsx",import.meta.url),"utf8");
  assert.match(shell,/splitNavigation\(allowed\)/);
  assert.match(shell,/>จัดการร้าน<\/span>/);
  assert.match(shell,/aria-expanded=\{manageOpen\}/);
  assert.match(shell,/งานประจำวัน/);
  assert.match(shell,/งานหน้าร้าน/);
  assert.match(shell,/ตั้งค่าและหลังบ้าน/);
  assert.match(shell,/grouped\.front\.map/);
  assert.match(shell,/manageOpen&&/);
});
