export const CLOSE_DAY_PENDING_KEY="field-pos-pending-close-day-v1";

function isSatangAmount(value){
  const amount=Number(value);
  return Number.isFinite(amount)&&Math.abs(amount*100-Math.round(amount*100))<1e-7;
}

export function validatePendingCloseDay(value){
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("close_day_recovery_corrupt");
  const body=value.body;
  if(!body||typeof body!=="object"||Array.isArray(body))throw new Error("close_day_recovery_corrupt");
  if(typeof body.requestKey!=="string"||!/^[A-Za-z0-9._:-]{8,128}$/.test(body.requestKey))throw new Error("close_day_recovery_corrupt");
  if(typeof body.date!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(body.date))throw new Error("close_day_recovery_corrupt");
  const countedCash=Number(body.countedCash);
  if(!Number.isFinite(countedCash)||countedCash<0||countedCash>1e7||!isSatangAmount(countedCash))throw new Error("close_day_recovery_corrupt");
  if(!Number.isFinite(Number(value.createdAt))||Number(value.createdAt)<=0)throw new Error("close_day_recovery_corrupt");
  return value;
}

export function shouldRetainCloseDayPending(error={}){
  const status=Number(error?.status)||0;
  if(status===0||status>=500)return true;
  return [408,425,429].includes(status);
}

export function validateCloseDayAck(response,body){
  if(!response||typeof response!=="object"||Array.isArray(response)||response.ok!==true)throw new Error("close_day_unconfirmed");
  const close=response.close;
  if(!close||typeof close!=="object")throw new Error("close_day_unconfirmed");
  if(String(close.requestKey||"")!==String(body?.requestKey||""))throw new Error("close_day_unconfirmed");
  if(String(close.date||"")!==String(body?.date||""))throw new Error("close_day_unconfirmed");
  if(Number(close.countedCash)!==Number(body?.countedCash))throw new Error("close_day_unconfirmed");
  return response;
}
