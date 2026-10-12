import test from 'node:test';
import assert from 'node:assert/strict';
import {dailyReport} from '../lib/domain/daily-report.mjs';
import {stockReportRows} from '../lib/domain/stock-report.mjs';
import {toCsv,reportFilename} from '../lib/report-csv.mjs';
import {bangkokDate} from '../lib/time.mjs';
const date='2026-10-09';
test('daily financial report excludes other dates, VOID and refunds',()=>{
  const sale={date,status:'paid',total:550,costTotal:196,items:[{qty:10,costStatus:'CONFIRMED'}],payment:'cash'};
  const result=dailyReport({sales:[sale,{...sale,date:'2026-10-08'},{...sale,status:'void'},{...sale,status:'refunded'}],expenses:[{date,category:'OTHER',amount:80},{date:'2026-10-08',amount:1000}]},date);
  assert.equal(result.revenue,550);assert.equal(result.cups,10);assert.equal(result.orders,1);assert.equal(result.operatingProfit,274);
});
test('stock purchases are separate from consumed COGS and operating expenses',()=>{
  const result=dailyReport({sales:[{date,status:'paid',total:100,costTotal:20}],expenses:[{date,category:'PURCHASE',amount:500},{date,category:'OTHER',amount:10}],cashMovements:[{date,type:'CASH_IN',amount:1000}]},date);
  assert.equal(result.purchaseSpend,500);assert.equal(result.operatingExpenses,10);assert.equal(result.operatingProfit,70);assert.equal(result.totalCashOut,510);
});
test('mixed payments reconcile to revenue while drawer result remains hidden until close',()=>{
  const doc={sales:[{date,status:'paid',total:100,payments:[{method:'cash',amount:40},{method:'bank',amount:60}]}],cashShifts:[{date,openingCash:500}]};
  const open=dailyReport(doc,date);assert.equal(open.cashSales,40);assert.equal(open.bankSales,60);assert.equal(open.expectedCash,null);assert.equal(open.cashVariance,null);
  const closed=dailyReport({...doc,closes:[{date,expectedCash:540,countedCash:535,cashVariance:-5}]},date);
  assert.equal(closed.closed,true);assert.equal(closed.cashVariance,-5);
});
test('stock CSV keeps zero and negative balances visible without negative asset value',()=>{
  const rows=stockReportRows({zero:{qty:0,unitCost:2},short:{qty:-2,unitCost:3},available:{qty:10,unitCost:2}});
  assert.equal(rows.length,3);assert.equal(rows[1].qty,-2);assert.equal(rows[1].value,0);assert.equal(rows[1].reconciliationRequired,true);assert.equal(rows[2].value,20);
});
test('CSV preserves Thai, quotes, commas and CR/LF in descriptions',()=>{
  const csv=toCsv([{name:'ชา, "เย็น"',description:'บรรทัด1\rบรรทัด2\nจบ',amount:55}]);
  assert.equal(csv,'name,description,amount\r\n"ชา, ""เย็น""","บรรทัด1\rบรรทัด2\nจบ",55');
});
test('report filename follows Thai business date across UTC midnight',()=>{
  const now=Date.parse('2026-10-08T17:30:00Z');
  assert.equal(reportFilename('sales',bangkokDate(now)),'FIELD_sales_2026-10-09.csv');
  assert.throws(()=>reportFilename('sales',''),/report_business_date_required/);
});
