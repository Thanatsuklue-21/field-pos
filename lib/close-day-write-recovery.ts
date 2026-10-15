export type CloseDayReviewBody={requestKey:string;operation:"review";date:string;firstCount:number;secondCount:number};
export type CloseDayCommitBody={requestKey:string;operation:"close";date:string;openingCash:number;countedCash:number;reviewId:string;varianceReason:string;confirmVariance:boolean};
export type CloseDayWriteBody=CloseDayReviewBody|CloseDayCommitBody;
export type CloseDayWriteIntent={version:1;actorId:string;createdAt:number;body:CloseDayWriteBody};
type StorageLike=Pick<Storage,"getItem"|"setItem"|"removeItem">;
export const CLOSE_DAY_WRITE_INTENT_PREFIX="field-close-day-write-pending-v1:";
const REQUEST_KEY_RE=/^[A-Za-z0-9._:-]{8,128}$/;
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const keyFor=(actorId:string)=>CLOSE_DAY_WRITE_INTENT_PREFIX+encodeURIComponent(actorId);
const fail=(code:string,cause?:unknown)=>Object.assign(new Error(code),{status:0,cause});

function storageOrThrow(storage?:StorageLike){
  try{return storage||localStorage}catch(cause){throw fail("close_day_recovery_unavailable",cause)}
}
function money(value:any){const n=Number(value);return Number.isFinite(n)?n:NaN}
function normalize(body:CloseDayWriteBody):CloseDayWriteBody{
  if(body.operation==="review")return {requestKey:String(body.requestKey||"").trim(),operation:"review",date:String(body.date||""),firstCount:money(body.firstCount),secondCount:money(body.secondCount)};
  return {
    requestKey:String(body.requestKey||"").trim(),operation:"close",date:String(body.date||""),
    openingCash:money(body.openingCash),countedCash:money(body.countedCash),reviewId:String(body.reviewId||""),
    varianceReason:String(body.varianceReason||"").trim().slice(0,240),confirmVariance:body.confirmVariance===true
  };
}
function valid(body:any):body is CloseDayWriteBody{
  if(!body||typeof body!=="object"||Array.isArray(body)||typeof body.requestKey!=="string"||!REQUEST_KEY_RE.test(body.requestKey)||!DATE_RE.test(String(body.date||"")))return false;
  if(body.operation==="review")return Number.isFinite(body.firstCount)&&body.firstCount>=0&&body.firstCount<=1e7&&Number.isFinite(body.secondCount)&&body.secondCount>=0&&body.secondCount<=1e7;
  if(body.operation==="close")return Number.isFinite(body.openingCash)&&body.openingCash>=0&&body.openingCash<=1e7&&Number.isFinite(body.countedCash)&&body.countedCash>=0&&body.countedCash<=1e7
    &&typeof body.reviewId==="string"&&body.reviewId.length>0&&typeof body.varianceReason==="string"&&body.varianceReason.length<=240&&typeof body.confirmVariance==="boolean";
  return false;
}
export function readCloseDayWriteIntent(actorId:string,storage?:StorageLike):CloseDayWriteIntent|null{
  try{
    const raw=storageOrThrow(storage).getItem(keyFor(actorId));
    if(!raw)return null;
    const intent=JSON.parse(raw) as CloseDayWriteIntent;
    if(intent?.version!==1||intent.actorId!==actorId||!Number.isFinite(intent.createdAt)||!valid(intent.body))throw new Error("invalid_intent");
    return intent;
  }catch(cause){throw fail("close_day_recovery_unavailable",cause)}
}
export function prepareCloseDayWriteIntent(actorId:string,body:CloseDayWriteBody,storage?:StorageLike):CloseDayWriteIntent{
  const normalized=normalize(body);
  if(!valid(normalized))throw fail("invalid_close_day_recovery_intent");
  const store=storageOrThrow(storage),existing=readCloseDayWriteIntent(actorId,store);
  if(existing){
    if(JSON.stringify(existing.body)!==JSON.stringify(normalized))throw fail("pending_close_day_write_exists");
    return existing;
  }
  const intent:CloseDayWriteIntent={version:1,actorId,createdAt:Date.now(),body:normalized};
  const raw=JSON.stringify(intent);
  try{
    store.setItem(keyFor(actorId),raw);
    if(store.getItem(keyFor(actorId))!==raw)throw new Error("intent_not_persisted");
    return intent;
  }catch(cause){throw fail("close_day_recovery_unavailable",cause)}
}
function clearIntent(intent:CloseDayWriteIntent,storage:StorageLike){
  const current=readCloseDayWriteIntent(intent.actorId,storage);
  if(current?.body.requestKey===intent.body.requestKey&&current.body.operation===intent.body.operation)storage.removeItem(keyFor(intent.actorId));
}
const NOT_COMMITTED_OR_AUTHORITATIVE=new Set([
  "login_required","csrf_denied","admin_required","invalid_request_key","invalid_date","business_date_changed",
  "first_cash_count_required","second_cash_count_required","cash_recount_mismatch","day_already_closed","cash_shift_not_open",
  "close_day_pending_payments","close_day_pending_stock_count_approval","close_day_open_orders","accounting_reconciliation_failed",
  "invalid_opening_cash","counted_cash_required","close_day_review_required","close_day_review_expired","close_day_review_stale",
  "close_day_review_count_changed","cash_variance_reason_required","cash_variance_owner_confirmation_required"
]);
function clearable(error:any){
  return [400,401,403,404,409,422].includes(Number(error?.status))&&NOT_COMMITTED_OR_AUTHORITATIVE.has(String(error?.message||""));
}
export function exactCloseDayWriteAck(result:any,intent:CloseDayWriteIntent){
  const b=intent.body;
  if(result?.ok!==true||String(result.requestKey||"")!==b.requestKey||String(result.performedBy||"")!==intent.actorId||String(result.operation||"")!==b.operation)return false;
  if(b.operation==="review"){
    const review=result?.review;
    return typeof review?.id==="string"&&review.id.length>0&&String(review.date||"")===b.date&&String(review.createdBy||"")===intent.actorId
      &&Number(review.countedCash)===b.secondCount;
  }
  const close=result?.close;
  return typeof close?.id==="string"&&close.id.length>0&&String(close.date||"")===b.date&&String(close.closedBy||"")===intent.actorId
    &&Number(close.openingCash)===b.openingCash&&Number(close.countedCash)===b.countedCash&&String(close.reviewId||"")===b.reviewId
    &&String(close.varianceReason||"")===(Number(close.cashVariance)===0?"":b.varianceReason);
}
export async function sendCloseDayWriteIntent(intent:CloseDayWriteIntent,send:(body:CloseDayWriteBody)=>Promise<any>,storage?:StorageLike){
  const store=storageOrThrow(storage),current=readCloseDayWriteIntent(intent.actorId,store);
  if(!current||JSON.stringify(current)!==JSON.stringify(intent))throw fail("close_day_recovery_unavailable");
  let result:any;
  try{result=await send(JSON.parse(JSON.stringify(intent.body)))}
  catch(error:any){
    if(clearable(error))clearIntent(intent,store);
    throw error;
  }
  if(!exactCloseDayWriteAck(result,intent))throw fail("close_day_ack_unknown");
  try{clearIntent(intent,store)}catch(cause){throw fail("close_day_recovery_unavailable",cause)}
  return result;
}
export function listCloseDayWriteIntents(storage?:StorageLike&Pick<Storage,"length"|"key">):CloseDayWriteIntent[]{
  const store=(storageOrThrow(storage) as StorageLike&Pick<Storage,"length"|"key">),out:CloseDayWriteIntent[]=[];
  try{
    for(let i=0;i<store.length;i++){
      const key=store.key(i);
      if(!key||!key.startsWith(CLOSE_DAY_WRITE_INTENT_PREFIX))continue;
      const actorId=decodeURIComponent(key.slice(CLOSE_DAY_WRITE_INTENT_PREFIX.length));
      const intent=readCloseDayWriteIntent(actorId,store);
      if(intent)out.push(intent);
    }
    return out;
  }catch(cause){throw fail("close_day_recovery_unavailable",cause)}
}
