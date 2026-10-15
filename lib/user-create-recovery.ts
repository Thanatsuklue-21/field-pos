export type UserCreatePermissions={order:boolean;queue:boolean;stock:boolean;report:boolean};
export type UserCreateBody={requestKey:string;username:string;role:"admin"|"staff";permissions:UserCreatePermissions};
export type UserCreateIntent={version:1;actorId:string;createdAt:number;body:UserCreateBody};
type StorageLike=Pick<Storage,"getItem"|"setItem"|"removeItem">;
export const USER_CREATE_INTENT_PREFIX="field-user-create-pending-v1:";
const REQUEST_KEY_RE=/^[A-Za-z0-9._:-]{8,128}$/;
const USERNAME_RE=/^[a-z0-9._-]{3,32}$/;
const keyFor=(actorId:string)=>USER_CREATE_INTENT_PREFIX+encodeURIComponent(actorId);
const fail=(code:string,cause?:unknown)=>Object.assign(new Error(code),{status:0,cause});

function storageOrThrow(storage?:StorageLike){
  try{return storage||localStorage}catch(cause){throw fail("user_create_recovery_unavailable",cause)}
}
function permissionsOf(input:any):UserCreatePermissions{
  return {order:input?.order===true,queue:input?.queue===true,stock:input?.stock===true,report:input?.report===true};
}
function normalizeBody(body:UserCreateBody):UserCreateBody{
  const role=body.role==="admin"?"admin":"staff";
  return {
    requestKey:String(body.requestKey||"").trim(),
    username:String(body.username||"").trim().toLowerCase(),
    role,
    permissions:role==="admin"?permissionsOf({}):permissionsOf(body.permissions)
  };
}
function validBody(body:any):body is UserCreateBody{
  return !!body&&typeof body==="object"&&!Array.isArray(body)
    &&typeof body.requestKey==="string"&&REQUEST_KEY_RE.test(body.requestKey)
    &&typeof body.username==="string"&&USERNAME_RE.test(body.username)
    &&["admin","staff"].includes(body.role)
    &&!!body.permissions&&typeof body.permissions==="object"&&!Array.isArray(body.permissions)
    &&["order","queue","stock","report"].every(k=>typeof body.permissions[k]==="boolean")
    &&(body.role==="admin"||body.permissions.order||body.permissions.queue);
}
export function readUserCreateIntent(actorId:string,storage?:StorageLike):UserCreateIntent|null{
  try{
    const raw=storageOrThrow(storage).getItem(keyFor(actorId));
    if(!raw)return null;
    const intent=JSON.parse(raw) as UserCreateIntent;
    if(intent?.version!==1||intent.actorId!==actorId||!Number.isFinite(intent.createdAt)||!validBody(intent.body))throw new Error("invalid_intent");
    return intent;
  }catch(cause){throw fail("user_create_recovery_unavailable",cause)}
}
export function prepareUserCreateIntent(actorId:string,body:UserCreateBody,storage?:StorageLike):UserCreateIntent{
  const normalized=normalizeBody(body);
  if(!validBody(normalized))throw fail("invalid_user_create_intent");
  const store=storageOrThrow(storage),existing=readUserCreateIntent(actorId,store);
  if(existing){
    if(JSON.stringify(existing.body)!==JSON.stringify(normalized))throw fail("pending_user_create_exists");
    return existing;
  }
  const intent:UserCreateIntent={version:1,actorId,createdAt:Date.now(),body:normalized};
  const raw=JSON.stringify(intent);
  // Password is deliberately absent from this object and therefore from localStorage.
  if(/password/i.test(raw))throw fail("user_create_secret_storage_blocked");
  try{
    store.setItem(keyFor(actorId),raw);
    if(store.getItem(keyFor(actorId))!==raw)throw new Error("intent_not_persisted");
    return intent;
  }catch(cause){throw fail("user_create_recovery_unavailable",cause)}
}
function clearIntent(intent:UserCreateIntent,storage:StorageLike){
  const current=readUserCreateIntent(intent.actorId,storage);
  if(current?.body.requestKey===intent.body.requestKey)storage.removeItem(keyFor(intent.actorId));
}
const NOT_COMMITTED=new Set(["login_required","csrf_denied","admin_required","invalid_request_key","invalid_user","staff_needs_order_or_queue","username_exists"]);
function definitelyNotCommitted(error:any){
  return [400,401,403,404,409,422].includes(Number(error?.status))&&NOT_COMMITTED.has(String(error?.message||""));
}
function samePermissions(actual:any,expected:UserCreatePermissions){
  return ["order","queue","stock","report"].every(k=>(actual?.[k]===true)===(expected[k as keyof UserCreatePermissions]===true));
}
export function exactUserCreateAck(result:any,intent:UserCreateIntent){
  const user=result?.user,b=intent.body;
  return result?.ok===true
    &&String(result.requestKey||"")===b.requestKey
    &&String(result.performedBy||"")===intent.actorId
    &&typeof user?.id==="string"&&user.id.length>0
    &&String(user.username||"")===b.username
    &&String(user.role||"")===b.role
    &&user.active===true
    &&samePermissions(user.permissions,b.permissions);
}
export async function sendUserCreateIntent(
  intent:UserCreateIntent,
  password:string,
  send:(body:UserCreateBody&{password:string})=>Promise<any>,
  storage?:StorageLike
){
  const store=storageOrThrow(storage),current=readUserCreateIntent(intent.actorId,store);
  if(!current||JSON.stringify(current)!==JSON.stringify(intent))throw fail("user_create_recovery_unavailable");
  if(typeof password!=="string"||password.length<10||password.length>128)throw fail("user_create_password_required");
  let result:any;
  try{result=await send({...intent.body,password})}
  catch(error:any){
    if(definitelyNotCommitted(error))clearIntent(intent,store);
    throw error;
  }
  if(!exactUserCreateAck(result,intent))throw fail("user_create_ack_unknown");
  try{clearIntent(intent,store)}catch(cause){throw fail("user_create_recovery_unavailable",cause)}
  return result;
}
