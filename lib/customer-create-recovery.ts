export type CustomerCreateBody={requestKey:string;name:string;phone:string;lineId:string};
export type CustomerCreateIntent={version:1;actorId:string;createdAt:number;body:CustomerCreateBody};
type StorageLike=Pick<Storage,"getItem"|"setItem"|"removeItem">;
export const CUSTOMER_CREATE_INTENT_PREFIX="field-customer-create-pending-v1:";
const REQUEST_KEY_RE=/^[A-Za-z0-9._:-]{8,128}$/;
const keyFor=(actorId:string)=>CUSTOMER_CREATE_INTENT_PREFIX+encodeURIComponent(actorId);
const fail=(code:string,cause?:unknown)=>Object.assign(new Error(code),{status:0,cause});

function storageOrThrow(storage?:StorageLike){
  try{return storage||localStorage}catch(cause){throw fail("customer_create_recovery_unavailable",cause)}
}
function validBody(body:any):body is CustomerCreateBody{
  return !!body&&typeof body==="object"&&!Array.isArray(body)
    &&typeof body.requestKey==="string"&&REQUEST_KEY_RE.test(body.requestKey)
    &&typeof body.name==="string"&&body.name.length>=1&&body.name.length<=120
    &&typeof body.phone==="string"&&body.phone.length<=30
    &&typeof body.lineId==="string"&&body.lineId.length<=80;
}
export function readCustomerCreateIntent(actorId:string,storage?:StorageLike):CustomerCreateIntent|null{
  try{
    const raw=storageOrThrow(storage).getItem(keyFor(actorId));
    if(!raw)return null;
    const intent=JSON.parse(raw) as CustomerCreateIntent;
    if(intent?.version!==1||intent.actorId!==actorId||!Number.isFinite(intent.createdAt)||!validBody(intent.body))throw new Error("invalid_intent");
    return intent;
  }catch(cause){throw fail("customer_create_recovery_unavailable",cause)}
}
export function prepareCustomerCreateIntent(actorId:string,body:CustomerCreateBody,storage?:StorageLike):CustomerCreateIntent{
  if(!validBody(body))throw fail("invalid_customer_create_intent");
  const store=storageOrThrow(storage),existing=readCustomerCreateIntent(actorId,store);
  if(existing){
    if(JSON.stringify(existing.body)!==JSON.stringify(body))throw fail("pending_customer_create_exists");
    return existing;
  }
  const intent:CustomerCreateIntent={version:1,actorId,createdAt:Date.now(),body:{...body}};
  const raw=JSON.stringify(intent);
  try{
    store.setItem(keyFor(actorId),raw);
    if(store.getItem(keyFor(actorId))!==raw)throw new Error("intent_not_persisted");
    return intent;
  }catch(cause){throw fail("customer_create_recovery_unavailable",cause)}
}
function clearIntent(intent:CustomerCreateIntent,storage:StorageLike){
  const current=readCustomerCreateIntent(intent.actorId,storage);
  if(current?.body.requestKey===intent.body.requestKey)storage.removeItem(keyFor(intent.actorId));
}
const NOT_COMMITTED=new Set(["login_required","csrf_denied","crm_permission_required","invalid_request_key","invalid_customer","customer_phone_exists"]);
function definitelyNotCommitted(error:any){
  const status=Number(error?.status),code=String(error?.message||"");
  return [400,401,403,404,409,422].includes(status)&&NOT_COMMITTED.has(code);
}
export function exactCustomerCreateAck(result:any,intent:CustomerCreateIntent){
  const c=result?.customer,b=intent.body;
  return result?.ok===true
    &&String(result.requestKey||"")===b.requestKey
    &&String(result.performedBy||"")===intent.actorId
    &&typeof c?.id==="string"&&c.id.length>0
    &&String(c.name||"")===b.name
    &&String(c.phone||"")===b.phone
    &&String(c.lineId||"")===b.lineId
    &&Number(c.points)===0&&Number(c.visits)===0&&Number(c.totalSpend)===0;
}
export async function sendCustomerCreateIntent(intent:CustomerCreateIntent,send:(body:CustomerCreateBody)=>Promise<any>,storage?:StorageLike){
  const store=storageOrThrow(storage),current=readCustomerCreateIntent(intent.actorId,store);
  if(!current||JSON.stringify(current)!==JSON.stringify(intent))throw fail("customer_create_recovery_unavailable");
  let result:any;
  try{result=await send({...intent.body})}
  catch(error:any){
    if(definitelyNotCommitted(error))clearIntent(intent,store);
    throw error;
  }
  if(!exactCustomerCreateAck(result,intent))throw fail("customer_create_ack_unknown");
  try{clearIntent(intent,store)}catch(cause){throw fail("customer_create_recovery_unavailable",cause)}
  return result;
}
