import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateReceivedQuantity,convertQuantityToUsageUnit} from '../lib/domain/stock-units.mjs';
import {normalizeStockWrite} from '../lib/stock-service.mjs';

test('package receiving converts kg and l to base units',()=>{
  assert.deepEqual(calculateReceivedQuantity({packageQty:2,packSize:750,packSizeUnit:'g',usageUnit:'g'}),{quantity:1500,quantityPerPackage:750,approximate:false});
  assert.deepEqual(calculateReceivedQuantity({packageQty:3,packSize:1,packSizeUnit:'kg',usageUnit:'g'}),{quantity:3000,quantityPerPackage:1000,approximate:false});
  assert.deepEqual(calculateReceivedQuantity({packageQty:2,packSize:1.5,packSizeUnit:'l',usageUnit:'ml'}),{quantity:3000,quantityPerPackage:1500,approximate:false});
});

test('FIELD simplified liquid policy permits ml to g with an approximation flag',()=>{
  const out=calculateReceivedQuantity({packageQty:2,packSize:750,packSizeUnit:'ml',usageUnit:'g'});
  assert.equal(out.quantity,1500);
  assert.equal(out.quantityPerPackage,750);
  assert.equal(out.approximate,true);
});

test('count units cannot be mixed with mass or volume',()=>{
  assert.throws(()=>convertQuantityToUsageUnit(10,'piece','g'),/incompatible_stock_unit/);
  assert.throws(()=>convertQuantityToUsageUnit(10,'ml','piece'),/incompatible_stock_unit/);
});

test('server derives purchase qtyDelta from package information',()=>{
  const out=normalizeStockWrite({
    requestKey:'package-0001',ingredientId:'syrup',type:'PURCHASE',unit:'g',
    packageQty:2,packageUnit:'ขวด',packSize:750,packSizeUnit:'ml',purchaseCost:398,
  },{actorId:'admin-1',now:100});
  assert.equal(out.qtyDelta,1500);
  assert.equal(out.quantityPerPackage,750);
  assert.equal(out.conversionApproximate,true);
  assert.equal(out.purchaseCost,398);
});

test('server rejects a client qtyDelta that disagrees with package calculation',()=>{
  assert.throws(()=>normalizeStockWrite({
    requestKey:'package-0002',ingredientId:'syrup',type:'PURCHASE',unit:'g',qtyDelta:1400,
    packageQty:2,packageUnit:'ขวด',packSize:750,packSizeUnit:'ml',
  }),/packaging_quantity_mismatch/);
});

test('legacy purchases without pack size remain accepted',()=>{
  const out=normalizeStockWrite({
    requestKey:'legacy-0001',ingredientId:'matcha',type:'PURCHASE',unit:'g',qtyDelta:500,
    packageQty:1,packageUnit:'ถุง',
  });
  assert.equal(out.qtyDelta,500);
});
