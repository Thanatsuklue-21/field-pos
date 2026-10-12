export function buildPosGuidance(input={}){
  const {
    recoveryBlocked=false,
    cashRecoveryBlocked=false,
    payOpen=false,
    busy=false,
    cartQty=0,
    lastSale=null,
    online=true,
    offlineSession=false,
    offlinePending=0,
    canOrder=false,
    canQueue=false
  }=input;

  if(recoveryBlocked||cashRecoveryBlocked)return {
    key:"recovery",step:0,tone:"danger",
    message:"ตรวจรายการชำระค้างก่อนรับเงินใหม่ · ระบบหยุดไว้เพื่อป้องกันยอดหรือบิลซ้ำ",
    action:canOrder?"open_orders":null,
    actionLabel:canOrder?"ตรวจ Orders":"ให้ผู้ดูแลตรวจ"
  };

  if(lastSale?.offline)return {
    key:"offline_sale",step:3,tone:"warn",
    message:"บันทึกเงินสด Offline แล้ว · ทำออเดอร์ตามลำดับและอย่าล้างข้อมูลเครื่องจนกว่าจะ Sync",
    action:"next_order",actionLabel:"รับออเดอร์ถัดไป"
  };

  if(lastSale)return {
    key:"handoff",step:3,tone:"success",
    message:"ชำระสำเร็จ · หยิบบัตร "+String(lastSale.pager||"—")+" ให้ลูกค้า",
    action:canQueue?"open_queue":"next_order",
    actionLabel:canQueue?"ดูคิว "+String(lastSale.queueNo||""):"รับออเดอร์ถัดไป"
  };

  if(payOpen||busy)return {
    key:"payment",step:3,tone:"info",
    message:busy?"กำลังยืนยันรายการเดิม · กรุณาอย่ากดซ้ำ":"รับชำระเงินตามยอด แล้วระบบจะออกคิวให้อัตโนมัติ",
    action:null,actionLabel:null
  };

  if(Number(cartQty)>0)return {
    key:"checkout",step:2,tone:"info",
    message:"ตรวจเมนู ความหวาน และจำนวนให้ถูกต้อง แล้วกด “ตรวจรายการ / ชำระเงิน”",
    action:"checkout",actionLabel:"ตรวจรายการ / ชำระเงิน"
  };

  if(!online||offlineSession)return {
    key:"offline",step:1,tone:"warn",
    message:"เลือกเครื่องดื่มจากรายการด้านล่าง · Offline รับได้เฉพาะเงินสด"+(Number(offlinePending)>0?" · รอ Sync "+Number(offlinePending)+" บิล":""),
    action:null,actionLabel:null
  };

  return {
    key:"select",step:1,tone:"neutral",
    message:"เลือกเครื่องดื่มจากรายการด้านล่าง",
    action:null,actionLabel:null
  };
}
