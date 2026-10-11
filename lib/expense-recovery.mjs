export const EXPENSE_PENDING_KEY="field-pos-pending-expense-v1";

export function validatePendingExpense(value){
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("expense_recovery_corrupt");
  const body=value.body;
  if(!body||typeof body!=="object"||Array.isArray(body))throw new Error("expense_recovery_corrupt");
  if(typeof body.requestKey!=="string"||body.requestKey.length<8||body.requestKey.length>120)throw new Error("expense_recovery_corrupt");
  if(typeof body.date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(body.date))throw new Error("expense_recovery_corrupt");
  if(!Number.isFinite(Number(body.amount))||Number(body.amount)<=0)throw new Error("expense_recovery_corrupt");
  if(typeof body.category!=="string"||!body.category)throw new Error("expense_recovery_corrupt");
  if(typeof body.description!=="string")throw new Error("expense_recovery_corrupt");
  if(typeof body.paymentMethod!=="string"||!body.paymentMethod)throw new Error("expense_recovery_corrupt");
  if(!Number.isFinite(Number(value.createdAt))||Number(value.createdAt)<=0)throw new Error("expense_recovery_corrupt");
  return value;
}

export function shouldRetainExpensePending(error={}){
  const status=Number(error?.status)||0;
  if(status===0||status>=500)return true;
  return [408,425,429].includes(status);
}

export function validateExpenseAck(response,body){
  if(!response||typeof response!=="object"||Array.isArray(response)||response.ok!==true)throw new Error("expense_unconfirmed");
  const expense=response.expense;
  if(!expense||typeof expense!=="object")throw new Error("expense_unconfirmed");
  if(String(expense.requestKey||"")!==String(body?.requestKey||""))throw new Error("expense_unconfirmed");
  if(String(expense.date||"")!==String(body?.date||""))throw new Error("expense_unconfirmed");
  if(Number(expense.amount)!==Number(body?.amount))throw new Error("expense_unconfirmed");
  if(String(expense.category||"")!==String(body?.category||""))throw new Error("expense_unconfirmed");
  if(String(expense.description||"")!==String(body?.description||""))throw new Error("expense_unconfirmed");
  if(String(expense.paymentMethod||"")!==String(body?.paymentMethod||""))throw new Error("expense_unconfirmed");
  return response;
}
