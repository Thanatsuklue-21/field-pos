export const CYCLE_COUNT_PENDING_KEY="field-pos-pending-cycle-count-v1";

export function validatePendingCycleCount(value){
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("cycle_count_recovery_corrupt");
  const body=value.body;
  if(!body||typeof body!=="object"||Array.isArray(body))throw new Error("cycle_count_recovery_corrupt");
  if(typeof body.requestKey!=="string"||!/^[A-Za-z0-9._:-]{8,128}$/.test(body.requestKey))throw new Error("cycle_count_recovery_corrupt");
  if(body.confirm!==true||!Array.isArray(body.counts)||!body.counts.length||body.counts.length>500)throw new Error("cycle_count_recovery_corrupt");
  const seen=new Set();
  for(const row of body.counts){
    const id=String(row?.ingredientId||""),qty=Number(row?.countedQty);
    if(!id||seen.has(id)||!Number.isFinite(qty)||qty<0)throw new Error("cycle_count_recovery_corrupt");
    seen.add(id);
  }
  if(!Number.isFinite(Number(value.createdAt))||Number(value.createdAt)<=0)throw new Error("cycle_count_recovery_corrupt");
  return value;
}

export function shouldRetainCycleCountPending(error={}){
  const status=Number(error?.status)||0;
  if(status===0||status>=500)return true;
  return [408,425,429].includes(status);
}

export function validateCycleCountAck(response,body){
  if(!response||typeof response!=="object"||Array.isArray(response)||response.ok!==true)throw new Error("cycle_count_unconfirmed");
  if(String(response.requestKey||"")!==String(body?.requestKey||""))throw new Error("cycle_count_unconfirmed");
  const adjustments=response.cycleCount?.adjustments;
  if(!Array.isArray(adjustments)||adjustments.length!==body.counts.length)throw new Error("cycle_count_unconfirmed");
  const expected=[...body.counts].map(x=>[String(x.ingredientId),Number(x.countedQty)]).sort((a,b)=>a[0].localeCompare(b[0]));
  const actual=adjustments.map(x=>[String(x.ingredientId),Number(x.countedQty)]).sort((a,b)=>a[0].localeCompare(b[0]));
  if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error("cycle_count_unconfirmed");
  return response;
}
