import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("payment resolution timeline reuses sanitized field_audit evidence without writing new audit data",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("if(path==='/api/pos/payment-resolutions'&&method==='GET')");
  const end=api.indexOf("if(path==='/api/pos/payment-resolutions/reconcile'",start);
  const block=api.slice(start,end);
  assert.match(block,/FROM field_audit a LEFT JOIN field_users/);
  assert.match(block,/safeAuditDetails/);
  assert.match(block,/JSON\.parse\(String\(x\.details\|\|'\{\}'\)\)/);
  assert.match(block,/serialized\.includes\(s\.id\)/);
  assert.match(block,/serialized\.includes\(chargeId\)/);
  assert.match(block,/slice\(0,20\)/);
  assert.doesNotMatch(block,/INSERT INTO field_audit/);
});

test("resolution timeline is read-only in Orders and exposes actor/action/time/details",async()=>{
  const ui=await read("app/orders/page.tsx");
  assert.match(ui,/type ResolutionEvent=/);
  assert.match(ui,/Audit timeline/);
  assert.match(ui,/event\.action/);
  assert.match(ui,/event\.actor/);
  assert.match(ui,/event\.createdAt/);
  assert.match(ui,/JSON\.stringify\(event\.details,null,2\)/);
  assert.doesNotMatch(ui,/edit.*timeline/i);
  assert.doesNotMatch(ui,/delete.*timeline/i);
});

test("payment resolution timeline remains scoped to resolution sessions or their charge ids",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("const timeline=paymentAudit.filter");
  const end=api.indexOf("resolutions.push",start);
  const block=api.slice(start,end);
  assert.match(block,/serialized\.includes\(s\.id\)/);
  assert.match(block,/chargeId&&serialized\.includes\(chargeId\)/);
  assert.doesNotMatch(block,/return true/);
});
