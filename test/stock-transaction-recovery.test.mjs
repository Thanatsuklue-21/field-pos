import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {shouldRetainStockPending,validatePendingStockTransaction,validateStockTransactionAck} from "../lib/stock-transaction-recovery.mjs";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("stock pending record requires stable transaction identity",()=>{
  const row={body:{requestKey:"stock-key-0001",ingredientId:"matcha",type:"WASTE",unit:"g",qtyDelta:-5},createdAt:1};
  assert.equal(validatePendingStockTransaction(row),row);
  for(const bad of [
    null,
    {body:null,createdAt:1},
    {body:{requestKey:"x",ingredientId:"matcha",type:"WASTE",unit:"g"},createdAt:1},
    {body:{requestKey:"stock-key-0001",ingredientId:"",type:"WASTE",unit:"g"},createdAt:1},
    {body:{requestKey:"stock-key-0001",ingredientId:"matcha",type:"SALE",unit:"g"},createdAt:1},
    {body:{requestKey:"stock-key-0001",ingredientId:"matcha",type:"WASTE",unit:""},createdAt:1},
    {body:{requestKey:"stock-key-0001",ingredientId:"matcha",type:"WASTE",unit:"g"},createdAt:0}
  ]) assert.throws(()=>validatePendingStockTransaction(bad),/stock_recovery_corrupt/);
});

test("stock pending is retained for ambiguous transport/server outcomes only",()=>{
  for(const error of [
    Object.assign(new Error("network"),{status:0}),
    Object.assign(new Error("timeout"),{status:408}),
    Object.assign(new Error("too_early"),{status:425}),
    Object.assign(new Error("rate"),{status:429}),
    Object.assign(new Error("server"),{status:503})
  ]) assert.equal(shouldRetainStockPending(error),true);
  for(const status of [400,401,403,404,409,422]){
    assert.equal(shouldRetainStockPending(Object.assign(new Error("rejected"),{status})),false);
  }
});

test("stock pending clears only after exact transaction acknowledgement",()=>{
  const body={requestKey:"stock-ack-0001",ingredientId:"matcha",type:"WASTE",unit:"g",qtyDelta:-5};
  const good={ok:true,transaction:{requestKey:"stock-ack-0001",ingredientId:"matcha",type:"WASTE",unit:"g"}};
  assert.equal(validateStockTransactionAck(good,body),good);
  for(const bad of [
    null,
    {},
    {ok:false,transaction:good.transaction},
    {ok:true,transaction:{...good.transaction,requestKey:"other"}},
    {ok:true,transaction:{...good.transaction,ingredientId:"milk"}},
    {ok:true,transaction:{...good.transaction,type:"PURCHASE"}},
    {ok:true,transaction:{...good.transaction,unit:"ml"}}
  ]) assert.throws(()=>validateStockTransactionAck(bad,body),/stock_transaction_unconfirmed/);
});

test("Stock UI persists exact request before send and recovers it on reconnect",async()=>{
  const ui=await read("app/stock/page.tsx");
  const start=ui.indexOf("async function sendStockTransaction");
  const end=ui.indexOf("useEffect(()=>",start);
  const block=ui.slice(start,end);
  assert.match(block,/stockPendingWrite\(body\)/);
  assert.match(block,/body:JSON\.stringify\(pending\.body\)/);
  assert.ok(block.indexOf("stockPendingWrite(body)")<block.indexOf('api<any>("/api/stock/transactions"'));
  assert.ok(block.indexOf("validateStockTransactionAck(r,pending.body)")<block.indexOf("stockPendingClear()"));
  assert.match(ui,/window\.addEventListener\("online",onOnline\)/);
  assert.match(ui,/window\.addEventListener\("focus",onFocus\)/);
  assert.match(ui,/document\.addEventListener\("visibilitychange",onVisible\)/);
  assert.match(ui,/stockRecoveryRef/);
  assert.match(ui,/referenceId="manual-"\+requestKey/);
});

test("purchase and waste use durable sender rather than direct stock API writes",async()=>{
  const ui=await read("app/stock/page.tsx");
  const start=ui.indexOf("async function saveTx()");
  const end=ui.indexOf("async function saveMaster()",start);
  const block=ui.slice(start,end);
  assert.match(block,/await sendStockTransaction\(body\)/);
  assert.doesNotMatch(block,/api\("\/api\/stock\/transactions"/);
});
