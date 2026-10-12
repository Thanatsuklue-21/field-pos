import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import ts from "typescript";

const source=ts.transpileModule(await readFile(new URL("../lib/offline-sales.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const verified={csrf:"verified-token",user:{id:"operator"}};
const shortageReceipt={ok:true,orderId:"order-offline-1",saleIds:["sale-offline-1"],total:55,offlineFulfilled:true,stockReconciliationRequired:true,stockShortages:[{ingredientId:"matcha",available:2,required:5,deficit:3}]};

function runtime({row,response=shortageReceipt}={}){
  let calls=0,deletes=0;
  const rows=[row||{requestKey:"offline-key",localNo:"OFF-123456",createdAt:1,status:"pending",attempts:0,body:{requestKey:"offline-key",total:55,offlineFulfilled:true}}],exports={};
  runInNewContext(source,{exports,Date,Error,navigator:{onLine:true},require(path){
    if(path==="@/lib/domain/availability.mjs")return {};
    if(path==="@/lib/api-client")return {api:async()=>{calls++;return response}};
    if(path==="@/lib/offline-db")return {
      offlineCashList:async()=>rows.map(item=>({...item,acceptedSaleIds:item.acceptedSaleIds?[...item.acceptedSaleIds]:undefined,stockShortages:item.stockShortages?item.stockShortages.map(x=>({...x})):undefined})),
      offlineCashPatch:async(key,patch)=>Object.assign(rows.find(item=>item.requestKey===key),patch),
      offlineCashDelete:async key=>{deletes++;const i=rows.findIndex(item=>item.requestKey===key);if(i>=0)rows.splice(i,1)}
    };
    throw Error(path);
  }});
  return {exports,rows,get calls(){return calls},get deletes(){return deletes}};
}

test("accepted Offline sale with a stock deficit stays visible for reconciliation and is never resent",async()=>{
  const r=runtime();
  const first=await r.exports.syncOfflineCashSales(verified);
  assert.equal(first.synced,1);
  assert.equal(first.pending,0);
  assert.equal(first.needsReview,1);
  assert.equal(first.stockReconciliation,1);
  assert.equal(first.businessReview,0);
  assert.equal(r.calls,1);
  assert.equal(r.deletes,0);
  assert.equal(r.rows[0].status,"needs_review");
  assert.equal(r.rows[0].reviewKind,"stock_reconciliation");
  assert.equal(r.rows[0].acceptedOrderId,"order-offline-1");
  assert.deepEqual(Array.from(r.rows[0].acceptedSaleIds),["sale-offline-1"]);
  assert.equal(r.rows[0].stockShortages[0].deficit,3);
  const second=await r.exports.syncOfflineCashSales(verified);
  assert.equal(second.synced,0);
  assert.equal(second.stockReconciliation,1);
  assert.equal(r.calls,1,"resolved Cloud sale must not be submitted twice");
});

test("stock reconciliation acknowledgement only removes a confirmed accepted review",async()=>{
  const r=runtime({row:{requestKey:"offline-key",localNo:"OFF-123456",createdAt:1,status:"needs_review",attempts:1,body:{requestKey:"offline-key",total:55,offlineFulfilled:true},reviewKind:"stock_reconciliation",acceptedOrderId:"order-offline-1",acceptedSaleIds:["sale-offline-1"],acceptedAt:2,stockShortages:[{ingredientId:"matcha",available:2,required:5,deficit:3}]}});
  const reviews=await r.exports.getOfflineCashReviews();
  assert.equal(reviews.length,1);
  assert.equal(reviews[0].reviewKind,"stock_reconciliation");
  const summary=await r.exports.acknowledgeOfflineStockReconciliation("offline-key");
  assert.equal(summary.total,0);
  assert.equal(r.deletes,1);
});

test("business rejection cannot be dismissed through stock reconciliation acknowledgement",async()=>{
  const r=runtime({row:{requestKey:"offline-key",localNo:"OFF-123456",createdAt:1,status:"needs_review",attempts:1,body:{requestKey:"offline-key",total:55,offlineFulfilled:true},reviewKind:"business_rejection",lastError:"day_closed"}});
  await assert.rejects(r.exports.acknowledgeOfflineStockReconciliation("offline-key"),/offline_stock_reconciliation_not_found/);
  assert.equal(r.deletes,0);
  assert.equal(r.rows.length,1);
});

test("cashier UI separates stock reconciliation from rejected bills and requires admin acknowledgement",async()=>{
  const pos=await readFile(new URL("../app/pos/page.tsx",import.meta.url),"utf8");
  for(const token of ["stockReconciliation","businessReview","ซิงก์บิลออฟไลน์แล้ว · ต้องตรวจสต็อกจริง","ตรวจสต็อกจริงแล้ว · ปลดล็อก",'session.user.role==="admin"','setOpsInitialTab("stock")'])assert.ok(pos.includes(token),token);
});
