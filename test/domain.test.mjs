import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUEUE_STATES,
  normalizeQueueStatus,
  transitionQueue,
  appendItemsToActiveOrder,
  queueDelayLevel,
} from '../lib/domain/queue.mjs';
import {
  STOCK_TX_TYPES,
  createStockTransaction,
  stockBalance,
  saleTransactionsFromRecipe,
  reverseTransactions,
  dedupeTransactions,
} from '../lib/domain/stock-ledger.mjs';
import {
  purchaseQtyToUsageGrams,
  standardCostPerGram,
  recipeStandardCost,
  makeCostSnapshot,
  operationalUnitCost,
} from '../lib/domain/costing.mjs';

test('legacy queue states normalize safely', () => {
  assert.equal(normalizeQueueStatus('assigned'), QUEUE_STATES.WAITING);
  assert.equal(normalizeQueueStatus('making'), QUEUE_STATES.MAKING);
  assert.equal(normalizeQueueStatus('returned'), QUEUE_STATES.CLOSED);
});

test('queue transition rejects invalid skipped transition', () => {
  const order = { id: 'o1', status: 'WAITING', time: 1 };
  assert.equal(transitionQueue(order, 'MAKING', 100).status, 'MAKING');
  assert.throws(() => transitionQueue(order, 'DONE', 100), /invalid_queue_transition/);
});

test('add-on keeps queue and pager but reopens production', () => {
  const original = { id: 'o1', status: 'DONE', queueNo: 'A008', pagerNo: 4, items: [] };
  const next = appendItemsToActiveOrder(original, [{ id: 'orange', qty: 1 }], 500);
  assert.equal(next.queueNo, 'A008');
  assert.equal(next.pagerNo, 4);
  assert.equal(next.status, 'MAKING');
  assert.equal(next.items.length, 1);
});

test('queue delay thresholds match FIELD operating alerts', () => {
  const now = 10 * 60 * 1000;
  assert.equal(queueDelayLevel({ time: now - 2 * 60 * 1000 }, now), 'normal');
  assert.equal(queueDelayLevel({ time: now - 4 * 60 * 1000 }, now), 'watch');
  assert.equal(queueDelayLevel({ time: now - 6 * 60 * 1000 }, now), 'warning');
  assert.equal(queueDelayLevel({ time: now - 9 * 60 * 1000 }, now), 'critical');
});

test('stock ledger sale and void net to zero', () => {
  const sale = saleTransactionsFromRecipe({
    recipe: { matcha: 5, water: 40 },
    quantity: 2,
    saleId: 's1',
    createdAt: 100,
  });
  assert.equal(stockBalance(sale, 'matcha'), -10);
  assert.equal(stockBalance(sale, 'water'), -80);
  const reversal = reverseTransactions(sale, { referenceId: 'void1', createdAt: 200 });
  assert.equal(stockBalance([...sale, ...reversal], 'matcha'), 0);
  assert.equal(stockBalance([...sale, ...reversal], 'water'), 0);
});

test('stock transaction IDs can be de-duplicated for sync retries', () => {
  const tx = createStockTransaction({
    id: 'same',
    ingredientId: 'matcha',
    type: STOCK_TX_TYPES.PURCHASE,
    qtyDelta: 250,
  });
  assert.equal(dedupeTransactions([tx, tx]).length, 1);
});

test('simplified costing converts supported purchase units to production grams', () => {
  assert.equal(purchaseQtyToUsageGrams(750, 'ml'), 750);
  assert.equal(purchaseQtyToUsageGrams(1, 'L'), 1000);
  assert.equal(purchaseQtyToUsageGrams(0.25, 'kg'), 250);
});

test('syrup waste margin is applied but milk has no forced margin', () => {
  const syrup = standardCostPerGram({
    purchasePrice: 199,
    purchaseQty: 750,
    purchaseUnit: 'ml',
    kind: 'syrup',
    wasteMargin: 0.05,
  });
  const milk = standardCostPerGram({
    purchasePrice: 105,
    purchaseQty: 2000,
    purchaseUnit: 'ml',
    kind: 'milk',
    wasteMargin: 0.10,
  });
  assert.ok(Math.abs(syrup - (199 / 750 * 1.05)) < 1e-12);
  assert.ok(Math.abs(milk - (105 / 2000)) < 1e-12);
});

test('cost snapshot freezes ingredient cost at sale time', () => {
  const recipe = { matcha: 5, milk: 110 };
  const ingredients = { matcha: { unitCost: 2 }, milk: { unitCost: 0.05 } };
  assert.equal(recipeStandardCost(recipe, ingredients), 15.5);
  const snapshot = makeCostSnapshot({ recipeVersion: 4, recipe, ingredients, createdAt: 123 });
  ingredients.matcha.unitCost = 3;
  assert.equal(snapshot.standardCost, 15.5);
  assert.equal(snapshot.ingredientCosts.matcha.unitCost, 2);
  assert.equal(snapshot.costingMethod, 'simplified');
});


test('operational unit cost keeps raw purchase cost factual and adds waste only to syrup/concentrate',()=>{
  assert.equal(operationalUnitCost({unitCost:1,costKind:'milk',wasteMargin:.10}),1);
  assert.equal(operationalUnitCost({unitCost:2,costKind:'syrup',wasteMargin:.05}),2.1);
  assert.equal(operationalUnitCost({unitCost:4,costKind:'concentrate',wasteMargin:.10}),4.4);
});
