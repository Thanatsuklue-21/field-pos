import {offlineCashListStrict,type OfflineCashRecord} from "@/lib/offline-db";
import {listExpenseIntents,type ExpenseIntent} from "@/lib/expense-recovery";
import {listCriticalWriteIntents,type CriticalWriteIntent} from "@/lib/critical-write-recovery";

export type CloseDayDeviceBlockerKind="offline_cash"|"cash_unknown"|"promptpay_unknown"|"expense_unknown"|"critical_write_unknown"|"storage_unreadable";
export type CloseDayDeviceBlocker={
  kind:CloseDayDeviceBlockerKind;
  title:string;
  detail:string;
  route?:"/pos"|"/orders"|"/expenses"|"/close"|"/stock";
  date?:string;
  actorId?:string;
  count?:number;
};
export type CloseDayDevicePreflight={ok:boolean;checkedAt:number;businessDate:string;blockers:CloseDayDeviceBlocker[]};

type DeviceStorage=Pick<Storage,"getItem"|"length"|"key">;
type CashPending={body:{requestKey:string;date:string;total?:number;received?:number};createdAt:number};
type PromptPending={requestKey:string;date:string;total:number;createdAt:number;paymentReference?:string};

const CASH_PENDING_KEY="field-pos-pending-cash-v1";
const PROMPT_PENDING_KEY="field-pos-pending-promptpay-v1";
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;

function parseCashPending(raw:string|null):CashPending|null{
  if(!raw)return null;
  const value=JSON.parse(raw) as CashPending,b=value?.body;
  if(!value||typeof value!=="object"||!Number.isFinite(value.createdAt)||!b||typeof b.requestKey!=="string"||b.requestKey.length<8||!DATE_RE.test(String(b.date||"")))throw new Error("device_recovery_unreadable");
  return value;
}
function parsePromptPending(raw:string|null):PromptPending|null{
  if(!raw)return null;
  const value=JSON.parse(raw) as PromptPending;
  if(!value||typeof value!=="object"||typeof value.requestKey!=="string"||value.requestKey.length<8||!DATE_RE.test(String(value.date||""))||!Number.isFinite(value.createdAt)||!Number.isFinite(Number(value.total)))throw new Error("device_recovery_unreadable");
  return value;
}
function validateOfflineRows(rows:OfflineCashRecord[]){
  for(const row of rows){
    const date=String(row?.body?.date||"");
    if(!row||typeof row.requestKey!=="string"||row.requestKey.length<8||!["pending","needs_review"].includes(String(row.status||""))||!DATE_RE.test(date))throw new Error("device_recovery_unreadable");
  }
  return rows;
}

export function buildCloseDayDevicePreflight(input:{
  actorId:string;
  businessDate:string;
  offlineRows:OfflineCashRecord[];
  cashPending:CashPending|null;
  promptPending:PromptPending|null;
  expenseIntents:ExpenseIntent[];
  criticalIntents:CriticalWriteIntent[];
  checkedAt?:number;
}):CloseDayDevicePreflight{
  const {actorId,businessDate}=input;
  if(!DATE_RE.test(businessDate))throw new Error("device_recovery_unreadable");
  const blockers:CloseDayDeviceBlocker[]=[];
  const offline=validateOfflineRows(input.offlineRows).filter(row=>String(row.body.date)===businessDate);
  if(offline.length){
    const pending=offline.filter(x=>x.status==="pending").length,review=offline.filter(x=>x.status==="needs_review").length;
    blockers.push({
      kind:"offline_cash",title:"ยังมีบิลเงินสด Offline ในเครื่องนี้",
      detail:"พบ "+offline.length+" บิลของวันนี้"+(pending?" · รอ Sync "+pending:"")+(review?" · ต้องตรวจ "+review:"")+" · Server ยังไม่เห็นบิลที่ยังไม่ Sync",
      route:"/pos",date:businessDate,count:offline.length
    });
  }
  if(input.cashPending?.body.date===businessDate){
    blockers.push({
      kind:"cash_unknown",title:"มีการรับเงินสดที่ผลยังไม่ชัด",
      detail:"Request …"+input.cashPending.body.requestKey.slice(-8)+" · ห้ามรับเงินหรือสร้างรายการใหม่แทนจนกว่าจะตรวจผลเดิม",
      route:"/pos",date:businessDate,count:1
    });
  }
  if(input.promptPending?.date===businessDate){
    blockers.push({
      kind:"promptpay_unknown",title:"มี PromptPay ที่ยังต้องตรวจผล",
      detail:"Request …"+input.promptPending.requestKey.slice(-8)+" · QR/Network unknown ไม่เท่ากับชำระล้มเหลว",
      route:"/orders",date:businessDate,count:1
    });
  }
  for(const intent of input.expenseIntents.filter(x=>x.body.date===businessDate)){
    blockers.push({
      kind:"expense_unknown",
      title:intent.actorId===actorId?"มีค่าใช้จ่ายที่ยังรอคำยืนยัน":"มีค่าใช้จ่ายค้างจากผู้ใช้อื่นบนเครื่องนี้",
      detail:(intent.actorId===actorId?"รายการของผู้ใช้ปัจจุบัน":"ผู้ใช้ "+intent.actorId)+" · ฿"+Number(intent.body.amount).toLocaleString()+" · Request …"+intent.body.requestKey.slice(-8),
      route:intent.actorId===actorId?"/expenses":undefined,date:businessDate,actorId:intent.actorId,count:1
    });
  }
  const criticalMeta:Record<string,{title:string;route:"/close"|"/stock"}>={
    cashMovement:{title:"มีรายการเงินสดเข้า/ออกที่ยังไม่ทราบผล",route:"/close"},
    stockTransaction:{title:"มีรายการ Stock ที่ยังไม่ทราบผล",route:"/stock"},
    cycleCountCommit:{title:"มีผลนับ Stock ของ Owner ที่ยังไม่ทราบผล",route:"/stock"},
    cycleCountProposal:{title:"มีผลนับ Stock ที่ส่ง Owner แล้วแต่ยังไม่ทราบผล",route:"/stock"}
  };
  for(const intent of input.criticalIntents||[]){
    const meta=criticalMeta[intent.operation];
    if(!meta)continue;
    const intentDate=String(intent.body?.date||intent.body?.purchaseDate||"");
    if(intent.operation==="cashMovement"&&intentDate&&intentDate!==businessDate)continue;
    blockers.push({
      kind:"critical_write_unknown",
      title:intent.actorId===actorId?meta.title:"มี Critical Write ค้างจากผู้ใช้อื่นบนเครื่องนี้",
      detail:(intent.actorId===actorId?"ผู้ใช้ปัจจุบัน":"ผู้ใช้ "+intent.actorId)+" · "+intent.operation+" · Request …"+String(intent.body.requestKey).slice(-8)+" · ห้ามสร้างรายการใหม่แทนจนกว่าจะยืนยันผลเดิม",
      route:intent.actorId===actorId?meta.route:undefined,date:intentDate||businessDate,actorId:intent.actorId,count:1
    });
  }
  return {ok:blockers.length===0,checkedAt:input.checkedAt??Date.now(),businessDate,blockers};
}

export async function readCloseDayDevicePreflight(actorId:string,businessDate:string,deps?:{
  storage?:DeviceStorage;
  listOffline?:()=>Promise<OfflineCashRecord[]>;
  listExpenses?:(storage?:any)=>ExpenseIntent[];
  listCritical?:(storage?:any)=>CriticalWriteIntent[];
  now?:()=>number;
}):Promise<CloseDayDevicePreflight>{
  try{
    const storage=deps?.storage||(localStorage as DeviceStorage);
    // Force a storage read before treating missing keys as an empty recovery state.
    storage.getItem("__field_close_day_probe__");
    const [offlineRows,cashPending,promptPending,expenseIntents,criticalIntents]=await Promise.all([
      (deps?.listOffline||offlineCashListStrict)(),
      Promise.resolve(parseCashPending(storage.getItem(CASH_PENDING_KEY))),
      Promise.resolve(parsePromptPending(storage.getItem(PROMPT_PENDING_KEY))),
      Promise.resolve((deps?.listExpenses||listExpenseIntents)(storage as any)),
      Promise.resolve((deps?.listCritical||listCriticalWriteIntents)(storage as any))
    ]);
    return buildCloseDayDevicePreflight({actorId,businessDate,offlineRows,cashPending,promptPending,expenseIntents,criticalIntents,checkedAt:(deps?.now||Date.now)()});
  }catch{
    return {
      ok:false,checkedAt:(deps?.now||Date.now)(),businessDate,
      blockers:[{kind:"storage_unreadable",title:"อ่านรายการค้างในเครื่องไม่ได้",detail:"ยังยืนยันไม่ได้ว่าเครื่องนี้ไม่มีบิล/การชำระ/ค่าใช้จ่ายค้าง · ห้ามปิดวันจนกว่าจะอ่าน recovery storage ได้"}]
    };
  }
}
