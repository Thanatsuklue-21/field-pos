import assert from 'node:assert/strict';
import {SCHEMA} from '../lib/schema.mjs';
import {hashPassword} from '../lib/security.mjs';
import {bangkokDate} from '../lib/time.mjs';

export async function seedTenCupDatabase(db){
  await db.batch(SCHEMA,'write');
  assert.equal(Number((await db.execute('SELECT COUNT(*) AS n FROM field_users')).rows[0].n),0,'QA requires a new empty database');
  const now=Date.now();
  await db.execute({sql:'INSERT INTO field_users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,?)',args:['ten-cup-owner','qaoperator',await hashPassword('LocalQaOnly2026!'),'admin',now,now]});
  const doc={menu:[{id:'qa-latte',name:'QA Matcha Latte',price:55,enabled:true,variants:[{label:'100%',recipe:{items:{matcha:5,milk:110,cup:1}}}]}],
    ingredients:{matcha:{name:'Matcha',unit:'g',qty:1000,unitCost:2,costStatus:'CONFIRMED'},milk:{name:'Milk',unit:'ml',qty:30000,unitCost:0.06,costStatus:'CONFIRMED'},cup:{name:'Cup',unit:'piece',qty:500,unitCost:3,costStatus:'CONFIRMED'}},
    settings:{pagerCount:10},sales:[],orders:[],expenses:[],closes:[],billSeq:{}};
  await db.execute({sql:'UPDATE field_state SET document=? WHERE singleton=1',args:[JSON.stringify(doc)]});
}

export async function runTenCupScenario(call){
  const date=bangkokDate(),receipts=[];
  await call('cash-shift/open','POST',{openingCash:500},201);
  await call('cash-shift/movements','POST',{type:'CASH_IN',amount:100,reason:'QA extra change'},201);
  for(let i=1;i<=10;i++){
    const body={requestKey:'ten-cup-sale-'+i,date,cart:[{id:'qa-latte',variant:'100%',qty:1}],payment:'cash',received:100};
    const receipt=await call('pos/checkout','POST',body);
    assert.equal(receipt.total,55);assert.equal(receipt.change,45);receipts.push(receipt);
    const replay=await call('pos/checkout','POST',body);assert.equal(replay.orderId,receipt.orderId);assert.equal(replay.replayed,true);
    for(const [action,extra] of [['select',{itemIndex:0,selected:true}],['complete_item',{itemIndex:0,expectedReadyQty:0}],['call',{}],['return',{}]]){
      await call('pos/queue','POST',{requestKey:`ten-cup-${i}-${action}`,orderId:receipt.orderId,action,...extra});
    }
  }
  await call('expenses','POST',{amount:50,category:'OTHER',description:'QA cleaning cash',paymentMethod:'cash',date},201);
  await call('expenses','POST',{amount:30,category:'OTHER',description:'QA utility bank',paymentMethod:'bank',date},201);
  await call('cash-shift/movements','POST',{type:'CASH_OUT',amount:200,reason:'QA store surplus'},201);
  const beforeClose=await call('reports/summary');
  assert.equal(beforeClose.todaySummary.expectedCash,null,'blind count remains independent before close');
  const {close}=await call('close-day','POST',{countedCash:900},201);
  const summary=await call('reports/summary'),exported=await call('reports/accounting-export'),bootstrap=await call('pos/bootstrap'),history=await call('pos/history'),queue=await call('pos/queue');
  const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
  for(const report of [close,summary.todaySummary]){
    assert.equal(report.revenue,550);near(report.cogs,196);near(report.grossProfit,354);near(report.operatingProfit,274);
    assert.equal(report.cups,10);assert.equal(report.orders,10);assert.equal(report.expectedCash,900);assert.equal(report.countedCash,900);assert.equal(report.cashVariance,0);
  }
  assert.equal(close.expenses,80);assert.equal(close.cash,550);assert.equal(close.cashPaidOut,50);assert.equal(close.cashIn,100);assert.equal(close.cashOut,200);
  assert.equal(summary.todaySummary.operatingExpenses,80);assert.equal(summary.todaySummary.purchaseSpend,0);
  for(const [id,remaining] of Object.entries({matcha:950,milk:28900,cup:490})){
    assert.equal(bootstrap.availabilityStock[id].qty,remaining);
    assert.equal(exported.stock.find(row=>row.ingredientId===id).qty,remaining);
  }
  assert.equal(exported.sales.length,10);assert.equal(exported.saleItems.length,10);assert.equal(exported.expenses.length,2);
  assert.equal(exported.saleItems.reduce((n,row)=>n+row.qty,0),10);assert.equal(exported.sales.reduce((n,row)=>n+row.net,0),550);
  near(exported.sales.reduce((n,row)=>n+row.cogs,0),196);assert.equal(exported.businessDate,date);
  assert.equal(exported.dailySummary[0].cashVariance,0);assert.equal(summary.paymentSummary.cash,550);
  near(summary.inventoryValue,5104);assert.equal(queue.orders.length,0);
  assert.equal(history.sales.length,10);assert.equal(new Set(receipts.map(row=>row.billNo)).size,10);
  await call('pos/checkout','POST',{requestKey:'ten-cup-after-close',date,cart:[{id:'qa-latte',variant:'100%',qty:1}],payment:'cash',received:100},409);
  return {date,assumptions:{cups:10,pricePerCup:55,receivedPerCup:100,recipe:{matcha:5,milk:110,cup:1},openingCash:500,cashIn:100,cashOut:200,cashExpense:50,bankExpense:30},close,summary,exported,stock:bootstrap.availabilityStock,receipts};
}
