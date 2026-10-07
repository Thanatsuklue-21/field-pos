import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm,readFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

const root=fileURLToPath(new URL("../",import.meta.url));
const script=join(root,"scripts/vercel-ignore-build.sh");

function run(ref,cwd=root){
  return spawnSync("bash",[script],{cwd,env:{...process.env,VERCEL_GIT_COMMIT_REF:ref},encoding:"utf8"});
}

test("Vercel ignore gate always builds main",()=>{
  assert.equal(run("main").status,1);
});

test("Vercel ignore gate skips ordinary feature commits",()=>{
  assert.equal(run("feat/pwa-app-shell").status,0);
  assert.equal(run("feat/other-work").status,0);
});

test("Vercel ignore gate allows the frozen PWA branch only with release marker",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"field-vercel-gate-"));
  try{
    assert.equal(run("feat/pwa-app-shell",dir).status,0);
    await writeFile(join(dir,".vercel-preview-release"),"FIELD PWA release preview\n");
    assert.equal(run("feat/pwa-app-shell",dir).status,1);
  }finally{await rm(dir,{recursive:true,force:true})}
});

test("vercel.json delegates ignored-build policy to the audited script",async()=>{
  const config=JSON.parse(await readFile(join(root,"vercel.json"),"utf8"));
  assert.equal(config.ignoreCommand,"bash scripts/vercel-ignore-build.sh");
});
