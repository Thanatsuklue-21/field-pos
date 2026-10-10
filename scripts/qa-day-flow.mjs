// Isolated QA only: always creates a new local DB, never reads Turso credentials.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setImmediate} from 'node:timers/promises';
import {createClient} from '@libsql/client';
import {createApi} from '../lib/api.mjs';
import {seedTenCupDatabase} from './qa-ten-cup-scenario.mjs';
import {bangkokDate} from '../lib/time.mjs';
import {toCsv} from '../lib/report-csv.mjs';

export async function runDayFlow({extraBankExpense=0,countedCash=514.25,receivedDeliveryAmount=77.34}={}){
 const dir=await mkdtemp(join(tmpdir(),'field-day-flow-')),db=createClient({url:'file:'+join(dir,'qa.db')});
 try{
  await seedTenCupDatabase(db);
  const doc=JSON.parse((await db.execute('SELECT document FROM field_state')).rows[0].document);
  doc.menu[0].price=55.25;doc.settings.deliveryGp={grab:.3};
  await db.execute({sql:'UPDATE field_state SET document=? WHERE singleton=1',args:[JSON.stringify(doc)]});
  const handler=createApi({db,origin:'https://field.test'}),date=bangkokDate(),trace=[],bills=[];let cookie='',csrf='';
  const call=async(route,method='GET',body,expected=200)=>{
   const res={writeHead(status,headers){this.status=status;this.headers=headers},end(raw){this.body=JSON.parse(raw)}};
   await handler({method,query:{route},headers:{origin:'https://field.test',cookie,'x-csrf-token':csrf},body},res);await setImmediate();
   trace.push({route,method,status:res.status,error:res.body.error||null});
   assert.equal(res.status,expected,route+': '+JSON.stringify(res.body).slice(0,250));
   if(route==='auth/login'){cookie=res.headers['Set-Cookie'].split(';')[0];csrf=res.body.csrf}return res.body;
  };
  await call('pos/bootstrap','GET',undefined,401);
  await call('auth/login','POST',{username:'qaoperator',password:'LocalQaOnly2026!'});
  await call('cash-shift/open','POST',{openingCash:500.10},201);
  await call('cash-shift/open','POST',{openingCash:999},409);
  await call('cash-shift/movements','POST',{type:'CASH_IN',amount:100.20,reason:'QA float'},201);
  const methods=['cash','cash','cash','bank','bank','bank','card','card','other','other','cash','cash'];
  for(let i=0;i<methods.length;i++){
   const payment=methods[i],body={requestKey:'day-flow-sale-'+i,date,cart:[{id:'qa-latte',variant:'100%',qty:1}],payment,received:100,salesChannel:payment==='other'?'grab':'store'};
   const receipt=await call('pos/checkout','POST',body);assert.equal(receipt.total,55.25);if(payment==='cash')assert.equal(receipt.change,44.75);
   assert.equal((await call('pos/checkout','POST',body)).orderId,receipt.orderId);
   if(i===0)await call('close-day','POST',{countedCash:555.35},409);
   if(i===10){await call('pos/void','POST',{requestKey:'day-flow-void',saleId:receipt.saleIds[0],reason:'QA cancelled before production'});bills.push({...receipt,payment,finalStatus:'void'});continue}
   for(const action of ['complete_item','call','return'])await call('pos/queue','POST',{requestKey:`day-flow-${i}-${action}`,orderId:receipt.orderId,action,itemIndex:0,expectedReadyQty:0});
   if(i===11){
    const body={requestKey:'day-flow-refund',saleId:receipt.saleIds[0],reason:'QA refund after handoff'};
    const refunded=await call('pos/refund','POST',body);assert.equal(refunded.stockRestored,false);assert.equal(refunded.refundAmount,55.25);
    assert.equal((await call('pos/refund','POST',body)).replayed,true);
   }
   bills.push({...receipt,payment,finalStatus:i===11?'refunded':'paid'});
  }
  await call('stock/transactions','POST',{requestKey:'day-flow-purchase',ingredientId:'cup',type:'PURCHASE',qtyDelta:20,unit:'piece',purchaseCost:60,purchaseDate:date,purchasePaymentMethod:'bank'},201);
  await call('expenses','POST',{amount:50.25,category:'OTHER',description:'QA cleaning',paymentMethod:'cash',date},201);
  await call('expenses','POST',{amount:80.25+extraBankExpense,category:'UTILITY',description:'QA electricity',paymentMethod:'bank',date},201);
  assert.equal((await call('expenses','POST',{amount:1,category:'OTHER',paymentMethod:'cash_typo',date},400)).error,'invalid_expense_payment_method');
  await call('cash-shift/movements','POST',{type:'CASH_OUT',amount:200.30,reason:'QA safe deposit'},201);
  await call('cash-shift/movements','POST',{type:'CASH_OUT',amount:99999,reason:'QA shortage guard'},409);
  assert.equal((await call('reports/summary')).todaySummary.expectedCash,null);
  const {close}=await call('close-day','POST',{countedCash},201);
  const summary=await call('reports/summary'),dashboard=await call('management/dashboard'),exported=await call('reports/accounting-export'),stock=(await call('pos/bootstrap')).availabilityStock;
  const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
  for(const report of [close,summary.todaySummary]){
   near(report.revenue,552.50);near(report.cogs,196);near(report.grossProfit,356.50);near(report.deliveryFees,33.16);near(report.operatingProfit,173.24-extraBankExpense);
   assert.equal(report.orders,10);assert.equal(report.cups,10);assert.equal(report.expectedCash,515.50);assert.equal(report.countedCash,countedCash);near(report.cashVariance,countedCash-515.50);
  }
  near(close.expenses,150.10+extraBankExpense);assert.equal(close.purchaseSpend,60);near(close.cash,165.75);near(close.bank,165.75);near(close.card,110.50);near(close.other,110.50);
  near(dashboard.operatingProfit,close.operatingProfit);near(dashboard.deliveryFees,33.16);
  assert.equal(stock.matcha.qty,945);assert.equal(stock.milk.qty,28790);assert.equal(stock.cup.qty,509);
  assert.equal(exported.sales.length,12);assert.equal(exported.sales.filter(s=>s.status==='paid').length,10);assert.equal(new Set(bills.map(b=>b.billNo)).size,12);
  assert.equal((await call('pos/queue')).orders.length,0);
  const pendingSettlements=await call('accounting/settlements');
  near(pendingSettlements.pending[0].expectedAmount,77.34);
  const {reconciliation}=await call('accounting/settlements','POST',{saleDate:date,platform:'grab',receivedAmount:receivedDeliveryAmount,receivedDate:date,note:'Synthetic settlement evidence only'},201);
  near(reconciliation.variance,receivedDeliveryAmount-77.34);
  assert.equal(reconciliation.status,receivedDeliveryAmount===77.34?'matched':'variance');
  await call('accounting/settlements','POST',{saleDate:date,platform:'grab',receivedAmount:receivedDeliveryAmount,receivedDate:date},409);
  await call('close-day','POST',{countedCash},409);
  await call('pos/checkout','POST',{requestKey:'after-day-close',date,cart:[{id:'qa-latte',variant:'100%',qty:1}],payment:'cash',received:100},409);
  await call('expenses','POST',{amount:1,category:'OTHER',paymentMethod:'cash',date},409);
  const raw=JSON.parse((await db.execute('SELECT document FROM field_state')).rows[0].document);
  assert.equal(raw.expenses.filter(e=>e.sourceType==='STOCK_REFUND_LOSS').length,1);
  return {date,fixture:true,realProviderPayment:false,productionWrites:false,apiCalls:trace.length,extraBankExpense,bills,close,summary,dashboard,exported,stock,reconciliation,trace};
 }finally{db.close()}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const output=resolve(process.argv[2]||'day-flow-qa-output');await mkdir(output,{recursive:true});
 for(const [name,options]of [['profit-shortage',{}],['loss-balanced',{extraBankExpense:1000,countedCash:515.50,receivedDeliveryAmount:76.34}]]){
  const result=await runDayFlow(options);
  await writeFile(join(output,name+'.json'),JSON.stringify(result,null,2));
  for(const kind of ['dailySummary','sales','saleItems','expenses','stock','cashMovements'])await writeFile(join(output,`${name}_${kind}.csv`),'\ufeff'+toCsv(result.exported[kind]));
  await writeFile(join(output,name+'_bills.csv'),'\ufeff'+toCsv(result.bills));
  await writeFile(join(output,name+'_settlement.csv'),'\ufeff'+toCsv([result.reconciliation]));
  console.log(JSON.stringify({scenario:name,calls:result.apiCalls,revenue:result.close.revenue,operatingProfit:result.close.operatingProfit,expectedCash:result.close.expectedCash,cashVariance:result.close.cashVariance}));
 }
}
