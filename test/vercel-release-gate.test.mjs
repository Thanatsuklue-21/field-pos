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
function git(cwd,...args){
  const r=spawnSync("git",args,{cwd,encoding:"utf8"});
  assert.equal(r.status,0,r.stderr||r.stdout);
}
async function repoWithBase(prefix){
  const dir=await mkdtemp(join(tmpdir(),prefix));
  git(dir,"init","-q");
  git(dir,"config","user.email","field-ci@example.invalid");
  git(dir,"config","user.name","FIELD CI");
  await writeFile(join(dir,"README.md"),"base\n");
  git(dir,"add","README.md");
  git(dir,"commit","-qm","base");
  return dir;
}

test("Vercel ignore gate skips ordinary main commits",async()=>{
  const dir=await repoWithBase("field-vercel-main-skip-");
  try{
    await writeFile(join(dir,"README.md"),"ordinary main change\n");
    git(dir,"add","README.md");git(dir,"commit","-qm","ordinary");
    assert.equal(run("main",dir).status,0);
  }finally{await rm(dir,{recursive:true,force:true})}
});

test("Vercel ignore gate builds only the exact main release-marker commit",async()=>{
  const dir=await repoWithBase("field-vercel-main-release-");
  try{
    await writeFile(join(dir,".vercel-release"),"FIELD production release\n");
    git(dir,"add",".vercel-release");git(dir,"commit","-qm","release marker");
    assert.equal(run("main",dir).status,1);
    await writeFile(join(dir,"README.md"),"post release change\n");
    git(dir,"add","README.md");git(dir,"commit","-qm","after release");
    assert.equal(run("main",dir).status,0);
  }finally{await rm(dir,{recursive:true,force:true})}
});

test("Vercel ignore gate builds only the exact frozen PWA preview marker commit",async()=>{
  const dir=await repoWithBase("field-vercel-preview-");
  try{
    await writeFile(join(dir,"README.md"),"ordinary feature\n");
    git(dir,"add","README.md");git(dir,"commit","-qm","ordinary feature");
    assert.equal(run("feat/pwa-app-shell",dir).status,0);
    assert.equal(run("feat/other-work",dir).status,0);

    await writeFile(join(dir,".vercel-preview-release"),"FIELD PWA release preview\n");
    git(dir,"add",".vercel-preview-release");git(dir,"commit","-qm","preview marker");
    assert.equal(run("feat/pwa-app-shell",dir).status,1);

    await writeFile(join(dir,"README.md"),"after preview marker\n");
    git(dir,"add","README.md");git(dir,"commit","-qm","after preview");
    assert.equal(run("feat/pwa-app-shell",dir).status,0);
  }finally{await rm(dir,{recursive:true,force:true})}
});

test("vercel.json delegates ignored-build policy to the audited script",async()=>{
  const config=JSON.parse(await readFile(join(root,"vercel.json"),"utf8"));
  assert.equal(config.ignoreCommand,"bash scripts/vercel-ignore-build.sh");
});

test("deployment runtime is pinned to the CI-reviewed Node 24 major",async()=>{
  const pkg=JSON.parse(await readFile(join(root,"package.json"),"utf8"));
  const lock=JSON.parse(await readFile(join(root,"package-lock.json"),"utf8"));
  assert.equal(pkg.engines?.node,"24.x");
  assert.equal(lock.packages?.[""]?.engines?.node,"24.x");
});

test("vercel.json uses framework auto-detection instead of legacy builds override",async()=>{
  const config=JSON.parse(await readFile(join(root,"vercel.json"),"utf8"));
  assert.equal(Object.hasOwn(config,"builds"),false);
});

test("CI pins third-party GitHub Actions to reviewed commit SHAs",async()=>{
  const workflow=await readFile(join(root,".github/workflows/ci.yml"),"utf8");
  assert.match(workflow,/actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
  assert.match(workflow,/actions\/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1/);
  assert.doesNotMatch(workflow,/actions\/checkout@v\d+/);
  assert.doesNotMatch(workflow,/actions\/setup-node@v\d+/);
  assert.match(workflow,/permissions:\s*\n\s*contents:\s*read/);
  assert.match(workflow,/persist-credentials:\s*false/);
  assert.match(workflow,/cancel-in-progress:\s*true/);
  assert.match(workflow,/cache:\s*['"]npm['"]/);
});
