import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";

const source=await readFile(new URL("../public/sw.js",import.meta.url),"utf8");
function worker(fetch,cached){
  let timer,delay,cleared=false;
  const writes=[],listeners={};
  const context={
    self:{location:{origin:"https://field.test"},addEventListener(type,handler){listeners[type]=handler}},
    URL,Response,Request,fetch,
    caches:{open:async()=>({match:async path=>cached?.[path],put:async(...args)=>writes.push(args)})},
    setTimeout(fn,ms){timer=fn;delay=ms;return 1},
    clearTimeout(){cleared=true},
  };
  runInNewContext(source,context);
  return {navigate:(path,event)=>context.networkFirstNavigation(new Request("https://field.test"+path),event),listeners,
    timeout:()=>timer?.(),get delay(){return delay},get cleared(){return cleared},writes};
}

test("slow navigation uses cached POS after a bounded startup wait",async()=>{
  const cached=new Response("restricted POS"),sw=worker(()=>new Promise(()=>{}),{"/pos":cached});
  const navigation=sw.navigate("/pos");
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sw.delay,3000);
  sw.timeout();
  assert.equal(await navigation,cached);
  assert.equal(sw.cleared,true);
});

test("cold install without cache keeps waiting for a usable network response",async()=>{
  let finish;
  const sw=worker(()=>new Promise(resolve=>{finish=resolve}));
  const navigation=sw.navigate("/pos");
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sw.delay,undefined);
  const response=new Response("online POS");finish(response);
  assert.equal(await navigation,response);
  assert.equal(sw.writes.length,1);
});

test("fast network wins and refreshes safe shell while clearing the startup timer",async()=>{
  const response=new Response("fresh POS"),sw=worker(async()=>response,{"/pos":new Response("old")});
  assert.equal(await sw.navigate("/pos"),response);
  assert.equal(sw.cleared,true);
  assert.equal(sw.writes[0][0],"/pos");
});

test("offline settings uses its own shell and unsafe routes fall back only to POS",async()=>{
  const pos=new Response("POS"),settings=new Response("Settings"),sw=worker(async()=>{throw Error("offline")},{"/pos":pos,"/settings":settings});
  assert.equal(await sw.navigate("/settings"),settings);
  assert.equal(await sw.navigate("/orders"),pos);
  assert.equal(sw.writes.length,0);
});

test("offline navigation without a shell fails closed",async()=>{
  const sw=worker(async()=>{throw Error("offline")});
  assert.equal((await sw.navigate("/pos")).type,"error");
});

test("late navigation response warms the shell without replacing the startup fallback",async()=>{
  let finish,lifetime;
  const cached=new Response("restricted POS"),sw=worker(()=>new Promise(resolve=>{finish=resolve}),{"/pos":cached});
  const navigation=sw.navigate("/pos",{waitUntil(promise){lifetime=promise}});
  await new Promise(resolve=>setImmediate(resolve));sw.timeout();
  assert.equal(await navigation,cached);
  finish(new Response("fresh shell"));await lifetime;
  assert.equal(await sw.writes[0][1].text(),"fresh shell");
});

test("API reads, financial writes and cross-origin requests bypass navigation fallback",()=>{
  const sw=worker(()=>{throw Error("must not intercept")});
  for(const request of [
    new Request("https://field.test/api/auth/session"),
    new Request("https://field.test/api/pos/checkout",{method:"POST"}),
    new Request("https://other.test/pos"),
  ]){
    sw.listeners.fetch({request,respondWith(){assert.fail("request intercepted")}});
  }
});
