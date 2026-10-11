import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {orderMutationPath,shouldRetainOrderMutationPending,validateOrderMutationAck,validatePendingOrderMutation} from "../lib/order-mutation-recovery.mjs";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("order mutation pending record requires stable VOID or Refund identity",()=>{
  for(const kind of ["void","refund"]){
    const row={kind,body:{requestKey:kind+"-request-0001",saleId:"sale-1",reason:"operator reason"},createdAt:1};
    assert.equal(validatePendingOrderMutation(row),row);
  }
  const badRows=[
    null,
    {kind:"edit",body:{requestKey:"edit-request-0001",saleId:"sale-1",reason:"x"},createdAt:1},
    {kind:"void",body:null,createdAt:1},
    {kind:"void",body:{requestKey:"x",saleId:"sale-1",reason:"x"},createdAt:1},
    {kind:"void",body:{requestKey:"void-request-0001",saleId:"",reason:"x"},createdAt:1},
    {kind:"void",body:{requestKey:"void-request-0001",saleId:"sale-1",reason:1},createdAt:1},
    {kind:"void",body:{requestKey:"void-request-0001",saleId:"sale-1",reason:"x"},createdAt:0}
  ];
  for(const bad of badRows)assert.throws(()=>validatePendingOrderMutation(bad),/order_mutation_recovery_corrupt/);
});

test("order mutation path is deterministic and invalid kinds fail closed",()=>{
  assert.equal(orderMutationPath("void"),"/api/pos/void");
  assert.equal(orderMutationPath("refund"),"/api/pos/refund");
  assert.throws(()=>orderMutationPath("other"),/order_mutation_recovery_corrupt/);
});

test("VOID and Refund pending are retained only for ambiguous outcomes",()=>{
  const ambiguous=[0,408,425,429,503];
  for(const status of ambiguous)assert.equal(shouldRetainOrderMutationPending(Object.assign(new Error("e"),{status})),true);
  for(const status of [400,401,403,404,409,422])assert.equal(shouldRetainOrderMutationPending(Object.assign(new Error("e"),{status})),false);
});

test("VOID and Refund clear pending only after acknowledgement for the original sale",()=>{
  for(const [kind,field] of [["void","voidAmount"],["refund","refundAmount"]]){
    const pending={kind,body:{requestKey:kind+"-ack-0001",saleId:"sale-1",reason:"x"},createdAt:1};
    const good={ok:true,saleId:"sale-1",saleIds:["sale-1","sale-2"],[field]:55};
    assert.equal(validateOrderMutationAck(good,pending),good);
    const badRows=[
      null,
      {},
      {ok:false,saleId:"sale-1",saleIds:["sale-1"],[field]:55},
      {ok:true,saleId:"sale-2",saleIds:["sale-1"],[field]:55},
      {ok:true,saleId:"sale-1",saleIds:["sale-2"],[field]:55},
      {ok:true,saleId:"sale-1",saleIds:["sale-1"],[field]:NaN}
    ];
    for(const bad of badRows)assert.throws(()=>validateOrderMutationAck(bad,pending),/order_mutation_unconfirmed/);
  }
});

test("Orders UI persists exact mutation before send and replays on reconnect",async()=>{
  const ui=await read("app/orders/page.tsx");
  const start=ui.indexOf("async function sendOrderMutation");
  const end=ui.indexOf("useEffect(()=>",start);
  const block=ui.slice(start,end);
  assert.match(block,/orderMutationPendingWrite\(kind,body\)/);
  assert.match(block,/body:JSON\.stringify\(pending\.body\)/);
  assert.ok(block.indexOf("orderMutationPendingWrite(kind,body)")<block.indexOf("api<any>(orderMutationPath"));
  assert.ok(block.indexOf("validateOrderMutationAck(r,pending)")<block.indexOf("orderMutationPendingClear()"));
  assert.match(ui,/window\.addEventListener\("online",onOnline\)/);
  assert.match(ui,/window\.addEventListener\("focus",onFocus\)/);
  assert.match(ui,/document\.addEventListener\("visibilitychange",onVisible\)/);
  assert.match(ui,/orderMutationRecoveryRef/);
});

test("VOID and Refund UI use durable sender instead of direct mutation API calls",async()=>{
  const ui=await read("app/orders/page.tsx");
  const refundStart=ui.indexOf("async function refundSaleUi");
  const voidStart=ui.indexOf("async function voidCash",refundStart);
  const refundBlock=ui.slice(refundStart,voidStart);
  const voidEnd=ui.indexOf("async function editCashOrder",voidStart);
  const voidBlock=ui.slice(voidStart,voidEnd);
  assert.match(refundBlock,/sendOrderMutation\("refund",body\)/);
  assert.doesNotMatch(refundBlock,/api<any>\("\/api\/pos\/refund"/);
  assert.match(voidBlock,/sendOrderMutation\("void",body\)/);
  assert.doesNotMatch(voidBlock,/api<any>\("\/api\/pos\/void"/);
});

test("server replay checks VOID and Refund request keys before stock or CRM effects",async()=>{
  const pos=await read("lib/pos-api.mjs");
  const voidStart=pos.indexOf("export async function voidSale");
  const refundStart=pos.indexOf("export async function refundSale");
  const voidBlock=pos.slice(voidStart,refundStart);
  const splitStart=pos.indexOf("export async function startSplitPayment",refundStart);
  const refundBlock=pos.slice(refundStart,splitStart);
  assert.ok(voidBlock.indexOf("sale.voidRequestKey===body.requestKey")>0);
  assert.ok(voidBlock.indexOf("sale.voidRequestKey===body.requestKey")<voidBlock.indexOf("field_stock_transactions"));
  assert.ok(refundBlock.indexOf("sale.refundRequestKey===body.requestKey")>0);
  assert.ok(refundBlock.indexOf("sale.refundRequestKey===body.requestKey")<refundBlock.indexOf("field_stock_transactions"));
});