export type VoidMutationBody={
  requestKey:string;saleId:string;reason:string;riskConfirmed:true;expectedDate:string;expectedAmount:number;
};
export type RefundMutationBody={
  requestKey:string;saleId:string;reason:string;riskConfirmed:true;manualConfirmed:boolean;manualReference:string;
  expectedDate:string;expectedRefundAmount:number;expectedSaleIds:string[];
};
export type OrderMutationBody=VoidMutationBody|RefundMutationBody;
export type OrderMutationOperation="void"|"refund";
export type OrderMutationIntent={
  version:1;actorId:string;operation:OrderMutationOperation;createdAt:number;body:OrderMutationBody;
  meta?:Record<string,any>;
};
type StorageLike=Pick<Storage,"getItem"|"setItem"|"removeItem">;
export const ORDER_MUTATION_INTENT_PREFIX="field-order-mutation-pending-v1:";
const storageKey=(actorId:string)=>ORDER_MUTATION_INTENT_PREFIX+encodeURIComponent(actorId);
const recoveryError=(code:string,cause?:unknown)=>Object.assign(new Error(code),{status:0,cause});
function storageOrThrow(storage?:StorageLike){try{return storage||localStorage}catch(cause){throw recoveryError("order_mutation_recovery_unavailable",cause)}}
function validCommon(b:any){return !!b&&typeof b==="object"&&typeof b.requestKey==="string"&&b.requestKey.length>=8&&b.requestKey.length<=120&&typeof b.saleId==="string"&&b.saleId.length>0&&typeof b.reason==="string"&&b.reason.trim().length>=2&&b.riskConfirmed===true&&/^\d{4}-\d{2}-\d{2}$/.test(String(b.expectedDate||""))}
function validBody(operation:OrderMutationOperation,b:any):b is OrderMutationBody{
  if(!validCommon(b))return false;
  if(operation==="void")return Number.isFinite(Number(b.expectedAmount))&&Number(b.expectedAmount)>=0;
  return typeof b.manualConfirmed==="boolean"&&typeof b.manualReference==="string"&&Number.isFinite(Number(b.expectedRefundAmount))&&Number(b.expectedRefundAmount)>=0&&Array.isArray(b.expectedSaleIds)&&b.expectedSaleIds.length>0&&b.expectedSaleIds.every((x:any)=>typeof x==="string"&&x.length>0);
}
export function readOrderMutationIntent(actorId:string,storage?:StorageLike):OrderMutationIntent|null{
  try{
    const raw=storageOrThrow(storage).getItem(storageKey(actorId));if(!raw)return null;
    const intent=JSON.parse(raw) as OrderMutationIntent;
    if(intent?.version!==1||intent.actorId!==actorId||!["void","refund"].includes(intent.operation)||!Number.isFinite(intent.createdAt)||!validBody(intent.operation,intent.body))throw new Error("invalid_intent");
    if(intent.meta!==undefined&&(!intent.meta||typeof intent.meta!=="object"||Array.isArray(intent.meta)))throw new Error("invalid_meta");
    return intent;
  }catch(cause){throw recoveryError("order_mutation_recovery_unavailable",cause)}
}
export function prepareOrderMutationIntent(actorId:string,operation:OrderMutationOperation,body:OrderMutationBody,meta?:Record<string,any>,storage?:StorageLike):OrderMutationIntent{
  const store=storageOrThrow(storage),old=readOrderMutationIntent(actorId,store);
  if(old){
    if(old.operation!==operation||JSON.stringify(old.body)!==JSON.stringify(body))throw recoveryError("pending_order_mutation_exists");
    return old;
  }
  if(!validBody(operation,body))throw recoveryError("invalid_order_mutation");
  const intent:OrderMutationIntent={version:1,actorId,operation,createdAt:Date.now(),body:{...body} as OrderMutationBody,...(meta?{meta}:{})};
  try{
    const raw=JSON.stringify(intent);store.setItem(storageKey(actorId),raw);
    if(store.getItem(storageKey(actorId))!==raw)throw new Error("intent_not_persisted");
    return intent;
  }catch(cause){throw recoveryError("order_mutation_recovery_unavailable",cause)}
}
function clearIntent(intent:OrderMutationIntent,storage:StorageLike){
  const current=readOrderMutationIntent(intent.actorId,storage);
  if(current?.body.requestKey===intent.body.requestKey)storage.removeItem(storageKey(intent.actorId));
}
const VOID_NOT_COMMITTED=new Set(["invalid_request_key","sale_required","invalid_date","invalid_void_target","void_target_changed","sale_not_found","sale_not_voidable","sale_already_void","void_closed_day","non_cash_void_requires_refund","order_not_found","void_multi_sale_order_not_supported","void_after_production_started","ingredient_missing","high_risk_confirmation_required","high_risk_reason_required"]);
const REFUND_NOT_COMMITTED=new Set(["invalid_request_key","sale_required","invalid_date","invalid_refund_target","refund_target_changed","sale_not_found","sale_not_refundable","sale_already_refunded","order_not_found","order_sale_missing","refund_closed_day","refund_payment_not_supported","use_void_before_production","promptpay_manual_refund_required","external_manual_refund_required","manual_refund_reference_required","ingredient_missing","high_risk_confirmation_required","high_risk_reason_required"]);
export async function sendOrderMutationIntent(intent:OrderMutationIntent,send:(operation:OrderMutationOperation,body:OrderMutationBody)=>Promise<any>,storage?:StorageLike){
  const store=storageOrThrow(storage),current=readOrderMutationIntent(intent.actorId,store);
  if(!current||JSON.stringify(current)!==JSON.stringify(intent))throw recoveryError("order_mutation_recovery_unavailable");
  let result:any;
  try{result=await send(intent.operation,{...intent.body} as OrderMutationBody)}catch(error:any){
    const known=intent.operation==="void"?VOID_NOT_COMMITTED:REFUND_NOT_COMMITTED;
    if([400,404,409].includes(Number(error?.status))&&known.has(String(error?.message||"")))clearIntent(intent,store);
    throw error;
  }
  const b:any=intent.body;
  let exact=result?.ok===true&&result.action===intent.operation&&result.requestKey===b.requestKey&&result.performedBy===intent.actorId&&result.saleId===b.saleId&&result.date===b.expectedDate;
  if(intent.operation==="void"){
    exact=exact&&Number(result.voidAmount)===Number(b.expectedAmount)&&result.stockRestored===true;
  }else{
    const expectedIds=[...b.expectedSaleIds].sort(),actualIds=Array.isArray(result.saleIds)?result.saleIds.map(String).sort():[];
    exact=exact&&Number(result.refundAmount)===Number(b.expectedRefundAmount)&&JSON.stringify(actualIds)===JSON.stringify(expectedIds);
  }
  if(!exact)throw recoveryError("order_mutation_ack_unknown");
  try{clearIntent(intent,store)}catch(cause){throw recoveryError("order_mutation_recovery_unavailable",cause)}
  return result;
}
export function listOrderMutationIntents(storage?:StorageLike&Pick<Storage,"length"|"key">):OrderMutationIntent[]{
  const store=(storageOrThrow(storage) as StorageLike&Pick<Storage,"length"|"key">),out:OrderMutationIntent[]=[];
  try{
    for(let i=0;i<store.length;i++){
      const key=store.key(i);if(!key||!key.startsWith(ORDER_MUTATION_INTENT_PREFIX))continue;
      const actorId=decodeURIComponent(key.slice(ORDER_MUTATION_INTENT_PREFIX.length));
      const intent=readOrderMutationIntent(actorId,store);if(intent)out.push(intent);
    }
    return out;
  }catch(cause){throw recoveryError("order_mutation_recovery_unavailable",cause)}
}
