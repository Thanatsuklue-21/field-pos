import test from 'node:test';
import assert from 'node:assert/strict';
import {previewSnapshot} from '../lib/migration.mjs';

test('snapshot migration preserves historical sales orders and cost rows',()=>{
  const snapshot={
    dataVersion:'old',
    menu:[],
    ingredients:{},
    menuCostRecords:[{menu_id:'pure-matcha'}],
    archivedRecipes:[{menu_id:'coconut-matcha'}],
    costEntries:[{id:'cost-old',ingredientId:'matcha'}],
    sales:[{id:'sale-old'}],
    orders:[{id:'order-old'}]
  };
  const out=previewSnapshot(snapshot).document;
  assert.deepEqual(out.sales,snapshot.sales);
  assert.deepEqual(out.orders,snapshot.orders);
  assert.deepEqual(out.menuCostRecords,snapshot.menuCostRecords);
  assert.deepEqual(out.archivedRecipes,snapshot.archivedRecipes);
  assert.deepEqual(out.costEntries,snapshot.costEntries);
});
