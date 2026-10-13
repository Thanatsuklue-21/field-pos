export type StockWriteOperation="stockTransaction"|"cycleCountCommit"|"cycleCountProposal"|"cycleCountProposalApprove"|"cycleCountProposalReject";
export type StockWriteBody=Record<string,any>&{requestKey:string};
export type StockWriteIntent<T extends StockWriteBody=StockWriteBody>={
  version:1;
  actorId:string;
  operation:StockWriteOperation;
  businessDate:string;
  createdAt:number;
  body:T;
};
type StorageLike=Pick<Storage,"getItem"|"setItem"|"removeItem">;
export const STOCK_WRITE_INTENT_PREFIX="field-stock-write-pending-v1:";
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const keyFor=(actorId:string)=>STOCK_WRITE_INTENT_PREFIX+encodeURIComponent(actorId);
const recoveryError=(code:string,cause?:unknown)=>Object.assign(new Error(code),{status:0,cause});

function storageOrThrow(storage?:StorageLike){
  try{return storage||localStorage}catch(cause){throw recoveryError("stock_recovery_unavailable",cause)}
}
function validOperation(value:any):value is StockWriteOperation{
  return ["stockTransaction","cycleCountCommit","cycleCountProposal","cycleCountProposalApprove","cycleCountProposalReject"].includes(String(value||""));
}
function validIntent<T extends StockWriteBody>(value:any,actorId:string):value is StockWriteIntent<T>{
  const body=value?.body;
  return value?.version===1&&value.actorId===actorId&&validOperation(value.operation)&&DATE_RE.test(String(value.businessDate||""))&&Number.isFinite(value.createdAt)&&body&&typeof body==="object"&&!Array.isArray(body)&&typeof body.requestKey==="string"&&/^[A-Za-z0-9._:-]{8,128}$/.test(body.requestKey);
}

export function readStockWriteIntent<T extends StockWriteBody>(actorId:string,storage?:StorageLike):StockWriteIntent<T>|null{
  try{
    const raw=storageOrThrow(storage).getItem(keyFor(actorId));
    if(!raw)return null;
    const intent=JSON.parse(raw);
    if(!validIntent<T>(intent,actorId))throw new Error("invalid_intent");
    return intent;
  }catch(cause){throw recoveryError("stock_recovery_unavailable",cause)}
}

export function prepareStockWriteIntent<T extends StockWriteBody>(actorId:string,operation:StockWriteOperation,businessDate:string,body:T,storage?:StorageLike):StockWriteIntent<T>{
  if(!DATE_RE.test(businessDate)||!validOperation(operation)||!body||typeof body!=="object"||typeof body.requestKey!=="string")throw recoveryError("invalid_stock_recovery_intent");
  const store=storageOrThrow(storage),existing=readStockWriteIntent<T>(actorId,store);
  if(existing){
    if(existing.operation!==operation||existing.businessDate!==businessDate||JSON.stringify(existing.body)!==JSON.stringify(body))throw recoveryError("pending_stock_write_exists");
    return existing;
  }
  const intent:StockWriteIntent<T>={version:1,actorId,operation,businessDate,createdAt:Date.now(),body:{...body}};
  const serialized=JSON.stringify(intent);
  try{
    store.setItem(keyFor(actorId),serialized);
    if(store.getItem(keyFor(actorId))!==serialized)throw new Error("intent_not_persisted");
    return intent;
  }catch(cause){throw recoveryError("stock_recovery_unavailable",cause)}
}

function clearIntent<T extends StockWriteBody>(intent:StockWriteIntent<T>,storage:StorageLike){
  const current=readStockWriteIntent<T>(intent.actorId,storage);
  if(current?.body.requestKey===intent.body.requestKey&&current.operation===intent.operation)storage.removeItem(keyFor(intent.actorId));
}

export async function sendStockWriteIntent<T extends StockWriteBody>(
  intent:StockWriteIntent<T>,
  send:(body:T)=>Promise<any>,
  exactAck:(result:any,body:T,intent:StockWriteIntent<T>)=>boolean,
  notCommitted:Set<string>,
  storage?:StorageLike
){
  const store=storageOrThrow(storage),current=readStockWriteIntent<T>(intent.actorId,store);
  if(!current||JSON.stringify(current)!==JSON.stringify(intent))throw recoveryError("stock_recovery_unavailable");
  let result:any;
  try{result=await send({...intent.body})}
  catch(error:any){
    if([400,404,409].includes(Number(error?.status))&&notCommitted.has(String(error?.message||"")))clearIntent(intent,store);
    throw error;
  }
  if(!exactAck(result,intent.body,intent))throw recoveryError("stock_ack_unknown");
  try{clearIntent(intent,store)}catch(cause){throw recoveryError("stock_recovery_unavailable",cause)}
  return result;
}

export function listStockWriteIntents(storage?:StorageLike&Pick<Storage,"length"|"key">):StockWriteIntent[]{
  const store=(storageOrThrow(storage) as StorageLike&Pick<Storage,"length"|"key">),out:StockWriteIntent[]=[];
  try{
    for(let i=0;i<store.length;i++){
      const key=store.key(i);
      if(!key||!key.startsWith(STOCK_WRITE_INTENT_PREFIX))continue;
      const actorId=decodeURIComponent(key.slice(STOCK_WRITE_INTENT_PREFIX.length));
      const intent=readStockWriteIntent(actorId,store);
      if(intent)out.push(intent);
    }
    return out;
  }catch(cause){throw recoveryError("stock_recovery_unavailable",cause)}
}
