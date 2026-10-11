import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("API client time-bounds only writes with durable transaction recovery",async()=>{
  const api=await read("lib/api-client.ts");
  assert.match(api,/RECOVERABLE_WRITE_TIMEOUT_MS=20_000/);
  for(const path of [
    "/api/pos/checkout",
    "/api/pos/void",
    "/api/pos/refund",
    "/api/expenses",
    "/api/stock/transactions",
    "/api/pos/queue",
    "/api/pos/split/start",
    "/api/pos/split/pay",
    "/api/pos/split/cancel",
    "/api/pos/split/provider-release",
    "/api/pos/payment-resolutions/reconcile",
    "/api/payments/promptpay/create",
    "/api/payments/promptpay/status"
  ]) assert.match(api,new RegExp(path.replaceAll("/","\\/")));
  assert.match(api,/recoverableWrite=method!=="GET"&&RECOVERABLE_WRITE_PATHS\.has\(path\)/);
  assert.match(api,/field_recoverable_write_timeout/);
});

test("non-recoverable operational writes remain excluded while queue is allowed only with durable recovery",async()=>{
  const api=await read("lib/api-client.ts");
  const queue=await read("app/queue/page.tsx");
  const recovery=await read("lib/queue-action-recovery.mjs");
  const setStart=api.indexOf("const RECOVERABLE_WRITE_PATHS");
  const setEnd=api.indexOf("]);",setStart);
  const allowlist=api.slice(setStart,setEnd);
  for(const path of [
    "/api/close-day"
  ]) assert.doesNotMatch(allowlist,new RegExp(path.replaceAll("/","\\/")));
  assert.match(allowlist,/\/api\/pos\/queue/);
  assert.match(allowlist,/\/api\/pos\/void/);
  assert.match(allowlist,/\/api\/pos\/refund/);
  assert.match(allowlist,/\/api\/expenses/);
  assert.match(allowlist,/\/api\/stock\/transactions/);
  assert.match(queue,/queuePendingWrite\(body\)/);
  assert.match(queue,/body:JSON\.stringify\(pending\.body\)/);
  assert.match(recovery,/shouldRetainQueuePending/);
  const expenses=await read("app/expenses/page.tsx");
  const expenseClient=await read("lib/expense-client.ts");
  const expenseRecovery=await read("lib/expense-recovery.mjs");
  assert.match(expenses,/sendExpenseDurably\(session\.csrf,body\)/);
  assert.match(expenseClient,/writePendingExpense\(body\)/);
  assert.match(expenseClient,/body:JSON\.stringify\(pending\.body\)/);
  assert.match(expenseClient,/validateExpenseAck\(response,pending\.body\)/);
  assert.ok(expenseClient.indexOf("writePendingExpense(body)")<expenseClient.indexOf("api<any>(\"/api/expenses\""));
  assert.match(expenseRecovery,/shouldRetainExpensePending/);
  const stock=await read("app/stock/page.tsx");
  const stockRecovery=await read("lib/stock-transaction-recovery.mjs");
  assert.match(stock,/stockPendingWrite\(body\)/);
  assert.match(stock,/body:JSON\.stringify\(pending\.body\)/);
  assert.match(stockRecovery,/shouldRetainStockPending/);
  const orders=await read("app/orders/page.tsx");
  const orderRecovery=await read("lib/order-mutation-recovery.mjs");
  assert.match(orders,/orderMutationPendingWrite\(kind,body\)/);
  assert.match(orders,/body:JSON\.stringify\(pending\.body\)/);
  assert.match(orderRecovery,/shouldRetainOrderMutationPending/);
});

test("client still never retries or deduplicates writes after an ambiguous timeout",async()=>{
  const api=await read("lib/api-client.ts");
  const start=api.indexOf("export async function api");
  const block=api.slice(start);
  assert.match(block,/Writes are never deduplicated or retried here/);
  assert.match(block,/return executeApi<T>\(path,init,method\)/);
  assert.doesNotMatch(block,/RECOVERABLE_WRITE_PATHS.*retry/s);
});

test("cash and offline checkout retain durable recovery across transport timeout ambiguity",async()=>{
  const pos=await read("app/pos/page.tsx");
  const offline=await read("lib/offline-sales.ts");
  assert.match(pos,/cashPendingWrite/);
  assert.match(pos,/shouldRetainCashPending\(e\)/);
  assert.match(offline,/body:JSON\.stringify\(row\.body\)/);
  assert.match(offline,/throw error/);
});
