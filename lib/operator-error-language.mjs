export function operatorErrorFallback(code,context="รายการ"){
  const value=String(code||"").trim();
  if(value==="network_unavailable"||value==="offline_write_blocked"){
    return "เน็ตขาดการเชื่อมต่อ · ยังยืนยันผล"+context+"ไม่ได้ กรุณารอเชื่อมต่อแล้วตรวจรายการเดิมก่อนทำซ้ำ";
  }
  if(value==="forbidden"||value==="admin_required"||value.endsWith("_permission_required")){
    return "บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้ · ให้เจ้าของร้านหรือผู้มีสิทธิ์ดำเนินการ";
  }
  if(value==="unauthorized"||value==="session_expired"){
    return "เซสชันหมดอายุ · กรุณาเข้าสู่ระบบใหม่ก่อนทำรายการต่อ";
  }
  return "ยังทำ"+context+"ไม่สำเร็จ · ระบบยังยืนยันผลไม่ได้ กรุณารีเฟรชและตรวจสถานะเดิมก่อนลองอีกครั้ง";
}
