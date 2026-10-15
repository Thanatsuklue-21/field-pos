import {offlineCashListStrict,type OfflineCashRecord} from "@/lib/offline-db";
import {listExpenseIntents,type ExpenseIntent} from "@/lib/expense-recovery";
import {listCashMovementIntents,type CashMovementIntent} from "@/lib/cash-movement-recovery";
import {listCashShiftOpenIntents,type CashShiftOpenIntent} from "@/lib/cash-shift-open-recovery";
import {listExpenseDeleteIntents,type ExpenseDeleteIntent} from "@/lib/expense-delete-recovery";
import {listStockWriteIntents,type StockWriteIntent} from "@/lib/stock-write-recovery";
import {listOrderMutationIntents,type OrderMutationIntent} from "@/lib/order-mutation-recovery";

export type CloseDayDeviceBlockerKind="offline_cash"|"cash_unknown"|"promptpay_unknown"|"expense_unknown"|"expense_delete_unknown"|"cash_shift_open_unknown"|"cash_movement_unknown"|"stock_write_unknown"|"order_mutation_unknown"|"storage_unreadable";
export type CloseDayDeviceBlocker={
  kind:CloseDayDeviceBlockerKind;
  title:string;
  detail:string;
  route?:"/pos"|"/orders"|"/expenses"|"/stock"|"/close";
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
  cashShiftOpenIntents?:CashShiftOpenIntent[];
  cashMovementIntents:CashMovementIntent[];
  expenseDeleteIntents:ExpenseDeleteIntent[];
  stockWriteIntents?:StockWriteIntent[];
  orderMutationIntents?:OrderMutationIntent[];
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
  for(const intent of (input.cashShiftOpenIntents||[]).filter(x=>x.body.date===businessDate)){
    blockers.push({
      kind:"cash_shift_open_unknown",
      title:intent.actorId===actorId?"มีคำสั่งเปิดร้านที่ยังรอคำยืนยัน":"มีคำสั่งเปิดร้านค้างจากผู้ใช้อื่นบนเครื่องนี้",
      detail:"เงินตั้งต้น ฿"+Number(intent.body.openingCash).toLocaleString()+" · Request …"+intent.body.requestKey.slice(-8)+" · ห้ามเปิดร้านซ้ำหรือปิดวันจนกว่าจะตรวจผลเดิม",
      route:intent.actorId===actorId?"/close":undefined,date:businessDate,actorId:intent.actorId,count:1
    });
  }
  for(const intent of input.cashMovementIntents.filter(x=>x.body.date===businessDate)){
    blockers.push({
      kind:"cash_movement_unknown",
      title:intent.actorId===actorId?"มีรายการเงินเข้า/ออกลิ้นชักที่ยังรอคำยืนยัน":"มีรายการลิ้นชักค้างจากผู้ใช้อื่นบนเครื่องนี้",
      detail:(intent.body.type==="CASH_IN"?"เติมเงินเข้า ":"นำเงินออก ")+"฿"+Number(intent.body.amount).toLocaleString()+" · Request …"+intent.body.requestKey.slice(-8),
      date:businessDate,actorId:intent.actorId,count:1
    });
  }
  for(const intent of input.expenseDeleteIntents.filter(x=>x.body.date===businessDate)){
    blockers.push({
      kind:"expense_delete_unknown",
      title:intent.actorId===actorId?"มีการลบค่าใช้จ่ายที่ยังไม่ทราบผล":"มีการลบค่าใช้จ่ายค้างจากผู้ใช้อื่นบนเครื่องนี้",
      detail:"รายจ่าย ฿"+Number(intent.body.expectedAmount).toLocaleString()+" · Request …"+intent.body.requestKey.slice(-8)+" · ยังห้ามสรุปยอดวันจนกว่าจะยืนยันว่าลบสำเร็จหรือไม่",
      route:intent.actorId===actorId?"/expenses":undefined,date:businessDate,actorId:intent.actorId,count:1
    });
  }
  for(const intent of (input.stockWriteIntents||[]).filter(x=>x.businessDate===businessDate)){
    const label=intent.operation==="ingredientCreate"?"การสร้าง Stock Master":intent.operation==="stockTransaction"?"รายการรับเข้า/ของเสีย":intent.operation==="cycleCountCommit"?"การปรับ Stock จากการนับจริง":intent.operation==="cycleCountProposal"?"ผลนับ Stock ที่รอส่ง":intent.operation==="cycleCountProposalApprove"?"การอนุมัติผลนับ Stock":intent.operation==="cycleCountProposalReject"?"การตีกลับผลนับ Stock":intent.operation==="purchaseEdit"?"การแก้รายการรับเข้า":"การยกเลิกรายการรับเข้า";
    blockers.push({
      kind:"stock_write_unknown",
      title:intent.actorId===actorId?label+" ที่ผลยังไม่ชัด":"มีรายการ Stock ค้างจากผู้ใช้อื่นบนเครื่องนี้",
      detail:(intent.actorId===actorId?"รายการของผู้ใช้ปัจจุบัน":"ผู้ใช้ "+intent.actorId)+" · Request …"+intent.body.requestKey.slice(-8)+" · ห้ามปิดวันจนกว่าจะยืนยันผลเดิม",
      route:intent.actorId===actorId?"/stock":undefined,date:businessDate,actorId:intent.actorId,count:1
    });
  }
  for(const intent of (input.orderMutationIntents||[]).filter(x=>x.businessDate===businessDate)){
    const action=intent.operation==="void"?"VOID":"Refund";
    blockers.push({
      kind:"order_mutation_unknown",
      title:intent.actorId===actorId?action+" บิลที่ผลยังไม่ชัด":"มี "+action+" ค้างจากผู้ใช้อื่นบนเครื่องนี้",
      detail:(intent.actorId===actorId?"รายการของผู้ใช้ปัจจุบัน":"ผู้ใช้ "+intent.actorId)+" · Sale "+intent.body.saleId+" · Request …"+intent.body.requestKey.slice(-8)+" · เงิน/Stock/ประวัติอาจถูกเปลี่ยนแล้ว ห้ามปิดวันจนกว่าจะตรวจ Request เดิม",
      route:intent.actorId===actorId?"/orders":undefined,date:businessDate,actorId:intent.actorId,count:1
    });
  }
  return {ok:blockers.length===0,checkedAt:input.checkedAt??Date.now(),businessDate,blockers};
}

export async function readCloseDayDevicePreflight(actorId:string,businessDate:string,deps?:{
  storage?:DeviceStorage;
  listOffline?:()=>Promise<OfflineCashRecord[]>;
  listExpenses?:(storage?:any)=>ExpenseIntent[];
  listCashShiftOpens?:(storage?:any)=>CashShiftOpenIntent[];
  listCashMovements?:(storage?:any)=>CashMovementIntent[];
  listExpenseDeletes?:(storage?:any)=>ExpenseDeleteIntent[];
  listStockWrites?:(storage?:any)=>StockWriteIntent[];
  listOrderMutations?:(storage?:any)=>OrderMutationIntent[];
  now?:()=>number;
}):Promise<CloseDayDevicePreflight>{
  try{
    const storage=deps?.storage||(localStorage as DeviceStorage);
    // Force a storage read before treating missing keys as an empty recovery state.
    storage.getItem("__field_close_day_probe__");
    const [offlineRows,cashPending,promptPending,expenseIntents,cashShiftOpenIntents,cashMovementIntents,expenseDeleteIntents,stockWriteIntents,orderMutationIntents]=await Promise.all([
      (deps?.listOffline||offlineCashListStrict)(),
      Promise.resolve(parseCashPending(storage.getItem(CASH_PENDING_KEY))),
      Promise.resolve(parsePromptPending(storage.getItem(PROMPT_PENDING_KEY))),
      Promise.resolve((deps?.listExpenses||listExpenseIntents)(storage as any)),
      Promise.resolve((deps?.listCashShiftOpens||listCashShiftOpenIntents)(storage as any)),
      Promise.resolve((deps?.listCashMovements||listCashMovementIntents)(storage as any)),
      Promise.resolve((deps?.listExpenseDeletes||listExpenseDeleteIntents)(storage as any)),
      Promise.resolve((deps?.listStockWrites||listStockWriteIntents)(storage as any)),
      Promise.resolve((deps?.listOrderMutations||listOrderMutationIntents)(storage as any))
    ]);
    return buildCloseDayDevicePreflight({actorId,businessDate,offlineRows,cashPending,promptPending,expenseIntents,cashShiftOpenIntents,cashMovementIntents,expenseDeleteIntents,stockWriteIntents,orderMutationIntents,checkedAt:(deps?.now||Date.now)()});
  }catch{
    return {
      ok:false,checkedAt:(deps?.now||Date.now)(),businessDate,
      blockers:[{kind:"storage_unreadable",title:"อ่านรายการค้างในเครื่องไม่ได้",detail:"ยังยืนยันไม่ได้ว่าเครื่องนี้ไม่มีธุรกรรมค้าง เช่น บิล การชำระ รายจ่าย เปิดร้าน เงินเข้า/ออกลิ้นชัก Stock หรือ VOID/Refund · ห้ามปิดวันจนกว่าจะอ่าน recovery storage ได้"}]
    };
  }
}
