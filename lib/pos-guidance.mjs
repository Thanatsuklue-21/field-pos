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

  if(recoveryBlocked||cashRecoveryBlocked){
    return {
      key:"recovery",
      step:"ต้องตรวจสอบ",
      title:"ตรวจรายการชำระค้างก่อนรับเงินใหม่",
      detail:"ระบบหยุดรับชำระเพื่อป้องกันยอดหรือบิลซ้ำ",
      tone:"danger",
      action:canOrder?"open_orders":null,
      actionLabel:canOrder?"ตรวจ Orders":"ให้ผู้ดูแลตรวจรายการ"
    };
  }
  if(lastSale){
    if(lastSale.offline){
      return {
        key:"offline_sale",
        step:"ขายสำเร็จ",
        title:"บันทึกเงินสด Offline แล้ว",
        detail:"ทำออเดอร์ตามลำดับและอย่าล้างข้อมูลเครื่องจนกว่าจะ Sync สำเร็จ",
        tone:"warn",
        action:"next_order",
        actionLabel:"รับออเดอร์ถัดไป"
      };
    }
    return {
      key:"handoff",
      step:"ขั้นตอน 4 / 4",
      title:"หยิบบัตร "+(lastSale.pager||"—")+" ให้ลูกค้า",
      detail:"ชำระเงินแล้ว · ไปทำคิวเดิมหรือรับออเดอร์ถัดไปได้ทันที",
      tone:"success",
      action:canQueue?"open_queue":"next_order",
      actionLabel:canQueue?"ดูคิว "+String(lastSale.queueNo||""):"รับออเดอร์ถัดไป"
    };
  }
  if(payOpen||busy){
    return {
      key:"payment",
      step:"ขั้นตอน 3 / 4",
      title:busy?"กำลังยืนยันรายการเดิม":"รับชำระเงิน",
      detail:"ตรวจยอดและวิธีชำระให้ตรงก่อนยืนยัน · ระบบจะไม่สร้างบิลซ้ำ",
      tone:"info",
      action:null,
      actionLabel:null
    };
  }
  if(Number(cartQty)>0){
    return {
      key:"checkout",
      step:"ขั้นตอน 2 / 4",
      title:"ตรวจรายการ แล้วกดชำระเงิน",
      detail:Number(cartQty)+" แก้วในตะกร้า · ตรวจเมนู ความหวาน และจำนวนก่อนรับเงิน",
      tone:"info",
      action:"checkout",
      actionLabel:"ชำระเงิน"
    };
  }
  if(!online||offlineSession){
    return {
      key:"offline",
      step:"ขั้นตอน 1 / 4",
      title:"เลือกเมนู · Offline รับเฉพาะเงินสด",
      detail:(Number(offlinePending)>0?"มีบิล Offline รอ Sync "+Number(offlinePending)+" รายการ · ":"")+"เลือกรูปเมนูแล้วระบบจะพาไปขั้นตอนถัดไป",
      tone:"warn",
      action:null,
      actionLabel:null
    };
  }
  return {
    key:"select",
    step:"ขั้นตอน 1 / 4",
    title:"เลือกเมนูที่ลูกค้าสั่ง",
    detail:"แตะรูปเมนู → เลือกสูตร/ความหวาน → ระบบจะเพิ่มลงตะกร้าให้",
    tone:"neutral",
    action:null,
    actionLabel:null
  };
}
