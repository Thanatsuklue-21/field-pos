export function cashierNextAction(input={}){
  const cartQty=Math.max(0,Number(input.cartQty)||0);
  const payOpen=!!input.payOpen;
  const method=String(input.method||"cash");
  const payable=Math.max(0,Number(input.payable)||0);
  const receivedRaw=input.received;
  const received=receivedRaw===""||receivedRaw===null||receivedRaw===undefined?NaN:Number(receivedRaw);

  if(!payOpen){
    if(cartQty<1)return {
      step:1,
      title:"แตะเมนูที่ลูกค้าสั่ง",
      detail:"เลือกเมนู แล้วเลือกระดับหวานหรือสูตรตามที่ลูกค้าบอก",
      tone:"ready"
    };
    return {
      step:2,
      title:"ลูกค้าสั่งครบหรือยัง?",
      detail:"ถ้ายังไม่ครบ แตะเมนูต่อได้เลย · ถ้าครบแล้วกดชำระเงิน",
      tone:"work"
    };
  }

  if(method==="cash"){
    if(!Number.isFinite(received))return {
      step:3,
      title:"รับเงินจากลูกค้า",
      detail:"กด “รับพอดี” หรือเลือกยอดเงินที่ลูกค้ายื่นให้",
      tone:"work"
    };
    if(received+1e-9<payable)return {
      step:3,
      title:"เงินที่รับยังไม่พอ",
      detail:"ตรวจจำนวนเงินที่ลูกค้ายื่น แล้วกรอกใหม่ก่อนยืนยัน",
      tone:"warn"
    };
    const change=Math.max(0,Math.round((received-payable)*100)/100);
    return {
      step:3,
      title:change>0?"ทอน "+new Intl.NumberFormat("th-TH",{maximumFractionDigits:2}).format(change)+" บาท แล้วกดยืนยัน":"ยอดพอดี · กดยืนยันรับเงิน",
      detail:"ตรวจยอดอีกครั้งก่อนกดยืนยัน ระบบจะสร้างคิวหลังรับเงินสำเร็จ",
      tone:"ready"
    };
  }

  if(method==="promptpay"){
    if(!input.promptReady)return {
      step:3,
      title:"กดสร้าง QR ให้ลูกค้า",
      detail:"ระบบจะสร้าง QR ตามยอดบิลนี้ · อย่าสร้างรายการใหม่ซ้ำ",
      tone:"work"
    };
    return {
      step:3,
      title:"ให้ลูกค้าสแกน QR",
      detail:"รอระบบยืนยันยอดเดิมอัตโนมัติ · ไม่ต้องสร้าง QR ใหม่",
      tone:"work"
    };
  }

  return {
    step:3,
    title:"ตรวจช่องทางรับเงิน",
    detail:"ตรวจยอดและข้อมูลอ้างอิง แล้วกดยืนยันเมื่อรับเงินจริงแล้ว",
    tone:"work"
  };
}
