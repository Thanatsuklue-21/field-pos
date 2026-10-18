import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("PWA resume revalidates network state and restarts durable recovery",async()=>{
  const pos=await read("app/pos/page.tsx");
  const start=pos.indexOf("useEffect(()=>{\n    let initial=true;");
  const end=pos.indexOf("\n\n  useEffect(()=>{",start+1);
  assert.ok(start>0&&end>start);
  const block=pos.slice(start,end);
  assert.match(block,/navigator\.onLine/);
  assert.match(block,/window\.addEventListener\("focus",networkChanged\)/);
  assert.match(block,/window\.addEventListener\("pageshow",networkChanged\)/);
  assert.match(block,/document\.addEventListener\("visibilitychange",resume\)/);
  assert.match(block,/document\.visibilityState==="visible"/);
  assert.match(block,/syncOfflineQueue\(\)\.catch/);
  assert.match(block,/recoverCashCheckout\(\)\.then\(\(\)=>recoverPending\(\)\)/);
  assert.match(block,/removeEventListener\("focus",networkChanged\)/);
  assert.match(block,/removeEventListener\("pageshow",networkChanged\)/);
  assert.match(block,/removeEventListener\("visibilitychange",resume\)/);
});

test("cash checkout recovery is serialized across overlapping lifecycle events",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/const cashReconcileRef=useRef\(false\)/);
  const start=pos.indexOf("async function recoverCashCheckout()");
  const end=pos.indexOf("async function finalizePending",start);
  assert.ok(start>0&&end>start);
  const block=pos.slice(start,end);
  assert.match(block,/if\(cashReconcileRef\.current\)return/);
  assert.match(block,/cashReconcileRef\.current=true/);
  assert.match(block,/finally\{\s*cashReconcileRef\.current=false/);
  assert.match(block,/JSON\.stringify\(p\.body\)/);
  assert.match(block,/cashPendingClear\(\)/);
});
