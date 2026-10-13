export type OrderMutationOperation="void"|"refund";
export type OrderMutationBody={
  requestKey:string;
  saleId:string;
  reason:string;
  riskConfirmed:true;
  manualConfirmed?:boolean;
  manualReference?:string;
};
export type OrderMutationIntent={
  version:1;
  actorId:string;
  operation:OrderMutationOperation;
  businessDate:string;
  createdAt:number;
  body:OrderMutationBody;
};
type StorageLike=Pick<Storage,"getItem"|"setItem"|"removeItem">;
export const ORDER_MUTATION_INTENT_PREFIX="field-order-mutation-pending-v1:";
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const keyFor=(actorId:string)=>ORDER_MUTATION_INTENT_PREFIX+encodeURIComponent(actorId);
const fail=(code:string,cause?:unknown)=>Object.assign(new Error(code),{status:0,cause});
function store(storage?:StorageLike){try{return storage||localStorage}catch(cause){throw fail("order_mutation_recovery_unavailable",cause)}}
function validOperation(value:any):value is OrderMutationOperation{return value==="void"||value==="refund"}
function validBody(body:any):body is OrderMutationBody{
  return !!body&&typeof body==="object"&&!Array.isArray(body)&&typeof body.requestKey==="string"&&/^[A-Za-z0-9._:-]{8,128}$/.test(body.requestKey)&&typeof body.saleId==="string"&&body.saleId.length>0&&typeof body.reason==="string"&&body.reason.trim().length>=2&&body.riskConfirmed===true&&(body.manualConfirmed===undefined||typeof body.manualConfirmed==="boolean")&&(body.manualReference===undefined||typeof body.manualReference==="string");
}
function validIntent(value:any,actorId:string):value is OrderMutationIntent{
  return value?.version===1&&value.actorId===actorId&&validOperation(value.operation)&&DATE_RE.test(String(value.businessDate||""))&&Number.isFinite(value.createdAt)&&validBody(value.body);
}

export function readOrderMutationIntent(actorId:string,storage?:StorageLike):OrderMutationIntent|null{
  try{
    const raw=store(storage).getItem(keyFor(actorId));if(!raw)return null;
    const value=JSON.parse(raw);
    if(!validIntent(value,actorId))throw new Error("invalid_intent");
    return value;
  }catch(cause){throw fail("order_mutation_recovery_unavailable",cause)}
}

export function prepareOrderMutationIntent(actorId:string,operation:OrderMutationOperation,businessDate:string,body:OrderMutationBody,storage?:StorageLike):OrderMutationIntent{
  if(!validOperation(operation)||!DATE_RE.test(businessDate)||!validBody(body))throw fail("invalid_order_mutation_intent");
  const s=store(storage),existing=readOrderMutationIntent(actorId,s);
  if(existing){
    if(existing.operation!==operation||existing.businessDate!==businessDate||JSON.stringify(existing.body)!==JSON.stringify(body))throw fail("pending_order_mutation_exists");
    return existing;
  }
  const intent:OrderMutationIntent={version:1,actorId,operation,businessDate,createdAt:Date.now(),body:{...body}};
  const raw=JSON.stringify(intent);
  try{s.setItem(keyFor(actorId),raw);if(s.getItem(keyFor(actorId))!==raw)throw new Error("intent_not_persisted");return intent}
  catch(cause){throw fail("order_mutation_recovery_unavailable",cause)}
}

function clear(intent:OrderMutationIntent,storage:StorageLike){
  const current=readOrderMutationIntent(intent.actorId,storage);
  if(current?.operation===intent.operation&&current.body.requestKey===intent.body.requestKey)storage.removeItem(keyFor(intent.actorId));
}

export function exactOrderMutationAck(result:any,intent:OrderMutationIntent){
  if(result?.ok!==true||String(result.requestKey||"")!==intent.body.requestKey||String(result.performedBy||"")!==intent.actorId||String(result.saleId||"")!==intent.body.saleId)return false;
  if(intent.operation==="void")return typeof result.orderId==="string"&&result.orderId.length>0;
  return Array.isArray(result.saleIds)&&result.saleIds.includes(intent.body.saleId)&&Number.isFinite(Number(result.refundAmount));
}

export async function sendOrderMutationIntent(
  intent:OrderMutationIntent,
  send:(body:OrderMutationBody)=>Promise<any>,
  notCommitted:Set<string>,
  storage?:StorageLike
){
  const s=store(storage),current=readOrderMutationIntent(intent.actorId,s);
  if(!current||JSON.stringify(current)!==JSON.stringify(intent))throw fail("order_mutation_recovery_unavailable");
  let result:any;
  try{result=await send({...intent.body})}
  catch(error:any){
    if([400,404,409].includes(Number(error?.status))&&notCommitted.has(String(error?.message||"")))clear(intent,s);
    throw error;
  }
  if(!exactOrderMutationAck(result,intent))throw fail("order_mutation_ack_unknown");
  try{clear(intent,s)}catch(cause){throw fail("order_mutation_recovery_unavailable",cause)}
  return result;
}

export function listOrderMutationIntents(storage?:StorageLike&Pick<Storage,"length"|"key">):OrderMutationIntent[]{
  const s=store(storage) as StorageLike&Pick<Storage,"length"|"key">,out:OrderMutationIntent[]=[];
  try{
    for(let i=0;i<s.length;i++){
      const key=s.key(i);if(!key||!key.startsWith(ORDER_MUTATION_INTENT_PREFIX))continue;
      const actorId=decodeURIComponent(key.slice(ORDER_MUTATION_INTENT_PREFIX.length));
      const intent=readOrderMutationIntent(actorId,s);if(intent)out.push(intent);
    }
    return out;
  }catch(cause){throw fail("order_mutation_recovery_unavailable",cause)}
}
