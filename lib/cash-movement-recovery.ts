export type CashMovementBody={
  requestKey:string;
  date:string;
  type:"CASH_IN"|"CASH_OUT";
  amount:number;
  reason:string;
  riskConfirmed:boolean;
};
export type CashMovementIntent={version:1;actorId:string;createdAt:number;body:CashMovementBody};
type StorageLike=Pick<Storage,"getItem"|"setItem"|"removeItem">;
export const CASH_MOVEMENT_INTENT_PREFIX="field-cash-movement-pending-v1:";
const storageKey=(actorId:string)=>CASH_MOVEMENT_INTENT_PREFIX+encodeURIComponent(actorId);
const recoveryError=(code:string,cause?:unknown)=>Object.assign(new Error(code),{status:0,cause});
function storageOrThrow(storage?:StorageLike){try{return storage||localStorage}catch(cause){throw recoveryError("cash_movement_recovery_unavailable",cause)}}
function validBody(b:any):b is CashMovementBody{
  return !!b&&typeof b==="object"&&typeof b.requestKey==="string"&&b.requestKey.length>=8&&b.requestKey.length<=120&&/^\d{4}-\d{2}-\d{2}$/.test(String(b.date||""))&&["CASH_IN","CASH_OUT"].includes(String(b.type||""))&&Number.isFinite(Number(b.amount))&&Number(b.amount)>0&&typeof b.reason==="string"&&b.reason.length>=2&&typeof b.riskConfirmed==="boolean";
}
export function readCashMovementIntent(actorId:string,storage?:StorageLike):CashMovementIntent|null{
  try{
    const raw=storageOrThrow(storage).getItem(storageKey(actorId));if(!raw)return null;
    const intent=JSON.parse(raw) as CashMovementIntent;
    if(intent?.version!==1||intent.actorId!==actorId||!Number.isFinite(intent.createdAt)||!validBody(intent.body))throw new Error("invalid_intent");
    return intent;
  }catch(cause){throw recoveryError("cash_movement_recovery_unavailable",cause)}
}
export function prepareCashMovementIntent(actorId:string,body:CashMovementBody,storage?:StorageLike):CashMovementIntent{
  const store=storageOrThrow(storage),old=readCashMovementIntent(actorId,store);
  if(old){
    if(JSON.stringify(old.body)!==JSON.stringify(body))throw recoveryError("pending_cash_movement_exists");
    return old;
  }
  if(!validBody(body))throw recoveryError("invalid_cash_movement");
  const intent:CashMovementIntent={version:1,actorId,createdAt:Date.now(),body:{...body}};
  try{
    const raw=JSON.stringify(intent);store.setItem(storageKey(actorId),raw);
    if(store.getItem(storageKey(actorId))!==raw)throw new Error("intent_not_persisted");
    return intent;
  }catch(cause){throw recoveryError("cash_movement_recovery_unavailable",cause)}
}
function clearIntent(intent:CashMovementIntent,storage:StorageLike){
  const current=readCashMovementIntent(intent.actorId,storage);
  if(current?.body.requestKey===intent.body.requestKey)storage.removeItem(storageKey(intent.actorId));
}
const NOT_COMMITTED=new Set(["invalid_request_key","invalid_date","invalid_cash_movement_type","invalid_cash_movement_amount","cash_movement_reason_required","high_risk_confirmation_required","high_risk_reason_required","business_date_changed","day_already_closed","cash_shift_not_open","drawer_cash_shortage"]);
export async function sendCashMovementIntent(intent:CashMovementIntent,send:(body:CashMovementBody)=>Promise<any>,storage?:StorageLike){
  const store=storageOrThrow(storage),current=readCashMovementIntent(intent.actorId,store);
  if(!current||JSON.stringify(current)!==JSON.stringify(intent))throw recoveryError("cash_movement_recovery_unavailable");
  let result:any;
  try{result=await send({...intent.body})}catch(error:any){
    if([400,409].includes(Number(error?.status))&&NOT_COMMITTED.has(String(error?.message||"")))clearIntent(intent,store);
    throw error;
  }
  const b=intent.body,m=result?.movement;
  const exact=result?.ok===true&&typeof m?.id==="string"&&m.id.length>0&&m.requestKey===b.requestKey&&m.createdBy===intent.actorId&&m.date===b.date&&m.type===b.type&&Number(m.amount)===b.amount&&m.reason===b.reason&&Number.isFinite(Number(result.availableCash));
  if(!exact)throw recoveryError("cash_movement_ack_unknown");
  try{clearIntent(intent,store)}catch(cause){throw recoveryError("cash_movement_recovery_unavailable",cause)}
  return result;
}
export function listCashMovementIntents(storage?:StorageLike&Pick<Storage,"length"|"key">):CashMovementIntent[]{
  const store=(storageOrThrow(storage) as StorageLike&Pick<Storage,"length"|"key">),out:CashMovementIntent[]=[];
  try{
    for(let i=0;i<store.length;i++){
      const key=store.key(i);if(!key||!key.startsWith(CASH_MOVEMENT_INTENT_PREFIX))continue;
      const actorId=decodeURIComponent(key.slice(CASH_MOVEMENT_INTENT_PREFIX.length));
      const intent=readCashMovementIntent(actorId,store);if(intent)out.push(intent);
    }
    return out;
  }catch(cause){throw recoveryError("cash_movement_recovery_unavailable",cause)}
}
