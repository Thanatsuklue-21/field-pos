import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("admin PromptPay reconciliation notifies kitchen after completed finalization",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("if(path==='/api/pos/payment-resolutions/reconcile'");
  const end=api.indexOf("if(path==='/api/pos/split/resolve'",start);
  const block=api.slice(start,end);
  const pay=block.indexOf("const result=await paySplitPayment");
  const notify=block.indexOf("if(result.completed)await notifyKitchenPayment",pay);
  const response=block.indexOf("outcome:'finalized'",pay);
  assert.ok(pay>=0,"reconcile must finalize through paySplitPayment");
  assert.ok(notify>pay,"kitchen notification must happen after payment finalization");
  assert.ok(response>notify,"finalized response must not precede durable kitchen notification attempt");
  assert.match(block,/sessionId:ctx\.id,orderId:result\.orderId,queueNo:result\.queueNo,total:ctx\.total/);
});
