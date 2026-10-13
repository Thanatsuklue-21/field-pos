export type ExpenseBody={requestKey:string;date:string;amount:number;category:string;description:string;paymentMethod:string;riskConfirmed:boolean};
export type ExpenseIntent={version:1;actorId:string;createdAt:number;body:ExpenseBody};
type StorageLike=Pick<Storage,"getItem"|"setItem"|"removeItem">;
export const EXPENSE_INTENT_PREFIX="field-expense-pending-v1:";
const storageKey=(actorId:string)=>EXPENSE_INTENT_PREFIX+encodeURIComponent(actorId);
const recoveryError=(code:string,cause?:unknown)=>Object.assign(new Error(code),{status:0,cause});
function storageOrThrow(storage?:StorageLike){
  try{return storage||localStorage}catch(cause){throw recoveryError("expense_recovery_unavailable",cause)}
}
export function readExpenseIntent(actorId:string,storage?:StorageLike):ExpenseIntent|null{
  try{
    const raw=storageOrThrow(storage).getItem(storageKey(actorId));
    if(!raw)return null;
    const intent=JSON.parse(raw) as ExpenseIntent;
    const b=intent?.body;
    if(intent?.version!==1||intent.actorId!==actorId||!Number.isFinite(intent.createdAt)||!b||typeof b.requestKey!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||!Number.isFinite(b.amount)||b.amount<=0||typeof b.category!=="string"||typeof b.description!=="string"||typeof b.paymentMethod!=="string"||typeof b.riskConfirmed!=="boolean")throw new Error("invalid_intent");
    return intent;
  }catch(cause){throw recoveryError("expense_recovery_unavailable",cause)}
}
export function prepareExpenseIntent(actorId:string,body:ExpenseBody,storage?:StorageLike):ExpenseIntent{
  const store=storageOrThrow(storage),old=readExpenseIntent(actorId,store);
  if(old){
    if(JSON.stringify(old.body)!==JSON.stringify(body))throw recoveryError("pending_expense_exists");
    return old;
  }
  const intent:ExpenseIntent={version:1,actorId,createdAt:Date.now(),body:{...body}};
  try{
    store.setItem(storageKey(actorId),JSON.stringify(intent));
    if(store.getItem(storageKey(actorId))!==JSON.stringify(intent))throw new Error("intent_not_persisted");
    return intent;
  }catch(cause){throw recoveryError("expense_recovery_unavailable",cause)}
}
function clearExpenseIntent(intent:ExpenseIntent,storage:StorageLike){
  const current=readExpenseIntent(intent.actorId,storage);
  if(current?.body.requestKey===intent.body.requestKey)storage.removeItem(storageKey(intent.actorId));
}
// Only explicit, pre-commit validation rejections permit editing a fresh intent.
const NOT_COMMITTED=new Set(["invalid_expense","invalid_request_key","invalid_expense_payment_method","high_risk_confirmation_required","expense_reason_required","day_closed","cash_shift_not_open","drawer_cash_shortage"]);
export async function sendExpenseIntent(intent:ExpenseIntent,send:(body:ExpenseBody)=>Promise<any>,storage?:StorageLike){
  const store=storageOrThrow(storage),current=readExpenseIntent(intent.actorId,store);
  if(!current||JSON.stringify(current)!==JSON.stringify(intent))throw recoveryError("expense_recovery_unavailable");
  let result:any;
  try{result=await send({...intent.body})}catch(error:any){
    if([400,409].includes(error?.status)&&NOT_COMMITTED.has(error?.message))clearExpenseIntent(intent,store);
    throw error;
  }
  const b=intent.body,e=result?.expense;
  const exact=result?.ok===true&&typeof e?.id==="string"&&e.id.length>0&&e.requestKey===b.requestKey&&e.createdBy===intent.actorId&&e.date===b.date&&e.amount===b.amount&&e.category===b.category&&e.description===b.description&&e.paymentMethod===b.paymentMethod;
  if(!exact)throw recoveryError("expense_ack_unknown");
  try{clearExpenseIntent(intent,store)}catch(cause){throw recoveryError("expense_recovery_unavailable",cause)}
  return result;
}


export function listExpenseIntents(storage?:StorageLike&Pick<Storage,"length"|"key">):ExpenseIntent[]{
  const store=(storageOrThrow(storage) as StorageLike&Pick<Storage,"length"|"key">),out:ExpenseIntent[]=[];
  try{
    for(let i=0;i<store.length;i++){
      const key=store.key(i);
      if(!key||!key.startsWith(EXPENSE_INTENT_PREFIX))continue;
      const actorId=decodeURIComponent(key.slice(EXPENSE_INTENT_PREFIX.length));
      const intent=readExpenseIntent(actorId,store);
      if(intent)out.push(intent);
    }
    return out;
  }catch(cause){throw recoveryError("expense_recovery_unavailable",cause)}
}
