type SafetyState={cartCount:number;busy:boolean;syncing:boolean;readLocal:(key:string)=>string|null;readSession:(key:string)=>string|null};

export function getPwaUpdateBlockReason(state:SafetyState){
  if(state.cartCount>0)return "มีสินค้าอยู่ในตะกร้า";
  try{
    const recovery:[string,string][]=[
      ["field-pos-pending-promptpay-v1","มี PromptPay ที่ยังต้องตรวจสอบ"],
      ["field-pos-pending-cash-v1","มี Cash Checkout ที่สถานะยังไม่แน่นอน"],
      ["field-pos-split-group-v1","มี Split Payment ที่ยังไม่จบ"],
      ["field-pos-edit-cash-v1","กำลังแก้ไขออเดอร์เงินสด"],
      ["field-pos-pending-queue-action-v1","มี Queue action ที่ยังต้องยืนยันผล"],
      ["field-pos-pending-expense-v1","มีค่าใช้จ่ายที่ยังต้องยืนยันผล"],
      ["field-pos-pending-stock-transaction-v1","มี Stock transaction ที่ยังต้องยืนยันผล"],
      ["field-pos-pending-order-mutation-v1","มี VOID/Refund ที่ยังต้องยืนยันผล"],
      ["field-pos-pending-cash-movement-v1","มี Cash Drawer ที่ยังต้องยืนยันผล"],
      ["field-pos-pending-cycle-count-v1","มี Cycle Count ที่ยังต้องยืนยันผล"],
      ["field-pos-pending-delivery-settlement-v1","มี Delivery Settlement ที่ยังต้องยืนยันผล"],
      ["field-pos-pending-crm-points-v1","มี CRM Points ที่ยังต้องยืนยันผล"],
      ["field-pos-pending-close-day-v1","มีการปิดวันที่ยังต้องยืนยันผล"],
    ];
    for(const [key,reason] of recovery){
      if(state.readLocal(key)!==null||state.readSession(key)!==null)return reason;
    }
  }catch{return "ยังตรวจข้อมูลกู้คืนไม่ได้ กรุณาลองใหม่เมื่อพื้นที่เก็บข้อมูลพร้อม"}
  if(state.busy)return "มีรายการกำลังบันทึก";
  if(state.syncing)return "กำลัง Sync Offline sales";
  return "";
}

type WaitingRegistration={waiting:{postMessage:(message:{type:string})=>void}|null};
export async function activateSafePwaUpdate(options:{
  unsafeReason:()=>string;
  getRegistration:()=>Promise<WaitingRegistration|undefined|null>;
  setInitiated:(value:boolean)=>void;
}){
  if(options.unsafeReason())return false;
  let registration:WaitingRegistration|undefined|null;
  try{registration=await options.getRegistration()}catch{return false}
  // A cart, payment recovery or queue action may start while registration lookup is pending.
  if(!registration?.waiting||options.unsafeReason())return false;
  options.setInitiated(true);
  try{registration.waiting.postMessage({type:"SKIP_WAITING"});return true}
  catch{options.setInitiated(false);return false}
}
