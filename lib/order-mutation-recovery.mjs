export const ORDER_MUTATION_PENDING_KEY="field-pos-pending-order-mutation-v1";

export function validatePendingOrderMutation(value){
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("order_mutation_recovery_corrupt");
  if(!["void","refund"].includes(String(value.kind||"")))throw new Error("order_mutation_recovery_corrupt");
  const body=value.body;
  if(!body||typeof body!=="object"||Array.isArray(body))throw new Error("order_mutation_recovery_corrupt");
  if(typeof body.requestKey!=="string"||body.requestKey.length<8||body.requestKey.length>120)throw new Error("order_mutation_recovery_corrupt");
  if(typeof body.saleId!=="string"||!body.saleId)throw new Error("order_mutation_recovery_corrupt");
  if(typeof body.reason!=="string")throw new Error("order_mutation_recovery_corrupt");
  if(!Number.isFinite(Number(value.createdAt))||Number(value.createdAt)<=0)throw new Error("order_mutation_recovery_corrupt");
  return value;
}

export function shouldRetainOrderMutationPending(error={}){
  const status=Number(error?.status)||0;
  if(status===0||status>=500)return true;
  return [408,425,429].includes(status);
}

export function validateOrderMutationAck(response,pending){
  if(!response||typeof response!=="object"||Array.isArray(response)||response.ok!==true)throw new Error("order_mutation_unconfirmed");
  if(String(response.saleId||"")!==String(pending?.body?.saleId||""))throw new Error("order_mutation_unconfirmed");
  if(!Array.isArray(response.saleIds)||!response.saleIds.map(String).includes(String(pending?.body?.saleId||"")))throw new Error("order_mutation_unconfirmed");
  const amount=pending?.kind==="void"?Number(response.voidAmount):Number(response.refundAmount);
  if(!Number.isFinite(amount)||amount<0)throw new Error("order_mutation_unconfirmed");
  return response;
}

export function orderMutationPath(kind){
  if(kind==="void")return "/api/pos/void";
  if(kind==="refund")return "/api/pos/refund";
  throw new Error("order_mutation_recovery_corrupt");
}
