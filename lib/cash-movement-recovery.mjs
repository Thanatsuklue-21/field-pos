export const CASH_MOVEMENT_PENDING_KEY="field-pos-pending-cash-movement-v1";

export function validatePendingCashMovement(value){
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("cash_movement_recovery_corrupt");
  const body=value.body;
  if(!body||typeof body!=="object"||Array.isArray(body))throw new Error("cash_movement_recovery_corrupt");
  if(typeof body.requestKey!=="string"||!/^[A-Za-z0-9._:-]{8,128}$/.test(body.requestKey))throw new Error("cash_movement_recovery_corrupt");
  if(!["CASH_IN","CASH_OUT"].includes(String(body.type||"")))throw new Error("cash_movement_recovery_corrupt");
  if(!Number.isFinite(Number(body.amount))||Number(body.amount)<=0)throw new Error("cash_movement_recovery_corrupt");
  if(typeof body.reason!=="string"||body.reason.trim().length<2)throw new Error("cash_movement_recovery_corrupt");
  if(!Number.isFinite(Number(value.createdAt))||Number(value.createdAt)<=0)throw new Error("cash_movement_recovery_corrupt");
  return value;
}

export function shouldRetainCashMovementPending(error={}){
  const status=Number(error?.status)||0;
  if(status===0||status>=500)return true;
  return [408,425,429].includes(status);
}

export function validateCashMovementAck(response,body){
  if(!response||typeof response!=="object"||Array.isArray(response)||response.ok!==true)throw new Error("cash_movement_unconfirmed");
  const movement=response.movement;
  if(!movement||typeof movement!=="object")throw new Error("cash_movement_unconfirmed");
  if(String(movement.requestKey||"")!==String(body?.requestKey||""))throw new Error("cash_movement_unconfirmed");
  if(String(movement.type||"")!==String(body?.type||""))throw new Error("cash_movement_unconfirmed");
  if(Number(movement.amount)!==Number(body?.amount))throw new Error("cash_movement_unconfirmed");
  if(String(movement.reason||"")!==String(body?.reason||""))throw new Error("cash_movement_unconfirmed");
  return response;
}
