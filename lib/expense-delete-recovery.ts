export type ExpenseDeleteBody={requestKey:string;expenseId:string;date:string};
export type ExpenseDeleteIntent={version:1;actorId:string;createdAt:number;body:ExpenseDeleteBody};
type StorageLike=Pick<Storage,"getItem"|"setItem"|"removeItem">;
export const EXPENSE_DELETE_INTENT_PREFIX="field-expense-delete-pending-v1:";
const storageKey=(actorId:string)=>EXPENSE_DELETE_INTENT_PREFIX+encodeURIComponent(actorId);
const recoveryError=(code:string,cause?:unknown)=>Object.assign(new Error(code),{status:0,cause});
function storageOrThrow(storage?:StorageLike){try{return storage||localStorage}catch(cause){throw recoveryError("expense_delete_recovery_unavailable",cause)}}
function validBody(b:any):b is ExpenseDeleteBody{return !!b&&typeof b==="object"&&typeof b.requestKey==="string"&&b.requestKey.length>=8&&b.requestKey.length<=120&&typeof b.expenseId==="string"&&b.expenseId.length>0&&/^\d{4}-\d{2}-\d{2}$/.test(String(b.date||""))}
export function readExpenseDeleteIntent(actorId:string,storage?:StorageLike):ExpenseDeleteIntent|null{
  try{
    const raw=storageOrThrow(storage).getItem(storageKey(actorId));if(!raw)return null;
    const intent=JSON.parse(raw) as ExpenseDeleteIntent;
    if(intent?.version!==1||intent.actorId!==actorId||!Number.isFinite(intent.createdAt)||!validBody(intent.body))throw new Error("invalid_intent");
    return intent;
  }catch(cause){throw recoveryError("expense_delete_recovery_unavailable",cause)}
}
export function prepareExpenseDeleteIntent(actorId:string,body:ExpenseDeleteBody,storage?:StorageLike):ExpenseDeleteIntent{
  const store=storageOrThrow(storage),old=readExpenseDeleteIntent(actorId,store);
  if(old){
    if(JSON.stringify(old.body)!==JSON.stringify(body))throw recoveryError("pending_expense_delete_exists");
    return old;
  }
  if(!validBody(body))throw recoveryError("invalid_expense_delete");
  const intent:ExpenseDeleteIntent={version:1,actorId,createdAt:Date.now(),body:{...body}};
  try{
    const raw=JSON.stringify(intent);store.setItem(storageKey(actorId),raw);
    if(store.getItem(storageKey(actorId))!==raw)throw new Error("intent_not_persisted");
    return intent;
  }catch(cause){throw recoveryError("expense_delete_recovery_unavailable",cause)}
}
function clearIntent(intent:ExpenseDeleteIntent,storage:StorageLike){
  const current=readExpenseDeleteIntent(intent.actorId,storage);
  if(current?.body.requestKey===intent.body.requestKey)storage.removeItem(storageKey(intent.actorId));
}
const NOT_COMMITTED=new Set(["invalid_request_key","invalid_date","expense_not_found","expense_target_changed","day_closed","system_expense_read_only"]);
export async function sendExpenseDeleteIntent(intent:ExpenseDeleteIntent,send:(body:ExpenseDeleteBody)=>Promise<any>,storage?:StorageLike){
  const store=storageOrThrow(storage),current=readExpenseDeleteIntent(intent.actorId,store);
  if(!current||JSON.stringify(current)!==JSON.stringify(intent))throw recoveryError("expense_delete_recovery_unavailable");
  let result:any;
  try{result=await send({...intent.body})}catch(error:any){
    if([400,404,409].includes(Number(error?.status))&&NOT_COMMITTED.has(String(error?.message||"")))clearIntent(intent,store);
    throw error;
  }
  const b=intent.body;
  const exact=result?.ok===true&&result.deleted===true&&result.requestKey===b.requestKey&&result.expenseId===b.expenseId&&result.date===b.date;
  if(!exact)throw recoveryError("expense_delete_ack_unknown");
  try{clearIntent(intent,store)}catch(cause){throw recoveryError("expense_delete_recovery_unavailable",cause)}
  return result;
}
export function listExpenseDeleteIntents(storage?:StorageLike&Pick<Storage,"length"|"key">):ExpenseDeleteIntent[]{
  const store=(storageOrThrow(storage) as StorageLike&Pick<Storage,"length"|"key">),out:ExpenseDeleteIntent[]=[];
  try{
    for(let i=0;i<store.length;i++){
      const key=store.key(i);if(!key||!key.startsWith(EXPENSE_DELETE_INTENT_PREFIX))continue;
      const actorId=decodeURIComponent(key.slice(EXPENSE_DELETE_INTENT_PREFIX.length));
      const intent=readExpenseDeleteIntent(actorId,store);if(intent)out.push(intent);
    }
    return out;
  }catch(cause){throw recoveryError("expense_delete_recovery_unavailable",cause)}
}
