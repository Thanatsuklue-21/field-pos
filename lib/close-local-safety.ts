import {readExpenseIntent} from "@/lib/expense-recovery";
import {getOfflineCashSummary} from "@/lib/offline-sales";

export type CloseLocalBlocker={
  kind:"promptpay"|"cash_checkout"|"expense"|"offline_cash"|"cash_edit"|"storage";
  label:string;
  detail:string;
  href:"/pos"|"/expenses"|"/orders";
};

export type CloseLocalSafety={
  safe:boolean;
  checkedAt:number;
  blockers:CloseLocalBlocker[];
};

const PROMPTPAY_KEY="field-pos-pending-promptpay-v1";
const CASH_CHECKOUT_KEY="field-pos-pending-cash-v1";
const CASH_EDIT_KEY="field-pos-edit-cash-v1";

export async function inspectCloseLocalSafety(actorId:string):Promise<CloseLocalSafety>{
  const blockers:CloseLocalBlocker[]=[];
  let local:Storage|null=null,session:Storage|null=null;

  try{
    local=window.localStorage;
    session=window.sessionStorage;
    const prompt=local.getItem(PROMPTPAY_KEY);
    const cash=local.getItem(CASH_CHECKOUT_KEY);
    if(prompt)blockers.push({kind:"promptpay",label:"PromptPay ยังรอตรวจผล",detail:"มีรายการรับชำระที่อุปกรณ์นี้ยังยืนยันผลไม่ได้ ต้อง reconcile ก่อนปิดวัน",href:"/pos"});
    if(cash)blockers.push({kind:"cash_checkout",label:"บิลเงินสดยังรอตรวจผล",detail:"มี checkout เงินสดที่ส่งแล้วแต่ผลตอบกลับยังไม่แน่ชัด ต้องตรวจ request เดิมก่อน",href:"/pos"});
    const expense=readExpenseIntent(actorId,local);
    if(expense)blockers.push({kind:"expense",label:"ค่าใช้จ่ายยังรอตรวจผล",detail:"มีค่าใช้จ่ายที่เก็บ request เดิมไว้เพื่อป้องกันยอดซ้ำ ต้องยืนยันผลก่อนปิดวัน",href:"/expenses"});
    if(session.getItem(CASH_EDIT_KEY))blockers.push({kind:"cash_edit",label:"กำลังแก้บิลเงินสดเดิม",detail:"มี flow แก้บิลที่ยัง checkout ใหม่ไม่จบ ต้องกลับไปทำรายการให้เสร็จก่อน",href:"/pos"});
  }catch{
    blockers.push({kind:"storage",label:"อ่าน Recovery ในเครื่องไม่ได้",detail:"ระบบยืนยันไม่ได้ว่าอุปกรณ์นี้ไม่มีรายการค้าง จึงหยุด Close Day เพื่อป้องกันยอดหายหรือยอดซ้ำ",href:"/pos"});
  }

  try{
    const outbox=await getOfflineCashSummary();
    if(outbox.total>0)blockers.push({
      kind:"offline_cash",
      label:"มีบิล Offline ค้าง "+outbox.total+" รายการ",
      detail:"รอ Sync "+outbox.pending+" · ต้องตรวจ "+outbox.needsReview+" · ต้องเคลียร์ทุกบิลก่อนปิดวัน",
      href:"/pos"
    });
  }catch{
    if(!blockers.some(x=>x.kind==="storage"))blockers.push({kind:"storage",label:"อ่าน Offline Cash ไม่ได้",detail:"ระบบยืนยันไม่ได้ว่า IndexedDB ไม่มีบิล Offline ค้าง จึงหยุด Close Day",href:"/pos"});
  }

  return {safe:blockers.length===0,checkedAt:Date.now(),blockers};
}
