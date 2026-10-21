export type SettlementReconcileBody={requestKey:string;operation:"reconcile";saleDate:string;platform:string;receivedAmount:number;receivedDate:string;note:string};
export type SettlementCancelBody={requestKey:string;operation:"cancel";settlementId:string;reason:string};
export type SettlementWriteBody=SettlementReconcileBody|SettlementCancelBody;
export type SettlementWriteIntent={version:1;actorId:string;createdAt:number;body:SettlementWriteBody};
type StorageLike=Pick<Storage,"getItem"|"setItem"|"removeItem">;
export const SETTLEMENT_WRITE_INTENT_PREFIX="field-settlement-write-pending-v1:";
const REQUEST_KEY_RE=/^[A-Za-z0-9._:-]{8,128}$/;
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const keyFor=(actorId:string)=>SETTLEMENT_WRITE_INTENT_PREFIX+encodeURIComponent(actorId);
const fail=(code:string,cause?:unknown)=>Object.assign(new Error(code),{status:0,cause});

function storageOrThrow(storage?:StorageLike){
  try{return storage||localStorage}catch(cause){throw fail("settlement_recovery_unavailable",cause)}
}
function normalizeBody(body:SettlementWriteBody):SettlementWriteBody{
  if(body.operation==="reconcile")return {
    requestKey:String(body.requestKey||"").trim(),operation:"reconcile",
    saleDate:String(body.saleDate||""),platform:String(body.platform||"").trim(),
    receivedAmount:Number(body.receivedAmount),receivedDate:String(body.receivedDate||""),
    note:String(body.note||"").trim().slice(0,300)
  };
  return {requestKey:String(body.requestKey||"").trim(),operation:"cancel",settlementId:String(body.settlementId||""),reason:String(body.reason||"").trim().slice(0,300)};
}
function validBody(body:any):body is SettlementWriteBody{
  if(!body||typeof body!=="object"||Array.isArray(body)||typeof body.requestKey!=="string"||!REQUEST_KEY_RE.test(body.requestKey))return false;
  if(body.operation==="reconcile")return DATE_RE.test(body.saleDate)&&typeof body.platform==="string"&&body.platform.length>0&&body.platform!=="store"
    &&Number.isFinite(body.receivedAmount)&&body.receivedAmount>=0&&DATE_RE.test(body.receivedDate)&&typeof body.note==="string"&&body.note.length<=300;
  if(body.operation==="cancel")return typeof body.settlementId==="string"&&body.settlementId.length>0&&typeof body.reason==="string"&&body.reason.length>=2&&body.reason.length<=300;
  return false;
}
export function readSettlementWriteIntent(actorId:string,storage?:StorageLike):SettlementWriteIntent|null{
  try{
    const raw=storageOrThrow(storage).getItem(keyFor(actorId));
    if(!raw)return null;
    const intent=JSON.parse(raw) as SettlementWriteIntent;
    if(intent?.version!==1||intent.actorId!==actorId||!Number.isFinite(intent.createdAt)||!validBody(intent.body))throw new Error("invalid_intent");
    return intent;
  }catch(cause){throw fail("settlement_recovery_unavailable",cause)}
}
export function prepareSettlementWriteIntent(actorId:string,body:SettlementWriteBody,storage?:StorageLike):SettlementWriteIntent{
  const normalized=normalizeBody(body);
  if(!validBody(normalized))throw fail("invalid_settlement_recovery_intent");
  const store=storageOrThrow(storage),existing=readSettlementWriteIntent(actorId,store);
  if(existing){
    if(JSON.stringify(existing.body)!==JSON.stringify(normalized))throw fail("pending_settlement_write_exists");
    return existing;
  }
  const intent:SettlementWriteIntent={version:1,actorId,createdAt:Date.now(),body:normalized};
  const raw=JSON.stringify(intent);
  try{
    store.setItem(keyFor(actorId),raw);
    if(store.getItem(keyFor(actorId))!==raw)throw new Error("intent_not_persisted");
    return intent;
  }catch(cause){throw fail("settlement_recovery_unavailable",cause)}
}
function clearIntent(intent:SettlementWriteIntent,storage:StorageLike){
  const current=readSettlementWriteIntent(intent.actorId,storage);
  if(current?.body.requestKey===intent.body.requestKey&&current.body.operation===intent.body.operation)storage.removeItem(keyFor(intent.actorId));
}
const NOT_COMMITTED=new Set([
  "login_required","csrf_denied","admin_required","invalid_request_key",
  "invalid_received_amount","invalid_settlement_date","invalid_delivery_platform","delivery_settlement_group_not_found",
  "settlement_cancel_reason_required","settlement_not_found","settlement_already_cancelled"
]);
function definitelyNotCommitted(error:any){
  return [400,401,403,404,409,422].includes(Number(error?.status))&&NOT_COMMITTED.has(String(error?.message||""));
}
export function exactSettlementWriteAck(result:any,intent:SettlementWriteIntent){
  const body=intent.body;
  if(result?.ok!==true||String(result.requestKey||"")!==body.requestKey||String(result.performedBy||"")!==intent.actorId||String(result.operation||"")!==body.operation)return false;
  if(body.operation==="reconcile"){
    const rec=result?.reconciliation;
    return typeof rec?.id==="string"&&rec.id.length>0&&String(rec.saleDate||"")===body.saleDate&&String(rec.platform||"")===body.platform
      &&Number(rec.receivedAmount)===Math.round((body.receivedAmount+Number.EPSILON)*100)/100&&String(rec.receivedDate||"")===body.receivedDate&&String(rec.note||"")===body.note;
  }
  return String(result.id||"")===body.settlementId&&String(result.reason||"")===body.reason&&Number.isFinite(Number(result.cancelledAt))&&String(result.cancelledBy||"")===intent.actorId;
}
export async function sendSettlementWriteIntent(intent:SettlementWriteIntent,send:(body:SettlementWriteBody)=>Promise<any>,storage?:StorageLike){
  const store=storageOrThrow(storage),current=readSettlementWriteIntent(intent.actorId,store);
  if(!current||JSON.stringify(current)!==JSON.stringify(intent))throw fail("settlement_recovery_unavailable");
  let result:any;
  try{result=await send(JSON.parse(JSON.stringify(intent.body)))}
  catch(error:any){
    if(definitelyNotCommitted(error))clearIntent(intent,store);
    throw error;
  }
  if(!exactSettlementWriteAck(result,intent))throw fail("settlement_ack_unknown");
  try{clearIntent(intent,store)}catch(cause){throw fail("settlement_recovery_unavailable",cause)}
  return result;
}
