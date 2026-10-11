export const QUEUE_PENDING_KEY="field-pos-pending-queue-action-v1";

export function validatePendingQueueAction(value){
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("queue_recovery_corrupt");
  const body=value.body;
  if(!body||typeof body!=="object"||Array.isArray(body))throw new Error("queue_recovery_corrupt");
  if(typeof body.requestKey!=="string"||body.requestKey.length<8)throw new Error("queue_recovery_corrupt");
  if(typeof body.orderId!=="string"||!body.orderId)throw new Error("queue_recovery_corrupt");
  if(typeof body.action!=="string"||!body.action)throw new Error("queue_recovery_corrupt");
  if(!Number.isFinite(Number(value.createdAt))||Number(value.createdAt)<=0)throw new Error("queue_recovery_corrupt");
  return value;
}

export function shouldRetainQueuePending(error={}){
  const status=Number(error?.status)||0;
  if(status===0||status>=500)return true;
  return [408,425,429].includes(status);
}


export function validateQueueActionAck(response,body){
  if(!response||typeof response!=="object"||Array.isArray(response))throw new Error("queue_action_unconfirmed");
  if(response.ok!==true)throw new Error("queue_action_unconfirmed");
  if(String(response.orderId||"")!==String(body?.orderId||""))throw new Error("queue_action_unconfirmed");
  if(String(response.action||"")!==String(body?.action||""))throw new Error("queue_action_unconfirmed");
  const revision=Number(response.revision);
  if(!Number.isSafeInteger(revision)||revision<0)throw new Error("queue_action_unconfirmed");
  return response;
}
