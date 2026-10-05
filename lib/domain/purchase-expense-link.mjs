const s=v=>String(v??'');
const n=v=>Number.isFinite(Number(v))?Number(v):0;

export function isPurchaseExpenseForRecord(expense,purchase,stockTransaction={}){
  if(!expense||!purchase)return false;
  if(String(expense.category||'').toUpperCase()!=='PURCHASE'&&String(expense.sourceType||'')!=='STOCK_PURCHASE')return false;
  const ingredientId=s(purchase.ingredient_id);
  if(expense.ingredientId&&ingredientId&&s(expense.ingredientId)!==ingredientId)return false;

  const purchaseId=s(purchase.id),stockTransactionId=s(purchase.stock_transaction_id);
  if(expense.purchaseRecordId&&s(expense.purchaseRecordId)===purchaseId)return true;
  if(expense.stockTransactionId&&s(expense.stockTransactionId)===stockTransactionId)return true;

  const externalRef=s(stockTransaction.reference_id);
  const expenseRef=s(expense.referenceId);
  const legacyRefMatch=expenseRef&&(expenseRef===stockTransactionId||(externalRef&&expenseRef===externalRef));
  if(!legacyRefMatch)return false;

  const expenseTime=n(expense.time),purchaseCreated=n(purchase.created_at);
  if(expenseTime&&purchaseCreated&&expenseTime!==purchaseCreated)return false;
  return true;
}

export function removePurchaseExpense(expenses=[],purchase,stockTransaction={}){
  const list=Array.isArray(expenses)?expenses:[];
  const index=list.findIndex(x=>isPurchaseExpenseForRecord(x,purchase,stockTransaction));
  if(index<0)return {expenses:list.slice(),removed:null};
  const next=list.slice(),removed=next.splice(index,1)[0];
  return {expenses:next,removed};
}

export function findPurchaseExpense(expenses=[],purchase,stockTransaction={}){
  return (Array.isArray(expenses)?expenses:[]).find(x=>isPurchaseExpenseForRecord(x,purchase,stockTransaction))||null;
}
