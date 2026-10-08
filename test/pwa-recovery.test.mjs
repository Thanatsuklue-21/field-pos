import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("cold-start offline operator fallback stores no password or csrf and is staff-limited",async()=>{
  const offline=await read("lib/offline-operator.ts"),auth=await read("components/auth-gate.tsx");
  assert.ok(offline.includes("MAX_AGE_MS=7*24*60*60*1000"));
  assert.ok(offline.includes('role:"staff"'));
  assert.ok(offline.includes('permissions:{order:true}'));
  assert.ok(!offline.includes('queue:true'));
  assert.ok(offline.includes('csrf:""'));
  assert.ok(!offline.includes("password"));
  assert.ok(auth.includes("getOfflineOperatorIfReady"));
  assert.ok(auth.includes('window.addEventListener("online",revalidate)'));
});

test("split and edit-cash recovery migrate from sessionStorage to durable localStorage",async()=>{
  const storage=await read("lib/recovery-storage.ts"),pos=await read("app/pos/page.tsx"),orders=await read("app/orders/page.tsx");
  assert.ok(storage.includes("localStorage.getItem"));
  assert.ok(storage.includes("sessionStorage.getItem"));
  assert.ok(storage.includes("localStorage.setItem(key,legacy)"));
  assert.ok(pos.includes("readRecovery<SplitGroup>(SPLIT_GROUP_KEY)"));
  assert.ok(pos.includes("writeRecovery(SPLIT_GROUP_KEY,g)"));
  assert.ok(pos.includes("readRecovery<any>(EDIT_CASH_KEY)"));
  assert.ok(orders.includes('writeRecovery("field-pos-edit-cash-v1"'));
});

test("offline fallback never syncs outbox or writes online before server session revalidation",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.ok(pos.includes("if(next&&!session.offline)syncOfflineQueue()"));
  assert.ok(pos.includes("if(!offlineAtStart&&session.offline)"));
  assert.ok(pos.includes("offline_session_revalidation"));
  assert.ok(pos.includes("if(!session.offline&&online)syncOfflineQueue()"));
});

test("mobile payment sheet follows visual viewport so Android keyboard cannot cover confirm action",async()=>{
  const runtime=await read("components/pwa-runtime.tsx"),css=await read("app/globals.css"),pos=await read("app/pos/page.tsx");
  assert.ok(runtime.includes("window.visualViewport"));
  assert.ok(runtime.includes("--field-visual-viewport-height"));
  assert.ok(css.includes(".field-payment-sheet"));
  assert.ok(css.includes("var(--field-visual-viewport-height,100dvh)"));
  assert.ok(pos.includes("field-payment-sheet"));
  assert.ok(pos.includes("sticky bottom-0"));
});

test("PWA update guard recognizes durable split and edit recovery",async()=>{
  const runtime=await read("components/pwa-runtime.tsx");
  assert.ok(runtime.includes('hasRecovery("field-pos-split-group-v1")'));
  assert.ok(runtime.includes('hasRecovery("field-pos-edit-cash-v1")'));
});


test("online-but-unreachable server can use restricted cached operator while 401 cannot",async()=>{
  const offline=await read("lib/offline-operator.ts"),gate=await read("components/auth-gate.tsx");
  assert.ok(offline.includes("allowNetworkUncertain"));
  assert.ok(offline.includes("navigator.onLine&&!options.allowNetworkUncertain"));
  assert.ok(gate.includes("if(e?.status===0)"));
  assert.ok(gate.includes("getOfflineOperatorIfReady({allowNetworkUncertain:true})"));
  assert.ok(!gate.includes("if(e?.status===401){const offline"));
});

test("offline operator session revalidates on network recovery focus and visibility",async()=>{
  const gate=await read("components/auth-gate.tsx");
  assert.ok(gate.includes('window.addEventListener("field:network",networkSignal)'));
  assert.ok(gate.includes('window.addEventListener("focus",focus)'));
  assert.ok(gate.includes('document.addEventListener("visibilitychange",visible)'));
  assert.ok(gate.includes("getSessionCached(true).then(publish)"));
});


test("session revalidation is single-flight so online telemetry cannot recurse auth checks",async()=>{
  const gate=await read("components/auth-gate.tsx");
  assert.ok(gate.includes("revalidating=false"));
  assert.ok(gate.includes("if(!navigator.onLine||revalidating)return"));
  assert.ok(gate.includes("revalidating=true"));
  assert.ok(gate.includes(".finally(()=>{revalidating=false})"));
});


test("auth session probe fails fast without shortening ordinary GET or financial write semantics",async()=>{
  const client=await read("lib/api-client.ts");
  assert.ok(client.includes("AUTH_SESSION_TIMEOUT_MS=2_500"));
  assert.ok(client.includes("GET_TIMEOUT_MS=8_000"));
  assert.ok(client.includes('path==="/api/auth/session"?AUTH_SESSION_TIMEOUT_MS:GET_TIMEOUT_MS'));
  assert.ok(client.includes('"field_auth_session_timeout"'));
  assert.ok(client.includes('method==="GET"&&!init.signal'));
});


test("cold-start offline navigation exposes only POS and readiness",async()=>{
  const shell=await read("components/app-shell.tsx");
  assert.ok(shell.includes('session.offline?["/pos","/settings"].includes(href)'));
  assert.ok(shell.includes('primaryMobile=["/pos","/queue","/orders","/stock"]'));
  assert.ok(shell.includes('overflowMobile=["/expenses","/close","/settings"]'));
});


test("offline direct routes are redirected before server-dependent pages render",async()=>{
  const shell=await read("components/app-shell.tsx");
  assert.ok(shell.includes('offlineRouteAllowed=!session?.offline||["/pos","/settings"].includes(path)'));
  assert.ok(shell.includes('if(session?.offline&&!offlineRouteAllowed)router.replace("/pos")'));
  assert.ok(shell.includes('offlineRouteAllowed?children:'));
  assert.ok(shell.includes("OFFLINE MODE · CASH ONLY"));
});


test("stale pending cash always reconciles the original request key instead of timing out locally",async()=>{
  const pos=await read("app/pos/page.tsx");
  const start=pos.indexOf("async function recoverCashCheckout()");
  const end=pos.indexOf("async function finalizePending",start);
  const block=pos.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.ok(block.includes("ageMs>24*60*60*1000"));
  assert.ok(block.includes('api<any>("/api/pos/checkout"'));
  assert.ok(block.includes("body:JSON.stringify(p.body)"));
  assert.ok(!block.includes('if(ageMs>24*60*60*1000){'));
  assert.ok(block.includes('["business_date_changed","day_closed"].includes(e.message)'));
  const guarded=block.slice(block.indexOf('["business_date_changed","day_closed"]'),block.indexOf('else if(!["network_unavailable"'));
  assert.ok(!guarded.includes("cashPendingClear()"));
  assert.ok(block.includes("ระบบยังเก็บ request เดิมไว้และจะไม่สร้างบิลซ้ำ"));
});


test("stale cash resolution is explicit admin-only and only clears the matching local request",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.ok(pos.includes("type CashRecoveryReview="));
  assert.ok(pos.includes('session.user.role!=="admin"||!cashRecoveryReview'));
  assert.ok(pos.includes('String(pending.body?.requestKey||"")!==cashRecoveryReview.requestKey'));
  assert.ok(pos.includes("window.confirm("));
  assert.ok(pos.includes("ล้างเฉพาะ pending ในเครื่อง ไม่สร้างยอดขายและไม่เปลี่ยน Stock"));
  assert.ok(pos.includes('session.user.role==="admin"&&<button onClick={clearReviewedCashPending}'));
  assert.ok(pos.includes('router.push("/orders")'));
});

test("deterministic stale-cash errors open review while network ambiguity never exposes local clear action",async()=>{
  const pos=await read("app/pos/page.tsx");
  const start=pos.indexOf("async function recoverCashCheckout()");
  const end=pos.indexOf("async function finalizePending",start);
  const block=pos.slice(start,end);
  assert.ok(block.includes('["business_date_changed","day_closed"].includes(e.message)'));
  assert.ok(block.includes("setCashRecoveryReview({"));
  const deterministic=block.slice(block.indexOf('["business_date_changed","day_closed"]'),block.indexOf('else if(!["network_unavailable"'));
  assert.ok(deterministic.includes("setCashRecoveryReview"));
  assert.ok(!deterministic.includes("cashPendingClear()"));
  const networkBranch=block.slice(block.indexOf('else if(!["network_unavailable"'));
  assert.ok(networkBranch.includes("cashPendingClear()"));
});


test("unresolved stale cash review blocks new payment before any new checkout request",async()=>{
  const pos=await read("app/pos/page.tsx");
  const checkoutStart=pos.indexOf("async function checkout()");
  const checkoutEnd=pos.indexOf("function openPayment()",checkoutStart);
  const checkoutBlock=pos.slice(checkoutStart,checkoutEnd);
  assert.ok(checkoutBlock.includes("if(cashRecoveryReview)"));
  assert.ok(checkoutBlock.includes("ต้องตรวจรายการเงินสดค้างก่อนรับชำระบิลใหม่"));
  assert.ok(checkoutBlock.indexOf("if(cashRecoveryReview)")<checkoutBlock.indexOf('api<any>("/api/pos/checkout"'));

  const openStart=pos.indexOf("function openPayment()");
  const openEnd=pos.indexOf("return <section",openStart);
  const openBlock=pos.slice(openStart,openEnd);
  assert.ok(openBlock.includes("if(cashRecoveryReview)"));
  assert.ok(openBlock.includes("ต้องตรวจรายการเงินสดค้างก่อนเปิดชำระบิลใหม่"));
});


test("cached operator can render before the authoritative session probe finishes without gaining online write authority",async()=>{
  const gate=await read("components/auth-gate.tsx"),pos=await read("app/pos/page.tsx");
  assert.ok(gate.includes("const sessionProbe=getSessionCached()"));
  assert.ok(gate.includes("provisional=await getOfflineOperatorIfReady({allowNetworkUncertain:true})"));
  assert.ok(gate.includes("publish(provisional)"));
  assert.ok(gate.includes("setLoading(false)"));
  assert.ok(gate.includes("LIMITED MODE · SERVER NOT VERIFIED"));
  assert.ok(gate.includes("if(e?.status===401)"));
  assert.ok(gate.includes("clearOfflineOperatorSession()"));
  assert.ok(pos.includes("if(!offlineAtStart&&session.offline)"));
  assert.ok(pos.includes("offline_session_revalidation"));
});
