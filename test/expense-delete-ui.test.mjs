import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("expense delete UI prepares durable intent before DELETE and never invents a retry key",async()=>{
  const ui=await read("app/expenses/page.tsx");
  const start=ui.indexOf("async function del(row:E)");
  const end=ui.indexOf("const purchase=",start);
  const block=ui.slice(start,end);
  assert.match(block,/prepareExpenseDeleteIntent/);
  assert.match(block,/expense-delete:\$\{crypto\.randomUUID\(\)\}/);
  assert.match(block,/expectedAmount:Number\(row\.amount\)/);
  assert.match(ui,/sendExpenseDeleteIntent\(intent/);
  assert.match(ui,/body:JSON\.stringify\(body\)/);
  const recoverStart=ui.indexOf("async function recoverDelete");
  const recoverBlock=ui.slice(recoverStart,start);
  assert.doesNotMatch(recoverBlock,/crypto\.randomUUID/);
});

test("pending expense deletion locks new accounting edits and gives a contextual recovery action",async()=>{
  const ui=await read("app/expenses/page.tsx");
  assert.match(ui,/ยังไม่ทราบว่ารายจ่าย/);
  assert.match(ui,/ตรวจผลการลบเดิม/);
  assert.match(ui,/ระบบล็อกการเพิ่ม\/ลบค่าใช้จ่ายใหม่/);
  assert.match(ui,/disabled=\{busy\|\|recoveryBlocked\|\|deleteRecoveryBlocked\|\|!!pendingDelete\}/);
  assert.match(ui,/disabled=\{busy\|\|!!pending\|\|recoveryBlocked\|\|!!pendingDelete\|\|deleteRecoveryBlocked\}/);
});

test("expense deletion recovers the exact intent on online focus and visible resume",async()=>{
  const ui=await read("app/expenses/page.tsx");
  const marker=ui.indexOf("const reconnect=()=>");
  const segment=ui.slice(marker,marker+1800);
  assert.match(segment,/readExpenseDeleteIntent\(session\.user\.id\)/);
  assert.match(segment,/recoverDelete\(intent\)/);
  assert.match(segment,/window\.addEventListener\("online",reconnect\)/);
  assert.match(segment,/window\.addEventListener\("focus",reconnect\)/);
  assert.match(segment,/document\.addEventListener\("visibilitychange",visible\)/);
});

test("expense delete server replays request before missing-record and closed-day guards",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("const expenseMatch=path.match");
  const end=api.indexOf("if(path==='/api/customers'&&method==='GET')",start);
  const block=api.slice(start,end);
  assert.match(block,/replayDurableRequest\(tx,doc,requestKey,context\)/);
  assert.ok(block.indexOf("replayDurableRequest")<block.indexOf("expense_not_found"));
  assert.ok(block.indexOf("replayDurableRequest")<block.indexOf("day_closed"));
  assert.match(block,/rememberDurableRequestStatement\(doc,requestKey,response,context,now\)/);
  assert.match(block,/deletedBy:user\.id/);
});
