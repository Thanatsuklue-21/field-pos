export const CASH_SHIFT_OPEN_PENDING_KEY="field-pos-pending-cash-shift-open-v1";

function isSatangAmount(value){
  const amount=Number(value);
  return Number.isFinite(amount)&&Math.abs(amount*100-Math.round(amount*100))<1e-7;
}

export function validatePendingCashShiftOpen(value){
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("cash_shift_open_recovery_corrupt");
  const body=value.body;
  if(!body||typeof body!=="object"||Array.isArray(body))throw new Error("cash_shift_open_recovery_corrupt");
  if(typeof body.requestKey!=="string"||!/^[A-Za-z0-9._:-]{8,128}$/.test(body.requestKey))throw new Error("cash_shift_open_recovery_corrupt");
  const openingCash=Number(body.openingCash);
  if(!Number.isFinite(openingCash)||openingCash<0||openingCash>1e7||!isSatangAmount(openingCash))throw new Error("cash_shift_open_recovery_corrupt");
  if(!Number.isFinite(Number(value.createdAt))||Number(value.createdAt)<=0)throw new Error("cash_shift_open_recovery_corrupt");
  return value;
}

export function shouldRetainCashShiftOpenPending(error={}){
  const status=Number(error?.status)||0;
  if(status===0||status>=500)return true;
  return [408,425,429].includes(status);
}

export function validateCashShiftOpenAck(response,body){
  if(!response||typeof response!=="object"||Array.isArray(response)||response.ok!==true)throw new Error("cash_shift_open_unconfirmed");
  const shift=response.shift;
  if(!shift||typeof shift!=="object")throw new Error("cash_shift_open_unconfirmed");
  if(String(shift.requestKey||"")!==String(body?.requestKey||""))throw new Error("cash_shift_open_unconfirmed");
  if(Number(shift.openingCash)!==Number(body?.openingCash))throw new Error("cash_shift_open_unconfirmed");
  return response;
}
