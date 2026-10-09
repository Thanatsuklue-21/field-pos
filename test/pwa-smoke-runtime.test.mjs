import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runPwaSmoke} from "../scripts/pwa-smoke.mjs";
import nextConfig from "../next.config.mjs";

const sha="a".repeat(40),origin="https://field.test";
const sw=await readFile(new URL("../public/sw.js",import.meta.url),"utf8");
const version=sw.match(/^const VERSION="([^"]+)"/)[1];
const pngs=Object.fromEntries(await Promise.all([192,512].map(async size=>[size,await readFile(new URL(`../public/field-icon-${size}.png`,import.meta.url))])));
test("direct Next PWA headers match the audited Vercel cache policy",async()=>{
  const vercel=JSON.parse(await readFile(new URL("../vercel.json",import.meta.url),"utf8"));
  const headers=await nextConfig.headers();
  for(const row of headers)assert.deepEqual(row,vercel.headers.find(x=>x.source===row.source));
});
function fixture(overrides={}){
  const calls=[];
  const json=value=>new Response(JSON.stringify(value),{headers:{"content-type":"application/json"}});
  const fetchImpl=async(url,init)=>{
    const path=url.pathname;calls.push({path,origin:url.origin,init});
    assert.equal(init.method,undefined);assert.equal(init.redirect,"manual");assert.ok(init.signal);
    if(path in overrides)return overrides[path]();
    if(path==="/manifest.webmanifest")return new Response(JSON.stringify({name:"FIELD POS",start_url:"/pos",display:"standalone",background_color:"#F7F1E3",icons:[192,512].map(size=>({sizes:`${size}x${size}`,src:`/field-icon-${size}.png`}))}),{headers:{"content-type":"application/manifest+json"}});
    for(const size of [192,512])if(path===`/field-icon-${size}.png`)return new Response(pngs[size],{headers:{"content-type":"image/png"}});
    if(path==="/sw.js")return new Response(sw,{headers:{"content-type":"application/javascript","cache-control":"no-cache"}});
    if(path==="/api/build")return json({buildSha:sha,environment:"preview"});
    if(path==="/api/health")return json({ok:true,storage:"turso"});
    if(path==="/pos"||path==="/settings")return new Response('<html><script src="/_next/static/chunk.js"></script></html>',{headers:{"content-type":"text/html"}});
    assert.fail("unexpected request "+path);
  };
  return {calls,run:(options={})=>runPwaSmoke({baseUrl:origin,expectedSha:sha,fetchImpl,...options})};
}

test("current candidate version and real PNG icons pass read-only release smoke",async()=>{
  const f=fixture(),result=await f.run({bypassSecret:"private-bypass"});
  assert.equal(result.serviceWorker.version,version);assert.equal(result.buildSha,sha);
  assert.equal(f.calls.length,8);assert.ok(f.calls.every(x=>x.init.headers["x-vercel-protection-bypass"]==="private-bypass"));
  assert.ok(!JSON.stringify(result).includes("private-bypass"));
});
for(const expectedSha of [undefined,"",sha.slice(0,7),"z".repeat(40)]){
  test(`missing or invalid full SHA fails before requests (${String(expectedSha)})`,async()=>{
    const f=fixture();await assert.rejects(f.run({expectedSha}),/EXPECTED_SHA_requires_full_commit/);assert.equal(f.calls.length,0);
  });
}
test("old SW is rejected even when the backend reports the expected SHA",async()=>{
  const f=fixture({"/sw.js":()=>new Response(sw.replace(version,"field-pwa-v6"),{headers:{"content-type":"application/javascript","cache-control":"no-cache"}})});
  await assert.rejects(f.run(),/sw_version_mismatch/);
});
test("different backend SHA cannot pass",async()=>{
  const f=fixture({"/api/build":()=>Response.json({buildSha:"b".repeat(40),environment:"preview"})});
  await assert.rejects(f.run(),/build_sha_mismatch/);
});
for(const location of ["https://login.other.test/login","/login"]){
  test(`login redirect fails without forwarding the bypass secret (${location})`,async()=>{
    const f=fixture({"/pos":()=>new Response(null,{status:302,headers:{location}})});
    await assert.rejects(f.run({bypassSecret:"private-bypass"}),/_cross_origin_redirect|_unexpected_redirect/);
    assert.ok(f.calls.every(x=>x.origin===origin&&x.path!=="/login"));
  });
}
test("HTTP 200 JSON impostor cannot pass the app shell gate",async()=>{
  const f=fixture({"/settings":()=>Response.json({ok:true})});await assert.rejects(f.run(),/not_app_shell/);
});
test("missing icon blocks install readiness",async()=>{
  const f=fixture({"/field-icon-512.png":()=>new Response("missing",{status:404})});await assert.rejects(f.run(),/http_404/);
});
test("wrong-sized icon blocks install readiness",async()=>{
  const f=fixture({"/field-icon-512.png":()=>new Response(pngs[192],{headers:{"content-type":"image/png"}})});await assert.rejects(f.run(),/icon_dimensions_512/);
});
test("external icon never receives the protection secret",async()=>{
  const f=fixture({"/manifest.webmanifest":()=>Response.json({name:"FIELD POS",start_url:"/pos",display:"standalone",icons:[{sizes:"192x192",src:"https://other.test/icon.png"}]})});
  await assert.rejects(f.run({bypassSecret:"private-bypass"}),/cross_origin_asset/);assert.equal(f.calls.length,1);
});
test("missing UAT backend remains a release blocker",async()=>{
  const f=fixture({"/api/health":()=>Response.json({ok:false,error:"turso_not_configured"},{status:503})});await assert.rejects(f.run(),/server_health_gate_failed/);
});
test("transport failure is controlled and cannot expose the bypass secret",async()=>{
  const f=fixture({"/sw.js":()=>{throw Error("request private-bypass failed")}});
  await assert.rejects(f.run({bypassSecret:"private-bypass"}),error=>error.message==="/sw.js_fetch_failed_or_timeout");
});
