import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {buildAccountingReconciliation} from "../lib/domain/accounting-reconciliation.mjs";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("PWA accounting reconciliation passes balanced paid sales and split payments",()=>{
  const doc={sales:[
    {id:"s1",date:"2026-10-13",status:"paid",total:80,payments:[{method:"cash",amount:80}]},
    {id:"s2",date:"2026-10-13",status:"paid",total:120,payments:[{method:"cash",amount:50},{method:"promptpay",amount:70}]}
  ],expenses:[],cashMovements:[]};
  const r=buildAccountingReconciliation({doc,date:"2026-10-13"});
  assert.equal(r.ok,true);
  assert.equal(r.totals.revenue,200);
  assert.equal(r.totals.paymentSum,200);
});

test("PWA accounting reconciliation fails closed on sale payment mismatch",()=>{
  const doc={sales:[{id:"s1",date:"2026-10-13",status:"paid",total:100,payments:[{method:"cash",amount:80}]}]};
  const r=buildAccountingReconciliation({doc,date:"2026-10-13"});
  assert.equal(r.ok,false);
  assert.equal(r.level,"CRITICAL");
  assert.ok(r.blocking.some(x=>x.code==="SALE_PAYMENT_TOTAL_MISMATCH"));
  assert.ok(r.blocking.some(x=>x.code==="DAY_SALES_PAYMENT_MISMATCH"));
});

test("PWA admin readiness includes accounting and full operations require accounting ok",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("if(path==='/api/admin/readiness'&&method==='GET')");
  const end=api.indexOf("if(path==='/api/admin/business-settings'",start);
  const block=api.slice(start,end);
  assert.ok(start>0&&end>start);
  assert.match(block,/buildAccountingReconciliation/);
  assert.match(block,/accounting_reconciliation_failed/);
  assert.match(block,/readyForFullOperations=.*accounting\.ok/);
  assert.match(block,/accounting,/);
});

test("PWA Close Day blocks critical accounting mismatch before creating close record",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("if(path==='/api/close-day'&&method==='POST')");
  const end=api.indexOf("if(path==='/api/management/dashboard'",start);
  const block=api.slice(start,end);
  assert.ok(start>0&&end>start);
  assert.match(block,/const accounting=buildAccountingReconciliation\(\{doc,date\}\)/);
  assert.match(block,/accounting_reconciliation_failed/);
  assert.ok(block.indexOf("accounting_reconciliation_failed")<block.indexOf("const close="));
});

test("PWA Today hub surfaces accounting readiness without adding another mutation path",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  assert.match(hub,/\/api\/admin\/readiness/);
  assert.match(hub,/ความพร้อมระบบ/);
  assert.match(hub,/บัญชีมี Critical mismatch/);
  assert.match(hub,/ระบบบล็อก Close Day อัตโนมัติ/);
  assert.match(hub,/readiness\.readyForFullOperations/);
  assert.match(hub,/readiness\.accounting\?\.ok===false/);
});
