export type QueueAction="complete_item"|"waste_remake"|"call"|"call_item"|"return";
export type QueueActionBody={
  requestKey:string;
  orderId:string;
  action:QueueAction;
  itemIndex?:number;
  expectedReadyQty?:number;
  reason?:string;
};
export type QueueActionIntent={
  version:1;
  actorId:string;
  createdAt:number;
  body:QueueActionBody;
};

type StorageLike=Pick<Storage,"getItem"|"setItem"|"removeItem">;
export const QUEUE_ACTION_INTENT_PREFIX="field-queue-action-pending-v1:";
const REQUEST_KEY_RE=/^[A-Za-z0-9._:-]{8,128}$/;
const ACTIONS=new Set<QueueAction>(["complete_item","waste_remake","call","call_item","return"]);
const keyFor=(actorId:string)=>QUEUE_ACTION_INTENT_PREFIX+encodeURIComponent(actorId);
const fail=(code:string,cause?:unknown)=>Object.assign(new Error(code),{status:0,cause});

function storageOrThrow(storage?:StorageLike){
  try{return storage||localStorage}catch(cause){throw fail("queue_action_recovery_unavailable",cause)}
}
function validBody(body:any):body is QueueActionBody{
  if(!body||typeof body!=="object"||Array.isArray(body))return false;
  if(typeof body.requestKey!=="string"||!REQUEST_KEY_RE.test(body.requestKey))return false;
  if(typeof body.orderId!=="string"||body.orderId.length<1)return false;
  if(!ACTIONS.has(body.action))return false;
  if(body.itemIndex!==undefined&&(!Number.isInteger(body.itemIndex)||body.itemIndex<0))return false;
  if(body.expectedReadyQty!==undefined&&(!Number.isFinite(Number(body.expectedReadyQty))||Number(body.expectedReadyQty)<0))return false;
  if(body.reason!==undefined&&typeof body.reason!=="string")return false;
  if(["complete_item","waste_remake","call_item"].includes(body.action)&&!Number.isInteger(body.itemIndex))return false;
  if(body.action==="complete_item"&&!Number.isFinite(Number(body.expectedReadyQty)))return false;
  return true;
}

export function readQueueActionIntent(actorId:string,storage?:StorageLike):QueueActionIntent|null{
  try{
    const raw=storageOrThrow(storage).getItem(keyFor(actorId));
    if(!raw)return null;
    const intent=JSON.parse(raw) as QueueActionIntent;
    if(intent?.version!==1||intent.actorId!==actorId||!Number.isFinite(intent.createdAt)||!validBody(intent.body))throw new Error("invalid_intent");
    return intent;
  }catch(cause){throw fail("queue_action_recovery_unavailable",cause)}
}

export function prepareQueueActionIntent(actorId:string,body:QueueActionBody,storage?:StorageLike):QueueActionIntent{
  if(!validBody(body))throw fail("invalid_queue_action_intent");
  const store=storageOrThrow(storage),existing=readQueueActionIntent(actorId,store);
  if(existing){
    if(JSON.stringify(existing.body)!==JSON.stringify(body))throw fail("pending_queue_action_exists");
    return existing;
  }
  const intent:QueueActionIntent={version:1,actorId,createdAt:Date.now(),body:{...body}};
  const raw=JSON.stringify(intent);
  try{
    store.setItem(keyFor(actorId),raw);
    if(store.getItem(keyFor(actorId))!==raw)throw new Error("intent_not_persisted");
    return intent;
  }catch(cause){throw fail("queue_action_recovery_unavailable",cause)}
}

function clearIntent(intent:QueueActionIntent,storage:StorageLike){
  const current=readQueueActionIntent(intent.actorId,storage);
  if(current?.body.requestKey===intent.body.requestKey)storage.removeItem(keyFor(intent.actorId));
}

const NOT_COMMITTED=new Set([
  "invalid_request_key","invalid_queue_action","order_not_found","item_not_found","fifo_violation",
  "queue_state_changed","order_not_ready","pager_already_called","item_not_ready_for_call",
  "waste_after_call_not_supported","recipe_unavailable","order_not_complete"
]);
function definitelyNotCommitted(error:any){
  const status=Number(error?.status),code=String(error?.message||"");
  if(![400,401,403,404,409,422].includes(status))return false;
  return NOT_COMMITTED.has(code)||code.startsWith("stock_shortage:")||code.startsWith("ingredient_missing:");
}

export function exactQueueActionAck(result:any,intent:QueueActionIntent){
  return result?.ok===true
    &&String(result.requestKey||"")===intent.body.requestKey
    &&String(result.performedBy||"")===intent.actorId
    &&String(result.orderId||"")===intent.body.orderId
    &&String(result.action||"")===intent.body.action
    &&Number.isSafeInteger(Number(result.revision))
    &&Number(result.revision)>=0
    &&Array.isArray(result.orders);
}

export async function sendQueueActionIntent(
  intent:QueueActionIntent,
  send:(body:QueueActionBody)=>Promise<any>,
  storage?:StorageLike
){
  const store=storageOrThrow(storage),current=readQueueActionIntent(intent.actorId,store);
  if(!current||JSON.stringify(current)!==JSON.stringify(intent))throw fail("queue_action_recovery_unavailable");
  let result:any;
  try{result=await send({...intent.body})}
  catch(error:any){
    if(definitelyNotCommitted(error))clearIntent(intent,store);
    throw error;
  }
  if(!exactQueueActionAck(result,intent))throw fail("queue_action_ack_unknown");
  try{clearIntent(intent,store)}catch(cause){throw fail("queue_action_recovery_unavailable",cause)}
  return result;
}

export function listQueueActionIntents(storage?:StorageLike&Pick<Storage,"length"|"key">):QueueActionIntent[]{
  const store=storageOrThrow(storage) as StorageLike&Pick<Storage,"length"|"key">,out:QueueActionIntent[]=[];
  try{
    for(let i=0;i<store.length;i++){
      const key=store.key(i);
      if(!key||!key.startsWith(QUEUE_ACTION_INTENT_PREFIX))continue;
      const actorId=decodeURIComponent(key.slice(QUEUE_ACTION_INTENT_PREFIX.length));
      const intent=readQueueActionIntent(actorId,store);
      if(intent)out.push(intent);
    }
    return out;
  }catch(cause){throw fail("queue_action_recovery_unavailable",cause)}
}
