import test from 'node:test';
import assert from 'node:assert/strict';
import {isPurchaseExpenseForRecord,removePurchaseExpense,findPurchaseExpense} from '../lib/domain/purchase-expense-link.mjs';

const purchase={id:'pur-1',stock_transaction_id:'stx-1',ingredient_id:'matcha',total_cost:500,created_at:1000};
const tx={reference_id:'manual-123'};

test('purchase expense matcher supports explicit new linkage',()=>{
  assert.equal(isPurchaseExpenseForRecord({category:'PURCHASE',ingredientId:'matcha',purchaseRecordId:'pur-1'},purchase,tx),true);
  assert.equal(isPurchaseExpenseForRecord({category:'PURCHASE',ingredientId:'matcha',stockTransactionId:'stx-1'},purchase,tx),true);
});

test('purchase expense matcher supports legacy external reference without deleting another purchase',()=>{
  const good={id:'exp-good',category:'PURCHASE',sourceType:'STOCK_PURCHASE',ingredientId:'matcha',referenceId:'manual-123',time:1000,amount:500};
  const wrongTime={id:'exp-wrong-time',category:'PURCHASE',sourceType:'STOCK_PURCHASE',ingredientId:'matcha',referenceId:'manual-123',time:2000,amount:500};
  const wrongIngredient={id:'exp-wrong-ing',category:'PURCHASE',sourceType:'STOCK_PURCHASE',ingredientId:'milk',referenceId:'manual-123',time:1000,amount:500};
  assert.equal(isPurchaseExpenseForRecord(good,purchase,tx),true);
  assert.equal(isPurchaseExpenseForRecord(wrongTime,purchase,tx),false);
  assert.equal(isPurchaseExpenseForRecord(wrongIngredient,purchase,tx),false);
  assert.equal(findPurchaseExpense([wrongTime,good],purchase,tx)?.id,'exp-good');
  const out=removePurchaseExpense([wrongTime,good,wrongIngredient],purchase,tx);
  assert.equal(out.removed?.id,'exp-good');
  assert.deepEqual(out.expenses.map(x=>x.id),['exp-wrong-time','exp-wrong-ing']);
});

test('purchase expense matcher supports legacy stock transaction reference',()=>{
  const expense={id:'exp-old',category:'PURCHASE',ingredientId:'matcha',referenceId:'stx-1',time:1000};
  assert.equal(isPurchaseExpenseForRecord(expense,purchase,{}),true);
});
