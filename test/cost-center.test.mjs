import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMenuCostRows,comparePurchaseSources} from '../lib/domain/cost-center.mjs';

test('menu cost center separates actual COGS from estimated variable cost',()=>{
  const ingredients={matcha:{name:'Matcha',unit:'g',unitCost:2},cup:{name:'Cup',unit:'piece',unitCost:1.8},ice:{name:'Ice',unit:'g',unitCost:.0025}};
  const menu=[{id:'pure',name:'Pure',price:50,variants:[{label:'Standard',recipe:{items:{matcha:4,cup:1,ice:210}}}]}];
  const [row]=buildMenuCostRows({menu,ingredients,estimatedVariableCost:2.5});
  assert.equal(row.ingredientCost,10.325);
  assert.equal(row.actualCogs,10.325);
  assert.equal(row.estimatedVariableCost,2.5);
  assert.equal(row.contributionProfit,37.175);
  assert.equal(row.grossProfit,39.675);
  assert.equal(row.grossMargin,79.35);
});

test('supplier comparison uses normalized cost and keeps purchase evidence',()=>{
  const rows=comparePurchaseSources([
    {ingredientId:'matcha',supplier:'A',quantityReceived:250,totalCost:519,purchasedAt:'2026-10-01',imageUrl:'https://example.com/a.jpg'},
    {ingredientId:'matcha',supplier:'B',quantityReceived:100,totalCost:220,purchasedAt:'2026-09-30'}
  ]);
  assert.equal(rows[0].supplier,'A');
  assert.equal(rows[0].unitCost,2.076);
  assert.equal(rows[0].best,true);
  assert.equal(rows[0].imageUrl,'https://example.com/a.jpg');
});
