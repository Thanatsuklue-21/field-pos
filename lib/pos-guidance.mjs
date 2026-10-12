function money(value){
  const n=Number(value);
  if(!Number.isFinite(n))return "0";
  return n.toFixed(2).replace(/\.00$/,"").replace(/(\.\d)0$/,"$1");
}

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
    canQueue=false,
    salesClosed=false,
    allUnavailable=false,
    reviewConfirmed=false,
    method="cash",
    cashReceived=null,
    netPayable=0,
    promptReady=false
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

  if(salesClosed)return {
    key:"day_closed",step:0,tone:"warn",
    message:"วันนี้ปิดยอดแล้ว · ระบบล็อกรับออเดอร์และรับเงินใหม่เพื่อไม่ให้ยอดข้ามวัน",
    action:null,actionLabel:null
  };

  if(allUnavailable)return {
    key:"stock_block",step:0,tone:"danger",
    message:"ยังรับออเดอร์ไม่ได้ · เมนูที่แสดงไม่มีวัตถุดิบพร้อมขาย ต้องอัปเดต Stock ก่อน",
    action:null,actionLabel:null
  };

  if(busy)return {
    key:"payment_busy",step:3,tone:"info",
    message:"กำลังยืนยันรายการเดิม · กรุณาอย่ากดซ้ำจนกว่าระบบจะแจ้งผล",
    action:null,actionLabel:null
  };

  if(payOpen){
    if(!reviewConfirmed)return {
      key:"payment_review",step:3,tone:"warn",
      message:"ทวนชื่อเมนู · จำนวน · ความหวาน/สูตร · ยอดกับลูกค้า แล้วกด “ทวนแล้ว · พร้อมรับเงิน”",
      action:null,actionLabel:null
    };

    if(method==="cash"){
      const hasReceived=cashReceived!==null&&cashReceived!==undefined&&cashReceived!==""&&Number.isFinite(Number(cashReceived));
      if(!hasReceived)return {
        key:"cash_receive",step:3,tone:"info",
        message:"รับเงินสดจากลูกค้า แล้วกรอกหรือแตะจำนวนเงินที่รับ ระบบจะคำนวณเงินทอนให้",
        action:null,actionLabel:null
      };
      const received=Number(cashReceived),total=Math.max(0,Number(netPayable)||0);
      const delta=Math.round((received-total)*100)/100;
      if(delta<0)return {
        key:"cash_short",step:3,tone:"warn",
        message:"เงินที่รับยังขาด ฿"+money(Math.abs(delta))+" · รับเงินเพิ่มก่อนยืนยันชำระ",
        action:null,actionLabel:null
      };
      return {
        key:"cash_ready",step:3,tone:"success",
        message:delta===0?"รับเงินพอดียอด · กด “ยืนยันรับเงิน” ได้":"ต้องทอน ฿"+money(delta)+" · ตรวจเงินทอนแล้วกด “ยืนยันรับเงิน”",
        action:null,actionLabel:null
      };
    }

    if(method==="promptpay")return {
      key:promptReady?"promptpay_ready":"promptpay_blocked",step:3,tone:promptReady?"info":"warn",
      message:promptReady?"กด “สร้าง QR พร้อมเพย์” แล้วรอระบบยืนยันการชำระอัตโนมัติ":"พร้อมเพย์ยังไม่พร้อม · เปลี่ยนวิธีชำระหรือให้ผู้ดูแลตรวจการตั้งค่า",
      action:null,actionLabel:null
    };

    if(method==="bank")return {key:"bank_ready",step:3,tone:"info",message:"ตรวจว่ารับโอนเข้าบัญชีแล้ว จากนั้นกด “ยืนยันรับโอน”",action:null,actionLabel:null};
    if(method==="card")return {key:"card_ready",step:3,tone:"info",message:"ทำรายการที่เครื่องรับบัตรให้สำเร็จ แล้วกด “ยืนยันรับบัตร”",action:null,actionLabel:null};
    if(method==="delivery")return {key:"delivery_ready",step:3,tone:"info",message:"ตรวจแพลตฟอร์มและยอดสุทธิ แล้วกด “ยืนยันออเดอร์เดลิเวอรี”",action:null,actionLabel:null};

    return {key:"payment",step:3,tone:"info",message:"รับชำระเงินตามยอด แล้วระบบจะออกคิวให้อัตโนมัติ",action:null,actionLabel:null};
  }

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
