import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("close day deep-links each pending payment to its exact resolution session",async()=>{
  const close=await read("app/close/page.tsx");
  assert.match(close,/\/orders\?resolution=/);
  assert.match(close,/encodeURIComponent\(paymentBlockers\[0\]\.id\)/);
  assert.match(close,/encodeURIComponent\(p\.id\)/);
  assert.match(close,/ตรวจ Payment นี้โดยตรง/);
});

test("orders focuses and highlights a payment resolution selected from close day",async()=>{
  const orders=await read("app/orders/page.tsx");
  assert.match(orders,/params\.get\("resolution"\)/);
  assert.match(orders,/setResolutionTarget\(resolution\)/);
  assert.match(orders,/id=\{"payment-resolution-"\+r\.id\}/);
  assert.match(orders,/scrollIntoView\(\{behavior:"smooth",block:"center"\}\)/);
  assert.match(orders,/tabIndex=\{-1\}/);
  assert.match(orders,/resolutionTarget===r\.id/);
});
