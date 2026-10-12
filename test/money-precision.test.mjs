import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isSatangAmount,roundSatang} from '../lib/domain/money.mjs';
import {normalizeStockWrite} from '../lib/stock-service.mjs';
import {createDeliveryReconciliation} from '../lib/domain/delivery-reconciliation.mjs';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('satang guard accepts real THB amounts and rejects sub-satang values',()=>{
  for(const value of [0,0.01,0.1,0.29,12.34,100,9999999.99])assert.equal(isSatangAmount(value),true,String(value));
  for(const value of [0.001,0.009,1.005,12.345,NaN,Infinity,-Infinity])assert.equal(isSatangAmount(value),false,String(value));
  assert.equal(roundSatang(12.34),12.34);
  assert.equal(roundSatang(10.1+0.2),10.3);
});

test('stock purchase accepts satang totals but rejects sub-satang purchase cost',()=>{
  const base={requestKey:'money-test-001',ingredientId:'milk',type:'PURCHASE',qtyDelta:1000,unit:'ml',purchaseDate:'2026-10-12',purchasePaymentMethod:'cash'};
  const ok=normalizeStockWrite({...base,purchaseCost:105.5},{actorId:'admin',now:Date.parse('2026-10-12T05:00:00Z')});
  assert.equal(ok.purchaseCost,105.5);
  assert.throws(
    ()=>normalizeStockWrite({...base,requestKey:'money-test-002',purchaseCost:105.555},{actorId:'admin',now:Date.parse('2026-10-12T05:00:00Z')}),
    /invalid_purchase_cost/
  );
});

test('delivery settlement does not silently round operator-entered sub-satang evidence',()=>{
  const sales=[{id:'sale-1',date:'2026-10-12',status:'paid',salesChannel:'delivery',deliveryPlatform:'grab',total:100,gpFee:20,netSettlement:80}];
  const ok=createDeliveryReconciliation({sales,reconciliations:[],saleDate:'2026-10-12',platform:'grab',receivedAmount:80,receivedDate:'2026-10-12',now:1,userId:'admin'});
  assert.equal(ok.receivedAmount,80);
  assert.throws(
    ()=>createDeliveryReconciliation({sales,reconciliations:[],saleDate:'2026-10-12',platform:'grab',receivedAmount:80.001,receivedDate:'2026-10-12',now:2,userId:'admin'}),
    /invalid_received_amount/
  );
});

test('server transaction boundaries enforce whole-satang monetary input',async()=>{
  const api=await read('lib/api.mjs');
  const pos=await read('lib/pos-api.mjs');

  assert.match(api,/totalCost<0\|\|!isSatangAmount\(totalCost\)/);
  assert.match(api,/amount<=0\|\|amount>1e7\|\|!isSatangAmount\(amount\)/);
  assert.match(api,/openingCash>1e7\|\|!isSatangAmount\(openingCash\)/);
  assert.match(api,/countedCash>1e7\|\|!isSatangAmount\(countedCash\)/);
  assert.match(api,/receivedRaw<0\|\|!isSatangAmount\(receivedRaw\)/);
  assert.match(api,/price>100000\|\|!isSatangAmount\(price\)/);
  assert.match(api,/v>100000\|\|!isSatangAmount\(v\)/);

  assert.match(pos,/!isSatangAmount\(menu\.price\).*invalid_money_precision/);
  assert.match(pos,/!isSatangAmount\(body\.received\).*invalid_money_precision/);
  assert.match(pos,/!isSatangAmount\(loyalty\.subtotal\).*invalid_money_precision/);
});

test('ingredient costing precision remains independent from satang transaction validation',async()=>{
  const costing=await read('lib/domain/costing.mjs');
  const money=await read('lib/domain/money.mjs');
  assert.doesNotMatch(costing,/isSatangAmount/);
  assert.match(money,/transaction boundaries/);
  assert.match(money,/ingredient unit costs/);
});
