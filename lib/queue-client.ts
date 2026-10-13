import {api} from "@/lib/api-client";
import {QUEUE_PENDING_KEY,shouldRetainQueuePending,validatePendingQueueAction,validateQueueActionAck} from "@/lib/queue-action-recovery.mjs";

export type QueueActionBody={
  requestKey:string;
  orderId:string;
  action:string;
  itemIndex?:number;
  expectedReadyQty?:number;
  reason?:string;
  unit?:number;
  selected?:boolean;
};
export type PendingQueueAction={body:QueueActionBody;createdAt:number};

export function readPendingQueueAction():PendingQueueAction|null{
  let raw:string|null=null;
  try{raw=localStorage.getItem(QUEUE_PENDING_KEY)}catch{throw new Error("queue_recovery_storage_unavailable")}
  if(!raw)return null;
  try{return validatePendingQueueAction(JSON.parse(raw)) as PendingQueueAction}
  catch{throw new Error("queue_recovery_corrupt")}
}
export function writePendingQueueAction(body:QueueActionBody){
  try{localStorage.setItem(QUEUE_PENDING_KEY,JSON.stringify({body,createdAt:Date.now()}))}
  catch{throw new Error("queue_recovery_storage_unavailable")}
}
export function clearPendingQueueAction(){
  try{localStorage.removeItem(QUEUE_PENDING_KEY)}
  catch{throw new Error("queue_recovery_storage_unavailable")}
}

export async function sendQueueActionDurably(csrf:string,body:QueueActionBody){
  let pending=readPendingQueueAction();
  if(pending&&pending.body.requestKey!==body.requestKey)throw Object.assign(new Error("queue_action_pending"),{status:409});
  if(!pending){writePendingQueueAction(body);pending={body,createdAt:Date.now()}}
  try{
    const result=await api<any>("/api/pos/queue",{
      method:"POST",
      headers:{"X-CSRF-Token":csrf},
      body:JSON.stringify(pending.body)
    });
    validateQueueActionAck(result,pending.body);
    clearPendingQueueAction();
    return result;
  }catch(error:any){
    if(!shouldRetainQueuePending(error))clearPendingQueueAction();
    throw error;
  }
}

export function queueActionErrorText(code:string){
  return code==="fifo_violation"?"ต้องทำคิวแรกให้เสร็จก่อน ระบบไม่อนุญาตให้ข้ามคิว":
    code==="order_not_ready"?"ยังทำเครื่องดื่มไม่ครบ":
    code==="pager_already_called"?"คิวนี้เรียกลูกค้าแล้ว":
    code==="order_not_complete"?"คิวนี้ยังไม่พร้อมส่งมอบ":
    code==="waste_after_call_not_supported"?"เมนูนี้ถูกเรียกลูกค้าครบแล้ว จึงไม่ย้อนเป็นชงเสียอัตโนมัติ":
    code==="recipe_unavailable"?"ไม่พบสูตรที่ใช้ตอนขาย จึงบันทึกชงเสียอัตโนมัติไม่ได้":
    code.startsWith("stock_shortage:")?"วัตถุดิบไม่พอสำหรับทำใหม่ 1 แก้ว · กรุณาตรวจ Stock":
    code.startsWith("ingredient_missing:")?"สูตรอ้างวัตถุดิบที่ไม่มีใน Stock Master":
    code==="queue_state_changed"?"สถานะคิวเปลี่ยนแล้ว ระบบจะดึงข้อมูลล่าสุด":
    code==="queue_action_pending"?"มีการกดคิวก่อนหน้าที่ยังตรวจสอบไม่เสร็จ · ระบบจะตรวจรายการเดิมก่อน ห้ามกดซ้ำ":
    code==="queue_action_unconfirmed"?"ระบบยังยืนยันผลการกดคิวก่อนหน้าไม่ได้ · เก็บข้อมูลเดิมไว้เพื่อป้องกันตัดสต็อกหรือเปลี่ยนคิวซ้ำ":
    code==="queue_recovery_corrupt"?"ข้อมูลป้องกันการกดซ้ำในเครื่องมีปัญหา · หยุดเปลี่ยนสถานะคิวชั่วคราวและตรวจคิวเดิมก่อน":
    code==="queue_recovery_storage_unavailable"?"เครื่องนี้เก็บข้อมูลป้องกันการกดซ้ำไม่ได้ · ระบบจึงยังไม่เปลี่ยนสถานะคิว":
    code==="network_unavailable"?"ขาดการเชื่อมต่อ · ระบบเก็บการกดครั้งเดิมไว้และจะตรวจอีกครั้งเมื่อเชื่อมต่อ":
    code;
}
