import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {CLOSE_DAY_LOCAL_RECOVERY_GUARDS,findCloseDayLocalRecoveryBlockers} from "../lib/close-day-local-recovery.mjs";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("Close Day local recovery registry covers every durable transaction family that can cross reconciliation",()=>{
  const keys=CLOSE_DAY_LOCAL_RECOVERY_GUARDS.map(x=>x.key);
  for(const key of [
    "field-pos-pending-promptpay-v1",
    "field-pos-pending-cash-v1",
    "field-pos-split-group-v1",
    "field-pos-edit-cash-v1",
    "field-pos-pending-queue-action-v1",
    "field-pos-pending-expense-v1",
    "field-pos-pending-stock-transaction-v1",
    "field-pos-pending-cycle-count-v1",
    "field-pos-pending-order-mutation-v1",
    "field-pos-pending-cash-movement-v1",
    "field-pos-pending-delivery-settlement-v1",
    "field-pos-pending-crm-points-v1",
    "field-pos-pending-close-day-v1",
  ]) assert.ok(keys.includes(key),key);
  assert.equal(new Set(keys).size,keys.length);
});

test("Close Day blocker detects pending recovery from localStorage or migrated sessionStorage",()=>{
  const target=CLOSE_DAY_LOCAL_RECOVERY_GUARDS[0];
  for(const source of ["local","session"]){
    const blockers=findCloseDayLocalRecoveryBlockers({
      readLocal:key=>source==="local"&&key===target.key?"{}":null,
      readSession:key=>source==="session"&&key===target.key?"{}":null,
    });
    assert.deepEqual(blockers,[target]);
  }
  assert.deepEqual(findCloseDayLocalRecoveryBlockers({readLocal:()=>null,readSession:()=>null}),[]);
});

test("Close Day recovery storage read failure fails closed",()=>{
  assert.throws(()=>findCloseDayLocalRecoveryBlockers({readLocal:()=>{throw Error("SecurityError")},readSession:()=>null}),/close_day_local_recovery_storage_unavailable/);
  assert.throws(()=>findCloseDayLocalRecoveryBlockers({readLocal:()=>null,readSession:()=>{throw Error("SecurityError")}}),/close_day_local_recovery_storage_unavailable/);
});

test("Close Day UI checks local recovery immediately before any close request and disables the close action",async()=>{
  const ui=await read("app/close/page.tsx");
  const start=ui.indexOf("async function close()");
  const end=ui.indexOf("return <section",start);
  const block=ui.slice(start,end);
  assert.match(block,/localBlockers=await refreshLocalRecoveryBlockers\(\)/);
  assert.match(block,/if\(localBlockers\.length\)/);
  assert.ok(block.indexOf("await refreshLocalRecoveryBlockers()")<block.indexOf("sendCloseDay(body)"));
  assert.match(ui,/localRecoveryError\|\|localRecoveryBlockers\.length>0/);
  assert.match(ui,/ปิดวันไม่ได้ · Local Recovery ยังไม่เคลียร์/);
  assert.match(ui,/ตรวจ Recovery อีกครั้ง/);
});
