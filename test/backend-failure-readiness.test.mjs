import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import ts from "typescript";
const source=ts.transpileModule(await readFile(new URL("../app/api/[...route]/route.js",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,allowJs:true}}).outputText;
function route({configured=false,unavailable=false}={}){
  const exports={};let initialized=0;
  runInNewContext(source,{exports,Response,process:{env:configured?{TURSO_DATABASE_URL:"file:synthetic",TURSO_AUTH_TOKEN:"synthetic",PUBLIC_ORIGIN:"https://field.test"}:{}},require(path){
    if(path.endsWith("db.mjs"))return {getDb:()=>({}),ensureDbSchema:async()=>{initialized++;if(unavailable)throw Error("internal credential-bearing diagnostic must not leak")}};
    if(path.endsWith("api.mjs"))return {createApi:()=>async(req,res)=>{res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({ok:true}))}};
    throw Error(path);
  }});
  return {get:parts=>exports.GET(new Request("https://field.test/api/"+parts.join("/")),{params:Promise.resolve({route:parts})}),get initialized(){return initialized}};
}
test("DB-backed routes return structured 503 when credentials are absent",async()=>{
  const app=route();const res=await app.get(["auth","session"]);
  assert.equal(res.status,503);assert.equal((await res.json()).error,"turso_not_configured");
  assert.equal(res.headers.get("cache-control"),"no-store");assert.equal(app.initialized,0);
});
test("schema/backend availability failure is controlled and reveals no diagnostics",async()=>{
  const app=route({configured:true,unavailable:true});const res=await app.get(["pos","bootstrap"]);
  assert.equal(res.status,503);assert.equal(await res.text(),'{"error":"turso_unavailable"}');
});
test("build identity remains available independently of database readiness",async()=>{
  const app=route();const res=await app.get(["build"]);assert.equal(res.status,200);assert.equal(app.initialized,0);
});
test("configured backend still delegates normally after initialization",async()=>{
  const app=route({configured:true});const res=await app.get(["pos","bootstrap"]);assert.equal(res.status,200);assert.equal(app.initialized,1);
});
