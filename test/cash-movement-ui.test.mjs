import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("cash drawer UI persists intent before POST and clears only through exact ACK helper",async()=>{
  const ui=await read("app/close/page.tsx");
  const start=ui.indexOf("async function addMovement");
  const end=ui.indexOf("async function reviewCash",start);
  const block=ui.slice(start,end);
  assert.match(block,/prepareCashMovementIntent/);
  assert.match(block,/requestKey:crypto\.randomUUID\(\)/);
  assert.match(ui,/sendCashMovementIntent\(intent/);
  assert.match(ui,/readCashMovementIntent\(session\.user\.id\)/);
  assert.match(ui,/รายการเดิมยังรอคำยืนยันจาก Server/);
  assert.match(ui,/ช่องข้อมูลถูกล็อก/);
  assert.match(ui,/ตรวจผลรายการเดิม/);
});

test("cash drawer recovery reuses the exact request on reconnect focus and visible resume",async()=>{
  const ui=await read("app/close/page.tsx");
  const marker=ui.indexOf("let disposed=false,recovering=false");
  const segment=ui.slice(marker,marker+2600);
  assert.match(segment,/readCashMovementIntent\(session\.user\.id\)/);
  assert.match(segment,/submitMovementIntent\(intent,true\)/);
  assert.match(segment,/window\.addEventListener\("online",onOnline\)/);
  assert.match(segment,/window\.addEventListener\("focus",onFocus\)/);
  assert.match(segment,/document\.addEventListener\("visibilitychange",onVisible\)/);
  assert.doesNotMatch(segment,/crypto\.randomUUID/);
});

test("cash drawer server route replays before day and drawer guards then commits request ledger atomically",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("if(path==='/api/cash-shift/movements'");
  const end=api.indexOf("if(path==='/api/close-day/review'",start);
  const block=api.slice(start,end);
  assert.match(block,/replayDurableRequest\(tx,doc,requestKey,context\)/);
  assert.ok(block.indexOf("replayDurableRequest")<block.indexOf("business_date_changed"));
  assert.ok(block.indexOf("replayDurableRequest")<block.indexOf("day_already_closed"));
  assert.match(block,/rememberDurableRequestStatement\(doc,requestKey,response,context,now\)/);
  assert.ok(block.indexOf("rememberDurableRequestStatement")<block.indexOf("await tx.commit()"));
  assert.match(block,/requestKey,shiftId:shift\.id/);
});
