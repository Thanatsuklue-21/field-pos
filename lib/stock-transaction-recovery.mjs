export const STOCK_TX_PENDING_KEY="field-pos-pending-stock-transaction-v1";

export function validatePendingStockTransaction(value){
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("stock_recovery_corrupt");
  const body=value.body;
  if(!body||typeof body!=="object"||Array.isArray(body))throw new Error("stock_recovery_corrupt");
  if(typeof body.requestKey!=="string"||body.requestKey.length<8||body.requestKey.length>128)throw new Error("stock_recovery_corrupt");
  if(typeof body.ingredientId!=="string"||!body.ingredientId)throw new Error("stock_recovery_corrupt");
  if(!["PURCHASE","WASTE"].includes(String(body.type||"")))throw new Error("stock_recovery_corrupt");
  if(typeof body.unit!=="string"||!body.unit)throw new Error("stock_recovery_corrupt");
  if(!Number.isFinite(Number(value.createdAt))||Number(value.createdAt)<=0)throw new Error("stock_recovery_corrupt");
  return value;
}

export function shouldRetainStockPending(error={}){
  const status=Number(error?.status)||0;
  if(status===0||status>=500)return true;
  return [408,425,429].includes(status);
}

export function validateStockTransactionAck(response,body){
  if(!response||typeof response!=="object"||Array.isArray(response)||response.ok!==true)throw new Error("stock_transaction_unconfirmed");
  const tx=response.transaction;
  if(!tx||typeof tx!=="object")throw new Error("stock_transaction_unconfirmed");
  if(String(tx.requestKey||"")!==String(body?.requestKey||""))throw new Error("stock_transaction_unconfirmed");
  if(String(tx.ingredientId||"")!==String(body?.ingredientId||""))throw new Error("stock_transaction_unconfirmed");
  if(String(tx.type||"")!==String(body?.type||""))throw new Error("stock_transaction_unconfirmed");
  if(String(tx.unit||"")!==String(body?.unit||""))throw new Error("stock_transaction_unconfirmed");
  return response;
}
