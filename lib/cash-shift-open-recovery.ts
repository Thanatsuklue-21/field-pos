export type CashShiftOpenBody={
  requestKey:string;
  date:string;
  openingCash:number;
};
export type CashShiftOpenIntent={
  version:1;
  actorId:string;
  createdAt:number;
  body:CashShiftOpenBody;
};

type StorageLike=Pick<Storage,"getItem"|"setItem"|"removeItem">;
export const CASH_SHIFT_OPEN_INTENT_PREFIX="field-cash-shift-open-pending-v1:";
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const keyFor=(actorId:string)=>CASH_SHIFT_OPEN_INTENT_PREFIX+encodeURIComponent(actorId);
const fail=(code:string,cause?:unknown)=>Object.assign(new Error(code),{status:0,cause});

function storageOrThrow(storage?:StorageLike){
  try{return storage||localStorage}catch(cause){throw fail("cash_shift_open_recovery_unavailable",cause)}
}
function satang(value:any){
  const amount=Number(value);
  return Number.isFinite(amount)&&Math.abs(amount*100-Math.round(amount*100))<1e-7;
}
function validBody(body:any):body is CashShiftOpenBody{
  return !!body&&typeof body==="object"&&!Array.isArray(body)
    &&typeof body.requestKey==="string"&&/^[A-Za-z0-9._:-]{8,128}$/.test(body.requestKey)
    &&DATE_RE.test(String(body.date||""))
    &&Number.isFinite(Number(body.openingCash))&&Number(body.openingCash)>=0&&Number(body.openingCash)<=1e7
    &&satang(body.openingCash);
}

export function readCashShiftOpenIntent(actorId:string,storage?:StorageLike):CashShiftOpenIntent|null{
  try{
    const raw=storageOrThrow(storage).getItem(keyFor(actorId));
    if(!raw)return null;
    const intent=JSON.parse(raw) as CashShiftOpenIntent;
    if(intent?.version!==1||intent.actorId!==actorId||!Number.isFinite(intent.createdAt)||!validBody(intent.body))throw new Error("invalid_intent");
    return intent;
  }catch(cause){throw fail("cash_shift_open_recovery_unavailable",cause)}
}

export function prepareCashShiftOpenIntent(actorId:string,body:CashShiftOpenBody,storage?:StorageLike):CashShiftOpenIntent{
  if(!validBody(body))throw fail("invalid_cash_shift_open_intent");
  const store=storageOrThrow(storage),existing=readCashShiftOpenIntent(actorId,store);
  if(existing){
    if(JSON.stringify(existing.body)!==JSON.stringify(body))throw fail("pending_cash_shift_open_exists");
    return existing;
  }
  const intent:CashShiftOpenIntent={version:1,actorId,createdAt:Date.now(),body:{...body}};
  const raw=JSON.stringify(intent);
  try{
    store.setItem(keyFor(actorId),raw);
    if(store.getItem(keyFor(actorId))!==raw)throw new Error("intent_not_persisted");
    return intent;
  }catch(cause){throw fail("cash_shift_open_recovery_unavailable",cause)}
}

function clearIntent(intent:CashShiftOpenIntent,storage:StorageLike){
  const current=readCashShiftOpenIntent(intent.actorId,storage);
  if(current?.body.requestKey===intent.body.requestKey)storage.removeItem(keyFor(intent.actorId));
}

const NOT_COMMITTED=new Set([
  "invalid_request_key","invalid_date","invalid_opening_cash","business_date_changed",
  "day_already_closed","cash_shift_already_opened","admin_required"
]);

export async function sendCashShiftOpenIntent(
  intent:CashShiftOpenIntent,
  send:(body:CashShiftOpenBody)=>Promise<any>,
  storage?:StorageLike
){
  const store=storageOrThrow(storage),current=readCashShiftOpenIntent(intent.actorId,store);
  if(!current||JSON.stringify(current)!==JSON.stringify(intent))throw fail("cash_shift_open_recovery_unavailable");
  let result:any;
  try{result=await send({...intent.body})}
  catch(error:any){
    if([400,403,409].includes(Number(error?.status))&&NOT_COMMITTED.has(String(error?.message||"")))clearIntent(intent,store);
    throw error;
  }
  const body=intent.body,shift=result?.shift;
  const exact=result?.ok===true
    &&String(result.requestKey||"")===body.requestKey
    &&String(result.performedBy||"")===intent.actorId
    &&typeof shift?.id==="string"&&shift.id.length>0
    &&String(shift.requestKey||"")===body.requestKey
    &&String(shift.openedBy||"")===intent.actorId
    &&String(shift.date||"")===body.date
    &&Number(shift.openingCash)===body.openingCash;
  if(!exact)throw fail("cash_shift_open_ack_unknown");
  try{clearIntent(intent,store)}catch(cause){throw fail("cash_shift_open_recovery_unavailable",cause)}
  return result;
}

export function listCashShiftOpenIntents(storage?:StorageLike&Pick<Storage,"length"|"key">):CashShiftOpenIntent[]{
  const store=storageOrThrow(storage) as StorageLike&Pick<Storage,"length"|"key">,out:CashShiftOpenIntent[]=[];
  try{
    for(let i=0;i<store.length;i++){
      const key=store.key(i);
      if(!key||!key.startsWith(CASH_SHIFT_OPEN_INTENT_PREFIX))continue;
      const actorId=decodeURIComponent(key.slice(CASH_SHIFT_OPEN_INTENT_PREFIX.length));
      const intent=readCashShiftOpenIntent(actorId,store);
      if(intent)out.push(intent);
    }
    return out;
  }catch(cause){throw fail("cash_shift_open_recovery_unavailable",cause)}
}
