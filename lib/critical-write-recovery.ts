export type CriticalWriteBody=Record<string,any>&{requestKey:string};
export type CriticalWriteIntent<T extends CriticalWriteBody=CriticalWriteBody>={version:1;actorId:string;operation:string;createdAt:number;body:T};
type StorageLike=Pick<Storage,"getItem"|"setItem"|"removeItem">;

const keyFor=(actorId:string,operation:string)=>"field-critical-write-v1:"+encodeURIComponent(actorId)+":"+encodeURIComponent(operation);
const recoveryError=(code:string,cause?:unknown)=>Object.assign(new Error(code),{status:0,cause});
function storageOrThrow(storage?:StorageLike){
  try{return storage||localStorage}catch(cause){throw recoveryError("critical_recovery_unavailable",cause)}
}
function validIntent<T extends CriticalWriteBody>(value:any,actorId:string,operation:string):value is CriticalWriteIntent<T>{
  const body=value?.body;
  return value?.version===1&&value.actorId===actorId&&value.operation===operation&&Number.isFinite(value.createdAt)&&body&&typeof body==="object"&&!Array.isArray(body)&&typeof body.requestKey==="string"&&/^[A-Za-z0-9:_-]{8,120}$/.test(body.requestKey);
}

export function readCriticalWriteIntent<T extends CriticalWriteBody>(actorId:string,operation:string,storage?:StorageLike):CriticalWriteIntent<T>|null{
  try{
    const raw=storageOrThrow(storage).getItem(keyFor(actorId,operation));
    if(!raw)return null;
    const intent=JSON.parse(raw);
    if(!validIntent<T>(intent,actorId,operation))throw new Error("invalid_intent");
    return intent;
  }catch(cause){throw recoveryError("critical_recovery_unavailable",cause)}
}

export function prepareCriticalWriteIntent<T extends CriticalWriteBody>(actorId:string,operation:string,body:T,storage?:StorageLike):CriticalWriteIntent<T>{
  const store=storageOrThrow(storage),existing=readCriticalWriteIntent<T>(actorId,operation,store);
  if(existing){
    if(JSON.stringify(existing.body)!==JSON.stringify(body))throw recoveryError("pending_critical_write_exists");
    return existing;
  }
  const intent:CriticalWriteIntent<T>={version:1,actorId,operation,createdAt:Date.now(),body:{...body}};
  const serialized=JSON.stringify(intent);
  try{
    store.setItem(keyFor(actorId,operation),serialized);
    if(store.getItem(keyFor(actorId,operation))!==serialized)throw new Error("intent_not_persisted");
    return intent;
  }catch(cause){throw recoveryError("critical_recovery_unavailable",cause)}
}

function clearCriticalWriteIntent<T extends CriticalWriteBody>(intent:CriticalWriteIntent<T>,storage:StorageLike){
  const current=readCriticalWriteIntent<T>(intent.actorId,intent.operation,storage);
  if(current?.body.requestKey===intent.body.requestKey)storage.removeItem(keyFor(intent.actorId,intent.operation));
}

export async function sendCriticalWriteIntent<T extends CriticalWriteBody>(
  intent:CriticalWriteIntent<T>,
  send:(body:T)=>Promise<any>,
  exactAck:(result:any,body:T,intent:CriticalWriteIntent<T>)=>boolean,
  notCommitted:Set<string>,
  storage?:StorageLike
){
  const store=storageOrThrow(storage),current=readCriticalWriteIntent<T>(intent.actorId,intent.operation,store);
  if(!current||JSON.stringify(current)!==JSON.stringify(intent))throw recoveryError("critical_recovery_unavailable");
  let result:any;
  try{result=await send({...intent.body})}
  catch(error:any){
    if([400,409].includes(Number(error?.status))&&notCommitted.has(String(error?.message||"")))clearCriticalWriteIntent(intent,store);
    throw error;
  }
  if(!exactAck(result,intent.body,intent))throw recoveryError("critical_ack_unknown");
  try{clearCriticalWriteIntent(intent,store)}catch(cause){throw recoveryError("critical_recovery_unavailable",cause)}
  return result;
}
