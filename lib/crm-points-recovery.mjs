export const CRM_POINTS_PENDING_KEY="field-pos-pending-crm-points-v1";

export function validatePendingCrmPoints(value){
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("crm_points_recovery_corrupt");
  const body=value.body;
  if(!body||typeof body!=="object"||Array.isArray(body))throw new Error("crm_points_recovery_corrupt");
  if(typeof value.customerId!=="string"||!value.customerId)throw new Error("crm_points_recovery_corrupt");
  if(typeof body.requestKey!=="string"||!/^[A-Za-z0-9._:-]{8,128}$/.test(body.requestKey))throw new Error("crm_points_recovery_corrupt");
  if(!Number.isInteger(Number(body.expectedPoints))||Number(body.expectedPoints)<0)throw new Error("crm_points_recovery_corrupt");
  if(!Number.isInteger(Number(body.pointsSet))||Number(body.pointsSet)<0)throw new Error("crm_points_recovery_corrupt");
  if(!Number.isFinite(Number(value.createdAt))||Number(value.createdAt)<=0)throw new Error("crm_points_recovery_corrupt");
  return value;
}

export function shouldRetainCrmPointsPending(error={}){
  const status=Number(error?.status)||0;
  if(status===0||status>=500)return true;
  return [408,425,429].includes(status);
}

export function validateCrmPointsAck(response,pending){
  if(!response||typeof response!=="object"||Array.isArray(response)||response.ok!==true)throw new Error("crm_points_unconfirmed");
  if(String(response.requestKey||"")!==String(pending?.body?.requestKey||""))throw new Error("crm_points_unconfirmed");
  if(Number(response.previousPoints)!==Number(pending?.body?.expectedPoints))throw new Error("crm_points_unconfirmed");
  if(Number(response.pointsSet)!==Number(pending?.body?.pointsSet))throw new Error("crm_points_unconfirmed");
  if(Number(response.customer?.points)!==Number(pending?.body?.pointsSet))throw new Error("crm_points_unconfirmed");
  return response;
}
