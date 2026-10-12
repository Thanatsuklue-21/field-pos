export const SETTLEMENT_PENDING_KEY="field-pos-pending-delivery-settlement-v1";

export function validatePendingSettlement(value){
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("settlement_recovery_corrupt");
  const body=value.body;
  if(!body||typeof body!=="object"||Array.isArray(body))throw new Error("settlement_recovery_corrupt");
  if(typeof body.requestKey!=="string"||!/^[A-Za-z0-9._:-]{8,128}$/.test(body.requestKey))throw new Error("settlement_recovery_corrupt");
  if(typeof body.saleDate!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(body.saleDate))throw new Error("settlement_recovery_corrupt");
  if(typeof body.platform!=="string"||!body.platform.trim()||body.platform==="store")throw new Error("settlement_recovery_corrupt");
  if(!Number.isFinite(Number(body.receivedAmount))||Number(body.receivedAmount)<0)throw new Error("settlement_recovery_corrupt");
  if(typeof body.receivedDate!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(body.receivedDate))throw new Error("settlement_recovery_corrupt");
  if(typeof body.note!=="string"||body.note.length>300)throw new Error("settlement_recovery_corrupt");
  if(!Number.isFinite(Number(value.createdAt))||Number(value.createdAt)<=0)throw new Error("settlement_recovery_corrupt");
  return value;
}

export function shouldRetainSettlementPending(error={}){
  const status=Number(error?.status)||0;
  if(status===0||status>=500)return true;
  return [408,425,429].includes(status);
}

export function validateSettlementAck(response,body){
  if(!response||typeof response!=="object"||Array.isArray(response)||response.ok!==true)throw new Error("settlement_unconfirmed");
  const rec=response.reconciliation;
  if(!rec||typeof rec!=="object")throw new Error("settlement_unconfirmed");
  if(String(rec.requestKey||"")!==String(body?.requestKey||""))throw new Error("settlement_unconfirmed");
  if(String(rec.saleDate||"")!==String(body?.saleDate||""))throw new Error("settlement_unconfirmed");
  if(String(rec.platform||"")!==String(body?.platform||""))throw new Error("settlement_unconfirmed");
  if(Number(rec.receivedAmount)!==Number(body?.receivedAmount))throw new Error("settlement_unconfirmed");
  if(String(rec.receivedDate||"")!==String(body?.receivedDate||""))throw new Error("settlement_unconfirmed");
  if(String(rec.note||"")!==String(body?.note||""))throw new Error("settlement_unconfirmed");
  return response;
}
