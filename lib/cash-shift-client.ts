import {api} from "./api-client";
import {CASH_SHIFT_OPEN_PENDING_KEY,shouldRetainCashShiftOpenPending,validateCashShiftOpenAck,validatePendingCashShiftOpen} from "./cash-shift-open-recovery.mjs";

export type CashShiftOpenBody={requestKey:string;openingCash:number};
export type PendingCashShiftOpen={body:CashShiftOpenBody;createdAt:number};

export function readPendingCashShiftOpen():PendingCashShiftOpen|null{
  let raw:string|null=null;
  try{raw=localStorage.getItem(CASH_SHIFT_OPEN_PENDING_KEY)}catch{throw new Error("cash_shift_open_recovery_storage_unavailable")}
  if(!raw)return null;
  try{return validatePendingCashShiftOpen(JSON.parse(raw)) as PendingCashShiftOpen}catch{throw new Error("cash_shift_open_recovery_corrupt")}
}

export function clearPendingCashShiftOpen(){
  try{localStorage.removeItem(CASH_SHIFT_OPEN_PENDING_KEY)}
  catch{throw new Error("cash_shift_open_recovery_storage_unavailable")}
}

function writePendingCashShiftOpen(body:CashShiftOpenBody){
  try{localStorage.setItem(CASH_SHIFT_OPEN_PENDING_KEY,JSON.stringify({body,createdAt:Date.now()}))}
  catch{throw new Error("cash_shift_open_recovery_storage_unavailable")}
}

export async function sendCashShiftOpenDurably(csrf:string,body:CashShiftOpenBody){
  let pending=readPendingCashShiftOpen();
  if(pending&&pending.body.requestKey!==body.requestKey)throw Object.assign(new Error("cash_shift_open_pending"),{status:409});
  if(!pending){writePendingCashShiftOpen(body);pending={body,createdAt:Date.now()}}
  try{
    const response=await api<any>("/api/cash-shift/open",{
      method:"POST",
      headers:{"X-CSRF-Token":csrf},
      body:JSON.stringify(pending.body)
    });
    validateCashShiftOpenAck(response,pending.body);
    clearPendingCashShiftOpen();
    return response;
  }catch(error:any){
    if(!shouldRetainCashShiftOpenPending(error))clearPendingCashShiftOpen();
    throw error;
  }
}

export function cashShiftOpenErrorText(code:string){
  return code==="invalid_opening_cash"?"เงินตั้งต้นต้องไม่ติดลบและไม่เกิน 2 ตำแหน่งทศนิยม":
    code==="cash_shift_already_opened"?"วันนี้เปิดร้านแล้ว · ระบบจะโหลดข้อมูลล่าสุด":
    code==="day_already_closed"?"วันนี้ปิดวันแล้ว · ไม่สามารถเปิดร้านซ้ำได้":
    code==="cash_shift_open_pending"?"มีคำสั่งเปิดร้านก่อนหน้าที่ยังตรวจสอบไม่เสร็จ · ห้ามกดซ้ำ ระบบจะตรวจรายการเดิมก่อน":
    code==="cash_shift_open_unconfirmed"?"ระบบยังยืนยันผลการเปิดร้านไม่ได้ · เก็บรายการเดิมไว้เพื่อป้องกันเงินตั้งต้นซ้ำ":
    code==="cash_shift_open_recovery_corrupt"?"ข้อมูลป้องกันการเปิดร้านซ้ำในเครื่องมีปัญหา · หยุดเปิดร้านชั่วคราวและตรวจสถานะวันนี้ก่อน":
    code==="cash_shift_open_recovery_storage_unavailable"?"เครื่องนี้เก็บข้อมูลป้องกันการเปิดร้านซ้ำไม่ได้ · ระบบจึงยังไม่ส่งคำสั่งเปิดร้าน":
    code==="offline_write_blocked"?"ออฟไลน์อยู่ · ต้องเชื่อมต่ออินเทอร์เน็ตก่อนเปิดร้าน":
    code;
}
