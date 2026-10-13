import {api} from "./api-client";
import {EXPENSE_PENDING_KEY,shouldRetainExpensePending,validateExpenseAck,validatePendingExpense} from "./expense-recovery.mjs";

export type ExpenseBody={requestKey:string;date:string;amount:number;category:string;description:string;paymentMethod:string};
export type PendingExpense={body:ExpenseBody;createdAt:number};

export function currentBusinessDate(){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}

export function readPendingExpense():PendingExpense|null{
  let raw:string|null=null;
  try{raw=localStorage.getItem(EXPENSE_PENDING_KEY)}catch{throw new Error("expense_recovery_storage_unavailable")}
  if(!raw)return null;
  try{return validatePendingExpense(JSON.parse(raw)) as PendingExpense}catch{throw new Error("expense_recovery_corrupt")}
}

export function clearPendingExpense(){
  try{localStorage.removeItem(EXPENSE_PENDING_KEY)}
  catch{throw new Error("expense_recovery_storage_unavailable")}
}

function writePendingExpense(body:ExpenseBody){
  try{localStorage.setItem(EXPENSE_PENDING_KEY,JSON.stringify({body,createdAt:Date.now()}))}
  catch{throw new Error("expense_recovery_storage_unavailable")}
}

export async function sendExpenseDurably(csrf:string,body:ExpenseBody){
  let pending=readPendingExpense();
  if(pending&&pending.body.requestKey!==body.requestKey)throw Object.assign(new Error("expense_pending"),{status:409});
  if(!pending){writePendingExpense(body);pending={body,createdAt:Date.now()}}
  try{
    const response=await api<any>("/api/expenses",{
      method:"POST",
      headers:{"X-CSRF-Token":csrf},
      body:JSON.stringify(pending.body)
    });
    validateExpenseAck(response,pending.body);
    clearPendingExpense();
    return response;
  }catch(error:any){
    if(!shouldRetainExpensePending(error))clearPendingExpense();
    throw error;
  }
}

export function expenseErrorText(code:string){
  return code==="day_closed"?"ปิดยอดวันนี้แล้ว ไม่สามารถบันทึกค่าใช้จ่ายได้":
    code==="invalid_expense"?"จำนวนค่าใช้จ่ายต้องมากกว่า 0 และไม่เกิน 2 ตำแหน่งทศนิยม":
    code==="expense_pending"?"มีค่าใช้จ่ายรายการก่อนหน้าที่ยังตรวจสอบไม่เสร็จ · ระบบจะตรวจรายการเดิมก่อน ห้ามกดบันทึกซ้ำ":
    code==="expense_unconfirmed"?"ระบบยังยืนยันผลค่าใช้จ่ายรายการก่อนหน้าไม่ได้ · เก็บข้อมูลเดิมไว้เพื่อป้องกันยอดซ้ำ":
    code==="expense_recovery_corrupt"?"ข้อมูลป้องกันรายการซ้ำในเครื่องมีปัญหา · หยุดบันทึกค่าใช้จ่ายชั่วคราวและตรวจรายการเดิมก่อน":
    code==="expense_recovery_storage_unavailable"?"เครื่องนี้เก็บข้อมูลป้องกันรายการซ้ำไม่ได้ · ระบบจึงยังไม่ส่งค่าใช้จ่ายใหม่":
    code==="offline_write_blocked"?"ออฟไลน์อยู่ · ยังไม่บันทึกค่าใช้จ่ายจนกว่าจะเชื่อมต่อ":
    code;
}
