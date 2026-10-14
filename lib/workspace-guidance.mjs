export function chooseWorkspaceNextAction(input={}){
  const pendingExpense=!!input.pendingExpense;
  const expenseRecoveryBlocked=!!input.expenseRecoveryBlocked;
  const queueCount=Math.max(0,Number(input.queueCount)||0);
  const firstQueue=String(input.firstQueue||"").trim();
  const outCount=Math.max(0,Number(input.outCount)||0);
  const lowCount=Math.max(0,Number(input.lowCount)||0);
  const blockedCount=Math.max(0,Number(input.blockedCount)||0);
  const latestOrderLabel=String(input.latestOrderLabel||"").trim();
  const shiftStatus=String(input.shiftStatus||"").trim();
  const pendingOpenShift=!!input.pendingOpenShift;
  const startDayRecoveryBlocked=!!input.startDayRecoveryBlocked;
  const businessDateKnown=!!input.businessDateKnown;

  if(input.canStartDay&&(pendingOpenShift||startDayRecoveryBlocked)){
    return {
      tab:null,
      action:"start_day",
      label:startDayRecoveryBlocked?"ตรวจข้อมูลเปิดร้านค้างก่อน":"ตรวจผลการเปิดร้านเดิมก่อน",
      detail:startDayRecoveryBlocked
        ?"อ่านข้อมูลเปิดร้านเดิมไม่ได้ · ห้ามสร้างคำสั่งเปิดร้านใหม่จนกว่าจะตรวจได้"
        :"มีคำสั่งเปิดร้านที่ยังไม่ทราบผล · ระบบจะตรวจรายการเดิมเพื่อป้องกันเงินตั้งต้นซ้ำ",
      tone:"critical"
    };
  }

  if(input.canExpense&&(pendingExpense||expenseRecoveryBlocked)){
    return {
      tab:"expense",
      label:"ตรวจค่าใช้จ่ายค้างก่อน",
      detail:expenseRecoveryBlocked
        ?"อ่านข้อมูลรายการค้างไม่ได้ · ห้ามสร้างรายการใหม่จนกว่าจะตรวจ"
        :"มีค่าใช้จ่ายที่ยังไม่ทราบผล · ระบบจะตรวจรายการเดิมซ้ำเพื่อป้องกันยอดซ้ำ",
      tone:"critical"
    };
  }
  if(input.canQueue&&queueCount>0){
    return {
      tab:"queue",
      label:"ทำ "+(firstQueue||"คิวแรก")+" ก่อน",
      detail:"มีลูกค้ารอ "+queueCount+" คิว · ระบบเรียงตามลำดับเวลาให้แล้ว ทำคิวบนสุดก่อน",
      tone:"work"
    };
  }
  if(input.canStartDay&&businessDateKnown&&shiftStatus==="closed"){
    return {
      tab:null,
      action:null,
      label:"วันนี้ปิดยอดแล้ว",
      detail:"วันทำการนี้ปิดเรียบร้อย · รอวันทำการถัดไปก่อนรับออเดอร์ใหม่",
      tone:"critical"
    };
  }
  if(input.canStartDay&&businessDateKnown&&!shiftStatus){
    return {
      tab:null,
      action:"start_day",
      label:"เปิดร้านก่อนเริ่มรับออเดอร์",
      detail:"ใส่เงินตั้งต้นครั้งเดียว ระบบจะล็อกยอดสำหรับกระทบยอดและพากลับมารับออเดอร์ต่อได้",
      tone:"work"
    };
  }
  if(input.canStock&&outCount>0){
    return {
      tab:"stock",
      label:"เติมสต็อกที่ทำให้เมนูหยุดขาย",
      detail:"มี "+outCount+" รายการที่ทำไม่ได้ · ตรวจของจริงก่อนรับเมนูนั้น",
      tone:"critical"
    };
  }
  if(input.canStatus&&blockedCount>0){
    return {
      tab:"status",
      label:"แก้สถานะระบบที่ถูกบล็อก",
      detail:"มี "+blockedCount+" จุดที่ต้องแก้ก่อนใช้งานครบทุกส่วน",
      tone:"critical"
    };
  }
  if(input.canStock&&lowCount>0){
    return {
      tab:"stock",
      label:"วางแผนเติมสต็อก",
      detail:"มี "+lowCount+" รายการใกล้หมด แต่ยังขายได้",
      tone:"warn"
    };
  }
  if(input.canOrder&&latestOrderLabel){
    return {
      tab:"orders",
      label:"พร้อมรับออเดอร์ถัดไป",
      detail:"บิลล่าสุด "+latestOrderLabel+" ถูกบันทึกแล้ว · เปิดดูได้โดยไม่ออกจาก POS",
      tone:"ready"
    };
  }
  return {
    tab:null,
    label:"พร้อมรับออเดอร์",
    detail:"ยังไม่มีงานเร่งด่วนจากคิว สต็อก หรือรายการค้าง",
    tone:"ready"
  };
}
