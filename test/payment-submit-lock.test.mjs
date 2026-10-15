import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const source=await readFile(new URL("../app/pos/page.tsx",import.meta.url),"utf8");

test("checkout has a synchronous in-flight guard before React busy state can rerender",()=>{
  assert.match(source,/const checkoutInFlightRef=useRef\(false\)/);
  const checkout=source.slice(source.indexOf("async function checkout()"),source.indexOf("function openPayment()"));
  const guard=checkout.indexOf("if(checkoutInFlightRef.current)return");
  const lock=checkout.indexOf("checkoutInFlightRef.current=true");
  const busy=checkout.indexOf("setBusy(true)");
  const request=checkout.indexOf('/api/pos/checkout');
  assert.ok(guard>=0&&lock>guard&&busy>lock&&request>busy);
  assert.match(checkout,/finally\{\s*checkoutInFlightRef\.current=false;\s*setBusy\(false\)/);
});

test("payment controls remain frozen while checkout is committing",()=>{
  assert.match(source,/<fieldset disabled=\{busy\} aria-busy=\{busy\}/);
  assert.match(source,/disabled=\{busy\|\|!payableItems\.length/);
  assert.match(source,/กำลังยืนยันรายการนี้ · ห้ามรับเงินซ้ำหรือเปลี่ยนยอด/);
});
