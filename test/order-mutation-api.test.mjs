import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createClient} from "@libsql/client";
import {SCHEMA} from "../lib/schema.mjs";
import {checkoutPos,queuePosAction,voidSale,refundSale} from "../lib/pos-api.mjs";
import {bangkokDate} from "../lib/time.mjs";

const owner={id:"owner",role:"admin",permissions:{}},other={id:"other",role:"admin",permissions:{}};
const seed=()=>({menu:[{id:"latte",enabled:true,price:55,name:"Latte",variants:[{label:"100%",recipe:{items:{matcha:5,milk:110}}}]}],ingredients:{matcha:{qty:1000,unit:"g",unitCost:2},milk:{qty:30000,unit:"g",unitCost:.06}},settings:{pagerCount:10},sales:[],orders:[],billSeq:{},expenses:[]});
async function setup(t){
  const dir=await mkdtemp(join(tmpdir(),"field-order-mutation-")),db=createClient({url:"file:"+join(dir,"test.db")});
  t.after(async()=>{db.close();try{await rm(dir,{recursive:true,force:true})}catch(error){if(process.platform!=="win32"||error.code!=="EBUSY")throw error}});
  await db.batch(SCHEMA,"write");
  await db.execute({sql:"INSERT INTO field_users(id,username,password_hash,role,created_at,updated_at) VALUES('owner','owner','unused','admin',0,0)",args:[]});
  await db.execute({sql:"UPDATE field_state SET document=? WHERE singleton=1",args:[JSON.stringify(seed())]});
  return db;
}
async function state(db){return JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document)}
async function sell(db,key){return checkoutPos({db,user:owner,body:{requestKey:key,cart:[{id:"latte",variant:"100%",qty:1}],date:bangkokDate(),payment:"cash",received:100}})}

test("real libSQL VOID exact replay restores stock and audit only once",async t=>{
  const db=await setup(t),paid=await sell(db,"void-checkout-0001"),before=await state(db),sale=before.sales.find(x=>x.id===paid.saleIds[0]);
  const body={requestKey:"void-ledger-0001",saleId:sale.id,reason:"ลูกค้ายกเลิก",riskConfirmed:true,expectedDate:sale.date,expectedAmount:sale.total};
  const first=await voidSale({db,user:owner,body,now:2000});
  assert.equal(first.action,"void");assert.equal(first.stockRestored,true);assert.equal(first.voidAmount,55);assert.equal((await state(db)).ingredients.matcha.qty,1000);
  const reversalCount=Number((await db.execute("SELECT COUNT(*) AS n FROM field_stock_transactions WHERE tx_type='VOID_REVERSAL'")).rows[0].n);
  const replay=await voidSale({db,user:owner,body,now:2010});
  assert.equal(replay.replayed,true);assert.equal(replay.requestKey,body.requestKey);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_stock_transactions WHERE tx_type='VOID_REVERSAL'")).rows[0].n),reversalCount);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_audit WHERE action='sale_void'")).rows[0].n),1);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_pos_requests WHERE request_key='void-ledger-0001'")).rows[0].n),1);
  await assert.rejects(()=>voidSale({db,user:owner,body:{...body,reason:"เปลี่ยนเหตุผล"},now:2020}),/request_key_conflict/);
  await assert.rejects(()=>voidSale({db,user:other,body,now:2030}),/request_key_conflict/);
});

test("VOID target snapshot rejects stale amount before stock reversal",async t=>{
  const db=await setup(t),paid=await sell(db,"void-target-checkout"),doc=await state(db),sale=doc.sales.find(x=>x.id===paid.saleIds[0]);
  await assert.rejects(()=>voidSale({db,user:owner,body:{requestKey:"void-target-0001",saleId:sale.id,reason:"ลูกค้ายกเลิก",riskConfirmed:true,expectedDate:sale.date,expectedAmount:56}}),/void_target_changed/);
  assert.equal((await state(db)).sales[0].status,"paid");
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_stock_transactions WHERE tx_type='VOID_REVERSAL'")).rows[0].n),0);
});

test("real libSQL Refund exact replay creates one accounting effect and binds actor payload",async t=>{
  const db=await setup(t),paid=await sell(db,"refund-checkout-0001");
  await queuePosAction({db,user:owner,body:{requestKey:"start-production-0001",orderId:paid.orderId,action:"start",itemIndex:0,unit:1}});
  const doc=await state(db),sale=doc.sales.find(x=>x.id===paid.saleIds[0]);
  const body={requestKey:"refund-ledger-0001",saleId:sale.id,reason:"คืนเงินลูกค้า",riskConfirmed:true,manualConfirmed:false,manualReference:"",expectedDate:sale.date,expectedRefundAmount:sale.total,expectedSaleIds:[sale.id]};
  const first=await refundSale({db,user:owner,body,now:3000});
  assert.equal(first.action,"refund");assert.equal(first.refundAmount,55);assert.equal(first.stockRestored,false);
  const afterFirst=await state(db);assert.equal(afterFirst.sales[0].status,"refunded");assert.equal(afterFirst.expenses.filter(x=>x.sourceType==="STOCK_REFUND_LOSS").length,1);
  const replay=await refundSale({db,user:owner,body,now:3010});
  assert.equal(replay.replayed,true);assert.deepEqual(replay.saleIds,[sale.id]);
  const afterReplay=await state(db);assert.equal(afterReplay.expenses.filter(x=>x.sourceType==="STOCK_REFUND_LOSS").length,1);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_audit WHERE action='sale_refund'")).rows[0].n),1);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_pos_requests WHERE request_key='refund-ledger-0001'")).rows[0].n),1);
  await assert.rejects(()=>refundSale({db,user:owner,body:{...body,reason:"เปลี่ยนเหตุผล"},now:3020}),/request_key_conflict/);
  await assert.rejects(()=>refundSale({db,user:other,body,now:3030}),/request_key_conflict/);
});

test("Refund target snapshot rejects changed sale group before mutation",async t=>{
  const db=await setup(t),paid=await sell(db,"refund-target-checkout");
  await queuePosAction({db,user:owner,body:{requestKey:"start-production-0002",orderId:paid.orderId,action:"start",itemIndex:0,unit:1}});
  const doc=await state(db),sale=doc.sales.find(x=>x.id===paid.saleIds[0]);
  await assert.rejects(()=>refundSale({db,user:owner,body:{requestKey:"refund-target-0001",saleId:sale.id,reason:"คืนเงิน",riskConfirmed:true,manualConfirmed:false,manualReference:"",expectedDate:sale.date,expectedRefundAmount:sale.total,expectedSaleIds:[sale.id,"missing-sale"]}}),/refund_target_changed/);
  assert.equal((await state(db)).sales[0].status,"paid");
});
