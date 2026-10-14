export type CustomerPointsBody={requestKey:string;customerId:string;pointsDelta:number};
export type CustomerPointsIntent={version:1;actorId:string;createdAt:number;body:CustomerPointsBody};
type StorageLike=Pick<Storage,"getItem"|"setItem"|"removeItem">;
export const CUSTOMER_POINTS_INTENT_PREFIX="field-customer-points-pending-v1:";
const REQUEST_KEY_RE=/^[A-Za-z0-9._:-]{8,128}$/;
const keyFor=(actorId:string)=>CUSTOMER_POINTS_INTENT_PREFIX+encodeURIComponent(actorId);
const fail=(code:string,cause?:unknown)=>Object.assign(new Error(code),{status:0,cause});

function storageOrThrow(storage?:StorageLike){
  try{return storage||localStorage}catch(cause){throw fail("customer_points_recovery_unavailable",cause)}
}
function validBody(body:any):body is CustomerPointsBody{
  return !!body&&typeof body==="object"&&!Array.isArray(body)
    &&typeof body.requestKey==="string"&&REQUEST_KEY_RE.test(body.requestKey)
    &&typeof body.customerId==="string"&&body.customerId.length>0
    &&Number.isInteger(body.pointsDelta)&&body.pointsDelta!==0&&Math.abs(body.pointsDelta)<=1e6;
}
export function readCustomerPointsIntent(actorId:string,storage?:StorageLike):CustomerPointsIntent|null{
  try{
    const raw=storageOrThrow(storage).getItem(keyFor(actorId));
    if(!raw)return null;
    const intent=JSON.parse(raw) as CustomerPointsIntent;
    if(intent?.version!==1||intent.actorId!==actorId||!Number.isFinite(intent.createdAt)||!validBody(intent.body))throw new Error("invalid_intent");
    return intent;
  }catch(cause){throw fail("customer_points_recovery_unavailable",cause)}
}
export function prepareCustomerPointsIntent(actorId:string,body:CustomerPointsBody,storage?:StorageLike):CustomerPointsIntent{
  if(!validBody(body))throw fail("invalid_customer_points_intent");
  const store=storageOrThrow(storage),existing=readCustomerPointsIntent(actorId,store);
  if(existing){
    if(JSON.stringify(existing.body)!==JSON.stringify(body))throw fail("pending_customer_points_exists");
    return existing;
  }
  const intent:CustomerPointsIntent={version:1,actorId,createdAt:Date.now(),body:{...body}};
  const raw=JSON.stringify(intent);
  try{
    store.setItem(keyFor(actorId),raw);
    if(store.getItem(keyFor(actorId))!==raw)throw new Error("intent_not_persisted");
    return intent;
  }catch(cause){throw fail("customer_points_recovery_unavailable",cause)}
}
function clearIntent(intent:CustomerPointsIntent,storage:StorageLike){
  const current=readCustomerPointsIntent(intent.actorId,storage);
  if(current?.body.requestKey===intent.body.requestKey)storage.removeItem(keyFor(intent.actorId));
}
const NOT_COMMITTED=new Set(["login_required","csrf_denied","crm_permission_required","invalid_request_key","invalid_points","invalid_customer_points_request","customer_not_found"]);
function definitelyNotCommitted(error:any){
  const status=Number(error?.status),code=String(error?.message||"");
  return [400,401,403,404,422].includes(status)&&NOT_COMMITTED.has(code);
}
export function exactCustomerPointsAck(result:any,intent:CustomerPointsIntent){
  return result?.ok===true
    &&String(result.requestKey||"")===intent.body.requestKey
    &&String(result.performedBy||"")===intent.actorId
    &&String(result.customerId||"")===intent.body.customerId
    &&Number(result.pointsDelta)===intent.body.pointsDelta
    &&Number.isInteger(Number(result.pointsBefore))
    &&Number.isInteger(Number(result.pointsAfter))
    &&String(result.customer?.id||"")===intent.body.customerId
    &&Number(result.customer?.points)===Number(result.pointsAfter);
}
export async function sendCustomerPointsIntent(intent:CustomerPointsIntent,send:(body:CustomerPointsBody)=>Promise<any>,storage?:StorageLike){
  const store=storageOrThrow(storage),current=readCustomerPointsIntent(intent.actorId,store);
  if(!current||JSON.stringify(current)!==JSON.stringify(intent))throw fail("customer_points_recovery_unavailable");
  let result:any;
  try{result=await send({...intent.body})}
  catch(error:any){
    if(definitelyNotCommitted(error))clearIntent(intent,store);
    throw error;
  }
  if(!exactCustomerPointsAck(result,intent))throw fail("customer_points_ack_unknown");
  try{clearIntent(intent,store)}catch(cause){throw fail("customer_points_recovery_unavailable",cause)}
  return result;
}
