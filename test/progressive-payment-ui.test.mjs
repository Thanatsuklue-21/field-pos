import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("payment sheet shows only the two fastest front-counter methods by default",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/showMorePaymentMethods,setShowMorePaymentMethods/);
  assert.match(pos,/>เงินสด<\/button>/);
  assert.match(pos,/>QR พร้อมเพย์/);
  assert.match(pos,/วิธีอื่น · โอน \/ บัตร \/ เดลิเวอรี/);
  assert.match(pos,/showMorePaymentMethods&&<div/);
  const primaryStart=pos.indexOf('grid grid-cols-2');
  const moreStart=pos.indexOf('aria-expanded={showMorePaymentMethods}',primaryStart);
  const primary=pos.slice(primaryStart,moreStart);
  assert.doesNotMatch(primary,/>โอนธนาคาร<\/button>/);
  assert.doesNotMatch(primary,/>บัตร<\/button>/);
  assert.doesNotMatch(primary,/>เดลิเวอรี<\/button>/);
});

test("advanced payment methods remain available without cluttering routine checkout",async()=>{
  const pos=await read("app/pos/page.tsx");
  const start=pos.indexOf('aria-expanded={showMorePaymentMethods}');
  const block=pos.slice(start,start+3200);
  assert.match(block,/>บัตร<\/button>/);
  assert.match(block,/>เดลิเวอรี<\/button>/);
  assert.match(block,/setMethod\("card"\)/);
  assert.match(block,/setMethod\("delivery"\)/);
});

test("hiding advanced payment methods cannot leave a hidden card or delivery method active",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/if\(showMorePaymentMethods\)\{if\(method==="bank"\|\|method==="card"\|\|method==="delivery"\)setMethod\("cash"\);setShowMorePaymentMethods\(false\)\}/);
});

test("new transactions collapse advanced payment choices back to the simple default",async()=>{
  const pos=await read("app/pos/page.tsx");
  const next=pos.slice(pos.indexOf("function startNextOrder"),pos.indexOf("async function recoverCashCheckout"));
  assert.match(next,/setMethod\("cash"\)/);
  assert.match(next,/setShowMorePaymentMethods\(false\)/);
  const finish=pos.slice(pos.indexOf("function finishSale"),pos.indexOf("function availabilityMessage"));
  assert.match(finish,/setShowMorePaymentMethods\(false\)/);
});

test("progressive disclosure changes only payment selection UI, not checkout authority",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/useState<"cash"\|"promptpay"\|"bank"\|"card"\|"delivery">\("cash"\)/);
  assert.match(pos,/payment:method==="delivery"\?"other":method/);
  assert.match(pos,/async function checkout\(\)/);
  assert.match(pos,/paymentRecoveryIntegrityIssue\(\)/);
});
