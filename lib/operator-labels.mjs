export function paymentMethodLabel(value){
  const key=String(value||"").trim().toLowerCase();
  return ({
    cash:"เงินสด",
    promptpay:"พร้อมเพย์",
    bank:"โอนธนาคาร",
    card:"บัตร",
    delivery:"เดลิเวอรี",
    other:"อื่น ๆ",
    split:"หลายช่องทาง"
  })[key]||"ไม่ทราบช่องทาง";
}

export function saleStatusLabel(value){
  const key=String(value||"").trim().toLowerCase();
  return ({
    paid:"ชำระแล้ว",
    refunded:"คืนเงินแล้ว",
    void:"ยกเลิกบิลแล้ว",
    cancelled:"ยกเลิกแล้ว",
    pending:"รอชำระ"
  })[key]||"ไม่ทราบสถานะ";
}

export function orderStatusLabel(value){
  const key=String(value||"").trim().toLowerCase();
  return ({
    assigned:"รอทำ",
    making:"กำลังทำ",
    ready:"พร้อมส่งมอบ",
    called:"เรียกลูกค้าแล้ว",
    returned:"ส่งมอบแล้ว",
    void:"ยกเลิกแล้ว",
    refunded:"คืนเงินแล้ว",
    cancelled:"ยกเลิกแล้ว"
  })[key]||"ไม่ทราบสถานะ";
}

export function paymentSummaryLabel(payment,paymentMethods=[]){
  const key=String(payment||"").trim().toLowerCase();
  const methods=(Array.isArray(paymentMethods)?paymentMethods:[]).filter(Boolean);
  if(key==="split"&&methods.length)return methods.map(paymentMethodLabel).join(" + ");
  return paymentMethodLabel(key);
}
