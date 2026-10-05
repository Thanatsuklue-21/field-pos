import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {applyPurchaseReversal} from '../lib/domain/purchase-reversal.mjs';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('purchase reversal removes received stock and restores previous active cost profile',()=>{
  const ingredient={name:'Matcha',qty:1000,unit:'g',unitCost:4,costStatus:'CONFIRMED',purchaseProfile:{supplier:'Wrong'}};
  const purchase={id:'p2',quantity_received:250,total_cost:1000};
  const previous={id:'p1',quantity_received:500,package_qty:1,package_unit:'ถุง',usage_unit:'g',unit_cost:2,total_cost:1000,purchased_at:'2026-09-01',supplier:'Supplier A',source_url:'https://example.com',image_url:'',note:'ok',created_at:10,pack_size:500,pack_size_unit:'g',conversion_approximate:0,payment_method:'cash'};
  const out=applyPurchaseReversal({ingredient,purchase,previousPurchase:previous});
  assert.equal(out.stockDelta,-250);
  assert.equal(out.ingredient.qty,750);
  assert.equal(out.ingredient.unitCost,2);
  assert.equal(out.ingredient.costStatus,'CONFIRMED');
  assert.equal(out.ingredient.purchaseProfile.supplier,'Supplier A');
  assert.equal(out.ingredient.purchaseProfile.quantityPerPackage,500);
  assert.equal(out.ingredient.purchaseProfile.paymentMethod,'cash');
  assert.equal(out.restoredPurchaseId,'p1');
});

test('purchase reversal clears latest cost if no earlier active purchase exists',()=>{
  const out=applyPurchaseReversal({ingredient:{qty:300,unit:'g',unitCost:2,costStatus:'CONFIRMED'},purchase:{id:'p1',quantity_received:300,total_cost:600}});
  assert.equal(out.ingredient.qty,0);
  assert.equal(out.ingredient.unitCost,0);
  assert.equal(out.ingredient.costStatus,'MISSING');
  assert.equal(out.ingredient.purchaseProfile,null);
  assert.equal(out.restoredPurchaseId,null);
});

test('purchase reversal refuses to make stock negative',()=>{
  assert.throws(()=>applyPurchaseReversal({ingredient:{qty:100,unit:'g'},purchase:{quantity_received:250}}),/purchase_cancel_stock_negative/);
});

test('cancel purchase API reverses stock spend and excludes cancelled purchase from costing',async()=>{
  const api=await read('lib/api.mjs'),stock=await read('app/stock/page.tsx');
  assert.match(api,/purchaseCancelMatch/);
  assert.match(api,/CANCEL PURCHASE/);
  assert.match(api,/PURCHASE_REVERSAL/);
  assert.match(api,/before_purchase_cancel/);
  assert.match(api,/removePurchaseExpense\(doc\.expenses\|\|\[\],p,purchaseTx\)/);
  assert.match(api,/DELETE FROM field_cost_history WHERE purchase_record_id=\?/);
  assert.match(api,/doc\.cancelledPurchases\[id\]/);
  assert.match(api,/stock_purchase_cancel/);
  assert.match(api,/purchaseSpendChanged:!!expenseRemoval\.removed/);
  assert.match(api,/purchases\.rows\.filter\(x=>!cancelledPurchases\[String\(x\.id\)\]\)/);
  assert.match(stock,/ยกเลิกรับเข้า/);
  assert.match(stock,/Stock และ Purchase Spend ถูกย้อนกลับ/);
  assert.match(stock,/find\(p=>!p\.cancelled\)/);
  assert.match(stock,/filter\(p=>!p\.cancelled\)/);
});


test('purchase reversal API blocks cancellation after later stock movement and ignores cancelled rows for latest cost',async()=>{
  const api=await read('lib/api.mjs'),stock=await read('app/stock/page.tsx');
  assert.match(api,/purchase_cancel_has_later_movement/);
  assert.match(api,/tx_type<>'PURCHASE'/);
  assert.match(api,/purchase_stock_transaction_missing/);
  assert.match(api,/latestRows\.find\(x=>!doc\.cancelledPurchases\?\.\[String\(x\.id\)\]\)/);
  assert.match(stock,/purchase_cancel_has_later_movement/);
  assert.match(stock,/เพื่อไม่ให้ Stock เพี้ยน/);
});
