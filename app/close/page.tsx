"use client";
import {useEffect,useRef,useState} from "react";
import AuthGate from "@/components/auth-gate";
import ModalFocus from "@/components/modal-focus";
import {api,type Session} from "@/lib/api-client";
import {readCloseDayDevicePreflight,type CloseDayDevicePreflight} from "@/lib/close-day-device-preflight";
import {prepareCashMovementIntent,readCashMovementIntent,sendCashMovementIntent,type CashMovementIntent} from "@/lib/cash-movement-recovery";
import {prepareCashShiftOpenIntent,readCashShiftOpenIntent,sendCashShiftOpenIntent,type CashShiftOpenIntent} from "@/lib/cash-shift-open-recovery";
import {operatorErrorFallback} from "@/lib/operator-error-language.mjs";

type Close={id:string;date:string;revenue:number;cogs:number;expenses:number;purchaseSpend?:number;totalCashOut?:number;grossProfit:number;operatingProfit:number;cash:number;promptpay:number;bank?:number;card?:number;other:number;openingCash?:number;cashIn?:number;cashPaidOut?:number;cashOut?:number;expectedCash?:number;countedCash?:number;cashVariance?:number;orders:number;cups:number;time:number};
type Shift={id:string;requestKey?:string|null;date:string;status:"open"|"closed";openingCash:number;openedAt:number;openedBy:string;closedAt?:number;cashVariance?:number};
type Movement={id:string;shiftId:string;date:string;type:"CASH_IN"|"CASH_OUT";amount:number;reason:string;time:number;createdBy:string};
type DrawerSnapshot={openingCash:number;cashSales:number;cashIn:number;cashPaidOut:number;cashOut:number;availableCash:number};
type CloseData={closes:Close[];shift:Shift|null;businessDate:string;cashMovements:Movement[];drawerSnapshot:DrawerSnapshot|null};

export default function CloseDay(){return <AuthGate>{s=><View session={s}/>}</AuthGate>}

function View({session}:{session:Session}){
  const [rows,setRows]=useState<Close[]>([]),[shift,setShift]=useState<Shift|null>(null),[businessDate,setBusinessDate]=useState(""),[movements,setMovements]=useState<Movement[]>([]),[drawerSnapshot,setDrawerSnapshot]=useState<DrawerSnapshot|null>(null),[msg,setMsg]=useState(""),[busy,setBusy]=useState(false),[openingCash,setOpeningCash]=useState("0"),[firstCount,setFirstCount]=useState(""),[secondCount,setSecondCount]=useState(""),[review,setReview]=useState<any|null>(null),[varianceReason,setVarianceReason]=useState(""),[confirmVariance,setConfirmVariance]=useState(false),[drawerOpen,setDrawerOpen]=useState(false),[movementType,setMovementType]=useState<"CASH_IN"|"CASH_OUT">("CASH_OUT"),[movementAmount,setMovementAmount]=useState(""),[movementReason,setMovementReason]=useState(""),[movementRiskConfirmed,setMovementRiskConfirmed]=useState(false),[devicePreflight,setDevicePreflight]=useState<CloseDayDevicePreflight|null>(null),[deviceChecking,setDeviceChecking]=useState(false),[pendingMovement,setPendingMovement]=useState<CashMovementIntent|null>(null),[movementRecoveryBlocked,setMovementRecoveryBlocked]=useState(false);
  const [pendingOpenShift,setPendingOpenShift]=useState<CashShiftOpenIntent|null>(null),[openShiftRecoveryBlocked,setOpenShiftRecoveryBlocked]=useState(false);
  const openShiftRecoveryRef=useRef(false);
  const load=()=>api<CloseData>("/api/close-day").then(x=>{setRows(x.closes||[]);setShift(x.shift||null);setBusinessDate(x.businessDate||"");setMovements(x.cashMovements||[]);setDrawerSnapshot(x.drawerSnapshot||null) });
  useEffect(()=>{load().catch(()=>{})},[]);
  async function refreshDevicePreflight(){
    if(!businessDate){
      const blocked:CloseDayDevicePreflight={ok:false,checkedAt:Date.now(),businessDate:"",blockers:[{kind:"storage_unreadable",title:"ยังยืนยันวันทำการไม่ได้",detail:"ระบบยังไม่ได้วันทำการล่าสุด · กรุณารีเฟรชก่อนตรวจหรือปิดวัน"}]};
      setDevicePreflight(blocked);return blocked;
    }
    setDeviceChecking(true);
    try{
      const result=await readCloseDayDevicePreflight(session.user.id,businessDate);
      setDevicePreflight(result);
      return result;
    }finally{setDeviceChecking(false)}
  }

  useEffect(()=>{
    if(!businessDate)return;
    let disposed=false;
    const check=async()=>{const result=await readCloseDayDevicePreflight(session.user.id,businessDate);if(!disposed)setDevicePreflight(result)};
    const onOnline=()=>check().catch(()=>{}),onFocus=()=>check().catch(()=>{}),onVisible=()=>{if(document.visibilityState==="visible")check().catch(()=>{})};
    check().catch(()=>{});
    window.addEventListener("online",onOnline);
    window.addEventListener("focus",onFocus);
    document.addEventListener("visibilitychange",onVisible);
    return()=>{disposed=true;window.removeEventListener("online",onOnline);window.removeEventListener("focus",onFocus);document.removeEventListener("visibilitychange",onVisible)};
  },[businessDate,session.user.id]);

  useEffect(()=>{
    let disposed=false,recovering=false;
    const recover=async()=>{
      if(disposed||recovering)return;
      let intent:CashMovementIntent|null=null;
      try{intent=readCashMovementIntent(session.user.id);if(!disposed)setMovementRecoveryBlocked(false)}
      catch{if(!disposed){setMovementRecoveryBlocked(true);setMsg(movementError("cash_movement_recovery_unavailable"))}return}
      if(!intent){if(!disposed)setPendingMovement(null);return}
      if(!disposed){
        setPendingMovement(intent);setMovementType(intent.body.type);setMovementAmount(String(intent.body.amount));setMovementReason(intent.body.reason);setMovementRiskConfirmed(intent.body.riskConfirmed);
      }
      if(typeof navigator!=="undefined"&&!navigator.onLine){if(!disposed)setMsg("มีรายการลิ้นชักเดิมรอตรวจ · ตอนเน็ตหลุดระบบจะไม่สร้างรายการใหม่");return}
      recovering=true;
      try{await submitMovementIntent(intent,true)}finally{recovering=false}
    };
    const onOnline=()=>recover().catch(()=>{}),onFocus=()=>recover().catch(()=>{}),onVisible=()=>{if(document.visibilityState==="visible")recover().catch(()=>{})};
    recover().catch(()=>{});
    window.addEventListener("online",onOnline);window.addEventListener("focus",onFocus);document.addEventListener("visibilitychange",onVisible);
    return()=>{disposed=true;window.removeEventListener("online",onOnline);window.removeEventListener("focus",onFocus);document.removeEventListener("visibilitychange",onVisible)};
  },[session.user.id,session.csrf,businessDate]);

  function startDayError(code:string){
    const map:Record<string,string>={
      invalid_request_key:"รหัสกันรายการซ้ำไม่ถูกต้อง",
      invalid_date:"วันทำการไม่ถูกต้อง · รีเฟรชก่อนเปิดร้าน",
      invalid_opening_cash:"เงินตั้งต้นต้องไม่ติดลบและไม่เกิน 2 ตำแหน่งทศนิยม",
      business_date_changed:"วันทำการเปลี่ยนแล้ว · รายการเดิมไม่ได้ถูกสร้างใหม่ กรุณารีเฟรชแล้วเปิดร้านของวันใหม่",
      cash_shift_already_opened:"วันนี้เปิดร้านแล้ว · ระบบจะโหลดข้อมูลล่าสุด",
      day_already_closed:"วันนี้ปิดวันแล้ว · ไม่สามารถเปิดร้านซ้ำได้",
      pending_cash_shift_open_exists:"มีคำสั่งเปิดร้านเดิมที่ยังไม่ทราบผล · ต้องตรวจรายการเดิมก่อน",
      cash_shift_open_ack_unknown:"ระบบกลางยังยืนยันการเปิดร้านเดิมไม่ครบ · ระบบเก็บรายการเดิมไว้ ห้ามเปิดซ้ำ",
      cash_shift_open_recovery_unavailable:"อ่าน/บันทึกข้อมูลป้องกันการเปิดร้านซ้ำไม่ได้ · ระบบหยุดคำสั่งใหม่ชั่วคราว",
      network_unavailable:"เน็ตขาดการเชื่อมต่อ · ยังไม่ทราบว่าเปิดร้านสำเร็จหรือไม่ ระบบเก็บรายการเดิมไว้และจะตรวจซ้ำ",
      offline_write_blocked:"ออฟไลน์อยู่ · ต้องเชื่อมต่อก่อนเปิดร้าน"
    };
    return map[code]||operatorErrorFallback(code,"การเปิดร้าน");
  }

  async function submitOpenShiftIntent(intent:CashShiftOpenIntent,recovery=false){
    if(openShiftRecoveryRef.current)return false;
    openShiftRecoveryRef.current=true;setBusy(true);setMsg("");
    try{
      const r=await sendCashShiftOpenIntent(intent,body=>api<any>("/api/cash-shift/open",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)}));
      setPendingOpenShift(null);setOpenShiftRecoveryBlocked(false);setShift(r.shift);
      setMsg((recovery?"ตรวจรายการเปิดร้านเดิมสำเร็จ · ":"")+"ร้านเปิดแล้ว · เงินตั้งต้น ฿"+Number(r.shift.openingCash).toLocaleString()+" ถูกล็อกแล้ว");
      await load();await refreshDevicePreflight().catch(()=>{});
      return true;
    }catch(e:any){
      try{setPendingOpenShift(readCashShiftOpenIntent(session.user.id));setOpenShiftRecoveryBlocked(false)}
      catch{setOpenShiftRecoveryBlocked(true)}
      setMsg(startDayError(e.message));
      await load().catch(()=>{});await refreshDevicePreflight().catch(()=>{});
      return false;
    }finally{openShiftRecoveryRef.current=false;setBusy(false)}
  }

  useEffect(()=>{
    let disposed=false;
    const recover=async()=>{
      if(disposed||session.user.role!=="admin"||openShiftRecoveryRef.current)return;
      let intent:CashShiftOpenIntent|null=null;
      try{intent=readCashShiftOpenIntent(session.user.id);setOpenShiftRecoveryBlocked(false)}
      catch{if(!disposed){setOpenShiftRecoveryBlocked(true);setMsg(startDayError("cash_shift_open_recovery_unavailable"))}return}
      if(!intent){if(!disposed)setPendingOpenShift(null);return}
      if(!disposed)setPendingOpenShift(intent);
      await submitOpenShiftIntent(intent,true);
    };
    const online=()=>recover().catch(()=>{}),focus=()=>recover().catch(()=>{}),visible=()=>{if(document.visibilityState==="visible")recover().catch(()=>{})};
    recover().catch(()=>{});
    window.addEventListener("online",online);window.addEventListener("focus",focus);document.addEventListener("visibilitychange",visible);
    return()=>{disposed=true;window.removeEventListener("online",online);window.removeEventListener("focus",focus);document.removeEventListener("visibilitychange",visible)};
  },[session.user.id,session.user.role,session.csrf]);

  async function openShift(){
    if(openShiftRecoveryBlocked){setMsg(startDayError("cash_shift_open_recovery_unavailable"));return}
    let existing:CashShiftOpenIntent|null=null;
    try{existing=readCashShiftOpenIntent(session.user.id)}
    catch{setOpenShiftRecoveryBlocked(true);setMsg(startDayError("cash_shift_open_recovery_unavailable"));return}
    if(existing){setPendingOpenShift(existing);await submitOpenShiftIntent(existing,true);return}
    if(!businessDate){setMsg("ยังไม่ได้วันทำการล่าสุด · รีเฟรชก่อนเปิดร้าน");return}
    const opening=Number(openingCash||0);
    if(!Number.isFinite(opening)||opening<0||opening>1e7||Math.abs(opening*100-Math.round(opening*100))>1e-7){setMsg(startDayError("invalid_opening_cash"));return}
    if(!window.confirm("ยืนยันเปิดร้านด้วยเงินตั้งต้น ฿"+opening.toLocaleString()+" ? หลังเปิดแล้วจำนวนนี้จะถูกล็อกสำหรับการกระทบยอดวันนี้"))return;
    try{
      const intent=prepareCashShiftOpenIntent(session.user.id,{requestKey:crypto.randomUUID(),date:businessDate,openingCash:opening});
      setPendingOpenShift(intent);await submitOpenShiftIntent(intent,false);
    }catch(e:any){setMsg(startDayError(e.message))}
  }

    function movementError(code:string){
    const map:Record<string,string>={
      drawer_cash_shortage:"เงินสดตามระบบไม่พอสำหรับนำออกจำนวนนี้ · ยอดอาจเปลี่ยนจากการขาย/ค่าใช้จ่ายล่าสุด กรุณารีเฟรชและตรวจใหม่",
      cash_shift_not_open:"ต้องเปิดร้านก่อนบันทึกเงินเข้า/ออก",
      high_risk_confirmation_required:"รายการเงินสดจำนวนสูงต้องยืนยันอีกครั้งก่อนบันทึก",
      high_risk_reason_required:"กรุณาระบุเหตุผลให้ชัดเจน",
      cash_movement_reason_required:"กรุณาระบุเหตุผลให้ชัดเจน",
      invalid_cash_movement_amount:"จำนวนเงินไม่ถูกต้อง",
      business_date_changed:"วันทำการเปลี่ยนแล้ว · รายการเดิมไม่ได้ถูกสร้างใหม่ กรุณาตรวจวันและเริ่มรายการใหม่",
      cash_movement_ack_unknown:"ระบบกลางยังยืนยันรายการเงินสดเดิมไม่ครบ · ระบบเก็บรายการเดิมไว้ ห้ามสร้างรายการใหม่แทน",
      cash_movement_recovery_unavailable:"อ่าน/บันทึกข้อมูลรายการลิ้นชักที่ค้างไม่ได้ · ระบบหยุดรายการใหม่ชั่วคราวเพื่อป้องกันเงินซ้ำ",
      pending_cash_movement_exists:"มีรายการลิ้นชักเดิมที่ยังไม่ทราบผล · ต้องตรวจรายการเดิมก่อน",
      network_unavailable:"เน็ตขาดการเชื่อมต่อ · ยังไม่ทราบว่ารายการลิ้นชักสำเร็จหรือไม่ ระบบเก็บรายการเดิมไว้และจะตรวจซ้ำ"
    };
    return map[code]||operatorErrorFallback(code,"รายการเงินสดในลิ้นชัก");
  }

  async function submitMovementIntent(intent:CashMovementIntent,recovery=false){
    setBusy(true);setMsg("");
    try{
      const r=await sendCashMovementIntent(intent,body=>api<any>("/api/cash-shift/movements",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)}));
      setPendingMovement(null);setMovementRecoveryBlocked(false);
      setMovementAmount("");setMovementReason("");setMovementRiskConfirmed(false);setDrawerOpen(false);
      setMsg((recovery?"ตรวจรายการเดิมสำเร็จ · ":"")+(intent.body.type==="CASH_IN"?"บันทึกเติมเงินสดเข้าลิ้นชักแล้ว":"บันทึกนำเงินสดออกจากลิ้นชักแล้ว")+" · คงเหลือตามระบบ ฿"+Number(r.availableCash||0).toLocaleString());
      await load();await refreshDevicePreflight();
      return true;
    }catch(e:any){
      try{
        const current=readCashMovementIntent(session.user.id);setPendingMovement(current);
        if(current){
          setMovementType(current.body.type);setMovementAmount(String(current.body.amount));setMovementReason(current.body.reason);setMovementRiskConfirmed(current.body.riskConfirmed);
          setMsg(movementError(e.message));
        }else setMsg(movementError(e.message));
      }catch{
        setMovementRecoveryBlocked(true);setMsg(movementError("cash_movement_recovery_unavailable"));
      }
      await load().catch(()=>{});await refreshDevicePreflight().catch(()=>{});
      return false;
    }finally{setBusy(false)}
  }

  async function addMovement(){
    const amount=Number(movementAmount);
    if(movementRecoveryBlocked){setMsg(movementError("cash_movement_recovery_unavailable"));return}
    if(pendingMovement){await submitMovementIntent(pendingMovement,true);return}
    if(!shift||shift.status!=="open"){setMsg("ต้องเปิดร้านก่อนบันทึกเงินเข้า/ออกลิ้นชัก");return}
    if(!businessDate){setMsg("ยังยืนยันวันทำการไม่ได้ กรุณารีเฟรชก่อน");return}
    if(!Number.isFinite(amount)||amount<=0){setMsg("กรุณากรอกจำนวนเงินที่ถูกต้อง");return}
    if(movementReason.trim().length<2){setMsg("กรุณาระบุเหตุผล");return}
    if(movementType==="CASH_OUT"&&amount>=500&&!movementRiskConfirmed){setMsg("นำเงินออกตั้งแต่ ฿500 ต้องติ๊กยืนยันรายการจำนวนสูงก่อน");return}
    try{
      const intent=prepareCashMovementIntent(session.user.id,{requestKey:crypto.randomUUID(),date:businessDate,type:movementType,amount,reason:movementReason.trim(),riskConfirmed:movementRiskConfirmed});
      setPendingMovement(intent);
      await submitMovementIntent(intent,false);
    }catch(e:any){
      setMsg(movementError(e.message));
      if(e.message==="cash_movement_recovery_unavailable")setMovementRecoveryBlocked(true);
    }
  }

  async function reviewCash(){
    const first=Number(firstCount),second=Number(secondCount);
    if(!shift||shift.status!=="open"){setMsg("กรุณาเปิดร้านและล็อกเงินตั้งต้นก่อนปิดวัน");return}
    if(!firstCount.trim()||!Number.isFinite(first)||first<0){setMsg("กรุณากรอกยอดนับรอบที่ 1");return}
    if(!secondCount.trim()||!Number.isFinite(second)||second<0){setMsg("กรุณากรอกยอดนับรอบที่ 2");return}
    const local=await refreshDevicePreflight();
    if(!local.ok){setReview(null);setMsg("ยังตรวจปิดวันไม่ได้ · เครื่องนี้มีรายการค้างหรืออ่านข้อมูลรายการเดิมไม่ได้ กรุณาจัดการรายการที่แสดงด้านบนก่อน");return}
    setBusy(true);setMsg("");setReview(null);setVarianceReason("");setConfirmVariance(false);
    try{
      const r=await api<any>("/api/close-day/review",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({firstCount:first,secondCount:second})});
      setReview(r.review);
      const v=Number(r.review.variance||0);
      setMsg(v===0?"ตรวจยอดแล้ว · เงินสดตรงพอดี":r.review.summary||"พบส่วนต่าง · กรุณาตรวจสอบก่อนปิดวัน");
    }catch(e:any){
      if(e.message==="cash_recount_mismatch"){
        setSecondCount("");setMsg("ยอดนับรอบ 1 และรอบ 2 ไม่ตรงกัน · กรุณานับรอบ 2 ใหม่โดยไม่ดูยอดระบบ");
      }else setMsg(e.message==="close_day_pending_payments"?"ยังมีรายการรับเงินค้าง · ต้องจัดการก่อน":e.message==="close_day_open_orders"?"ยังมีออเดอร์ที่ยังไม่ส่งมอบ":e.message==="close_day_pending_stock_count_approval"?"มีผลนับสต๊อกรอเจ้าของร้านอนุมัติ · กรุณาจัดการก่อนปิดวัน":e.message==="cash_shift_not_open"?"ยังไม่ได้เปิดกะเงินสด":e.message);
    }finally{setBusy(false)}
  }

  async function close(){
    if(!review){setMsg("กรุณานับเงิน 2 รอบและให้ระบบตรวจสอบก่อนปิดวัน");return}
    const counted=Number(review.countedCash);
    if(review.variance!==0&&varianceReason.trim().length<2){setMsg("เงินขาด/เกินต้องระบุเหตุผลก่อนปิดวัน");return}
    if(review.ownerConfirmRequired&&!confirmVariance){setMsg("ส่วนต่างสูง ต้องติ๊กยืนยันโดยเจ้าของก่อนปิดวัน");return}
    const local=await refreshDevicePreflight();
    if(!local.ok){setMsg("ยังปิดวันไม่ได้ · พบรายการค้างในเครื่องหรืออ่านข้อมูลรายการเดิมไม่ได้ กรุณาจัดการก่อน แล้วตรวจใหม่");return}
    if(!window.confirm("ยืนยันปิดวันตามผลตรวจ? "+(review.variance===0?"เงินสดตรงพอดี":review.summary)))return;
    const finalLocal=await refreshDevicePreflight();
    if(!finalLocal.ok){setReview(null);setMsg("ยกเลิกการปิดวัน · พบรายการค้างใหม่ในเครื่องหลังการยืนยัน กรุณาจัดการรายการเดิมก่อน แล้วนับ/ตรวจใหม่");return}
    setBusy(true);setMsg("");
    try{
      const r=await api<any>("/api/close-day",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({countedCash:counted,reviewId:review.id,varianceReason:varianceReason.trim(),confirmVariance})});
      const v=Number(r.close.cashVariance||0);
      setMsg("ปิดวันสำเร็จ · เงินสด "+(v===0?"ตรงพอดี":v>0?"เกิน ฿"+v.toLocaleString():"ขาด ฿"+Math.abs(v).toLocaleString()));
      setFirstCount("");setSecondCount("");setReview(null);setVarianceReason("");setConfirmVariance(false);await load();
    }catch(e:any){
      const map:Record<string,string>={
        day_already_closed:"วันนี้ถูกปิดวันแล้ว",
        close_day_pending_payments:"ยังมีรายการรับเงินที่ค้างอยู่",
        close_day_open_orders:"ยังมีออเดอร์ที่ยังไม่ได้ส่งมอบ",
        close_day_pending_stock_count_approval:"มีผลนับสต๊อกรอเจ้าของร้านอนุมัติ · กรุณาไปหน้าสต็อกเพื่ออนุมัติหรือตีกลับก่อนปิดวัน",
        close_day_review_required:"ต้องผ่านการตรวจ 2 รอบก่อน",
        close_day_review_expired:"ผลตรวจหมดอายุ กรุณานับใหม่",
        close_day_review_stale:"ข้อมูลการเงินเปลี่ยนหลังตรวจ กรุณานับและตรวจใหม่",
        close_day_review_count_changed:"ยอดนับเปลี่ยนจากผลตรวจ กรุณาตรวจใหม่",
        cash_variance_reason_required:"เงินขาด/เกินต้องระบุเหตุผล",
        cash_variance_owner_confirmation_required:"ส่วนต่างสูง ต้องยืนยันโดยเจ้าของ"
      };
      if(["close_day_review_expired","close_day_review_stale","close_day_review_count_changed"].includes(e.message))setReview(null);
      setMsg(map[e.message]||operatorErrorFallback(e.message,"การปิดวัน"));
    }finally{setBusy(false)}
  }

  const movementAmountNumber=Number(movementAmount)||0;
  const currentDrawerCash=Number(drawerSnapshot?.availableCash||0);
  const movementHighRisk=movementType==="CASH_OUT"&&movementAmountNumber>=500;
  const movementTooLarge=movementType==="CASH_OUT"&&movementAmountNumber>currentDrawerCash;
  const movementAfterCash=movementType==="CASH_IN"?currentDrawerCash+movementAmountNumber:currentDrawerCash-movementAmountNumber;
  const movementLocked=!!pendingMovement||movementRecoveryBlocked;
  const movementCanSubmit=!!shift&&shift.status==="open"&&!movementRecoveryBlocked&&(!!pendingMovement||(movementAmountNumber>0&&movementReason.trim().length>=2&&!movementTooLarge&&(!movementHighRisk||movementRiskConfirmed)));

  return <section className="soft-scroll h-full overflow-auto p-3 sm:p-5 md:p-7">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="gold m-0 text-[10px] font-bold tracking-[.3em]">งานประจำวัน</p><h1 className="mt-1 text-xl font-semibold sm:text-2xl">เปิดร้าน / ปิดร้าน</h1><p className="mt-1 text-xs text-slate-500">{businessDate||"วันนี้"} · เปิดร้านด้วยเงินทอนตั้งต้น แล้วนับเงินจริงก่อนปิดร้าน</p></div>{session.user.role==="admin"&&<button disabled={busy||deviceChecking||devicePreflight?.ok===false||!shift||shift.status!=="open"} onClick={close} className="min-h-11 rounded-full bg-[#d4af37] px-5 text-sm font-bold text-black disabled:opacity-40">{busy?"กำลังบันทึก...":"ปิดร้านวันนี้"}</button>}</header>

    {devicePreflight?.ok===false&&<div className="mt-4 rounded-2xl border-2 border-red-300 bg-red-50 p-4 text-red-950">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><b>ยังปิดวันไม่ได้ · ต้องจัดการรายการค้างในเครื่องนี้ก่อน</b><p className="mt-1 text-xs text-red-800">ระบบกลางเห็นเฉพาะรายการที่ส่งสำเร็จแล้ว · รายการที่ยังค้างในเครื่องนี้ต้องตรวจจากเครื่องนี้ก่อนปิดวัน</p></div><button type="button" disabled={deviceChecking} onClick={()=>refreshDevicePreflight()} className="min-h-11 rounded-xl border border-red-300 bg-white px-4 text-xs font-bold disabled:opacity-40">{deviceChecking?"กำลังตรวจ…":"ตรวจเครื่องนี้อีกครั้ง"}</button></div>
      <div className="mt-3 grid gap-2">{devicePreflight.blockers.map((blocker,index)=><div key={blocker.kind+":"+index} className="rounded-xl border border-red-200 bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><b className="text-sm">{blocker.title}</b><p className="mt-1 text-xs text-slate-600">{blocker.detail}</p>{blocker.actorId&&blocker.actorId!==session.user.id&&<p className="mt-1 text-[11px] font-semibold text-amber-800">รายการนี้เป็นของผู้ใช้ {blocker.actorId} บนเครื่องนี้ · ให้สลับกลับผู้ใช้นั้นเพื่อตรวจรายการเดิม · ห้ามสร้างรายการใหม่แทน</p>}</div>{blocker.route&&<button type="button" onClick={()=>window.location.assign(blocker.route!)} className="min-h-11 shrink-0 rounded-xl bg-red-700 px-4 text-xs font-bold text-white">{blocker.kind==="offline_cash"||blocker.kind==="cash_unknown"?"ไปหน้า POS":blocker.kind==="promptpay_unknown"?"ไปตรวจรายการรับเงินค้าง":blocker.kind==="stock_write_unknown"?"ไปหน้าสต็อก":blocker.kind==="order_mutation_unknown"?"ไปหน้า Orders":"ไปหน้า Expenses"}</button>}</div></div>)}</div>
    </div>}

    {session.user.role==="admin"&&<div className="glass card mt-4 p-4 sm:p-5">{!shift?<><div className="flex items-start justify-between gap-3"><div><b>1. เปิดร้าน / เงินทอนตั้งต้น</b><p className="mt-1 text-xs text-slate-500">ใส่เงินทอนตั้งต้นก่อนเริ่มขาย · ร้านทำงานคนเดียวจึงเปิดรอบเงินสดครั้งเดียวต่อวัน</p></div><span className="rounded-full bg-amber-100 px-3 py-1 text-[10px] font-bold text-amber-800">ยังไม่เปิดร้าน</span></div>{(pendingOpenShift||openShiftRecoveryBlocked)&&<div className={"mt-3 rounded-2xl border p-3 text-xs "+(openShiftRecoveryBlocked?"border-red-300 bg-red-50 text-red-800":"border-amber-300 bg-amber-50 text-amber-900")}><b>{openShiftRecoveryBlocked?"อ่านรายการเปิดร้านค้างไม่ได้":"มีคำสั่งเปิดร้านเดิมรอยืนยัน"}</b><p className="mt-1">{openShiftRecoveryBlocked?"ห้ามส่งคำสั่งใหม่จนกว่าจะอ่านข้อมูลรายการเดิมได้":"ระบบจะตรวจคำสั่งเดิมซ้ำ · ห้ามเปลี่ยนเงินตั้งต้นหรือกดสร้างรายการใหม่"}</p></div>}<div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]"><input inputMode="decimal" disabled={!!pendingOpenShift||openShiftRecoveryBlocked} value={openingCash} onChange={e=>setOpeningCash(e.target.value)} className="min-h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 disabled:text-slate-400" placeholder="เงินตั้งต้น เช่น 500"/><button type="button" disabled={busy||!!pendingOpenShift||openShiftRecoveryBlocked} onClick={()=>setOpeningCash("0")} className="min-h-12 rounded-2xl border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 disabled:opacity-40">ไม่มีเงินทอน · ฿0</button><button disabled={busy||openShiftRecoveryBlocked} onClick={openShift} className="min-h-12 rounded-2xl bg-[#d4af37] px-5 font-bold text-black disabled:opacity-40">{pendingOpenShift?"ตรวจผลการเปิดร้านเดิม":"เปิดร้านวันนี้"}</button></div></>:<><div className="flex flex-wrap items-start justify-between gap-3"><div><b>{shift.status==="open"?"ร้านเปิดอยู่":"วันนี้ปิดร้านแล้ว"}</b><p className="mt-1 text-xs text-slate-500">เปิดเมื่อ {new Date(shift.openedAt).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})}</p></div><div className="text-right"><small className="text-slate-500">เงินตั้งต้นที่ล็อก</small><div className="text-2xl font-semibold text-[#765b08]">฿{Number(shift.openingCash).toLocaleString()}</div></div></div>{shift.status==="open"&&<div className="mt-4 border-t border-slate-200 pt-4"><div className="flex items-start justify-between gap-3"><div><b>2. นับเงินสด 2 รอบโดยไม่ดูยอดระบบ</b><p className="mt-1 text-xs text-slate-500">ระบบยังไม่แสดงยอดเงินสดที่ควรมี จนกว่านับ 2 รอบตรงกัน เพื่อลดทั้งการกรอกผิดและการปรับตัวเลขตามระบบ · เงินสดที่นับได้จริงต้องนับใหม่อย่างอิสระทั้ง 2 รอบ · เงินสดที่ควรมี = เงินตั้งต้น + ยอดขายเงินสด + เงินเติมเข้า − ค่าใช้จ่ายเงินสด − เงินนำออก</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold">{review?"ตรวจแล้ว":"รอตรวจ"}</span></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="text-sm"><span className="text-slate-500">รอบที่ 1</span><input inputMode="decimal" value={firstCount} onChange={e=>{setFirstCount(e.target.value);setReview(null)}} className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" placeholder="นับเงินจริงรอบแรก"/></label><label className="text-sm"><span className="text-slate-500">รอบที่ 2 · นับใหม่อีกครั้ง</span><input inputMode="decimal" value={secondCount} onChange={e=>{setSecondCount(e.target.value);setReview(null)}} className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" placeholder="นับเงินจริงรอบสอง"/></label></div><button type="button" onClick={reviewCash} disabled={busy||deviceChecking||devicePreflight?.ok===false||!firstCount.trim()||!secondCount.trim()} className="mt-3 min-h-11 rounded-2xl border border-[#d4af37] bg-[#d4af37]/10 px-4 text-sm font-bold text-[#6f5510] disabled:opacity-40">ตรวจยอดก่อนปิดวัน</button>{review&&<div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4"><div className="grid gap-2 sm:grid-cols-3"><div><small className="text-slate-500">เงินสดที่ควรมี</small><div className="text-xl font-semibold">฿{Number(review.expectedCash).toLocaleString()}</div></div><div><small className="text-slate-500">นับจริง</small><div className="text-xl font-semibold">฿{Number(review.countedCash).toLocaleString()}</div></div><div><small className="text-slate-500">ส่วนต่าง</small><div className={"text-xl font-semibold "+(Number(review.variance)===0?"text-emerald-700":Number(review.variance)>0?"text-amber-700":"text-red-600")}>{Number(review.variance)>0?"+":""}฿{Number(review.variance).toLocaleString()}</div></div></div><div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm"><b>ผลตรวจ · {review.level}</b><div className="mt-1 text-slate-600">{review.summary}</div>{Array.isArray(review.evidence)&&review.evidence.length>0&&<div className="mt-2 text-xs text-slate-500">ตรวจประกอบจาก {review.evidence.length} ปัจจัย</div>}</div>{Number(review.variance)!==0&&<label className="mt-3 block text-sm"><span className="text-slate-500">เหตุผลเงินขาด/เกิน</span><input value={varianceReason} onChange={e=>setVarianceReason(e.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" placeholder="เช่น นับผิดรอบแรก / ทอนผิด / เงินออกยังไม่ได้บันทึก / ต้องตรวจเพิ่ม"/></label>}{review.ownerConfirmRequired&&<label className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><input type="checkbox" checked={confirmVariance} onChange={e=>setConfirmVariance(e.target.checked)} className="mt-1"/><span>ฉันเป็นเจ้าของและยืนยันว่าตรวจส่วนต่างนี้แล้ว · ระบบจะเก็บเหตุผลไว้ในประวัติถาวร</span></label>}</div>}</div>}</>}</div>}

    {session.user.role==="admin"&&shift?.status==="open"&&<div className="glass card mt-4 p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><b>เงินสดเข้า/ออกลิ้นชักระหว่างวัน</b><p className="mt-1 text-xs text-slate-500">ใช้เฉพาะเงินที่ไม่ใช่ยอดขายและไม่ใช่ค่าใช้จ่าย เช่น เติมเงินทอนเพิ่ม หรือนำเงินสดส่วนเกินออกไปเก็บ</p></div><div className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold text-slate-600">{movements.length} รายการวันนี้</div></div><div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]"><div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><small className="text-slate-500">เงินในลิ้นชักตามระบบตอนนี้</small><div className={"mt-1 text-2xl font-semibold "+(currentDrawerCash<0?"text-red-600":"text-slate-900")}>฿{currentDrawerCash.toLocaleString()}</div><p className="mt-1 text-[11px] text-slate-500">คำนวณจากข้อมูลล่าสุด: เงินตั้งต้น + ขายเงินสด + เติมเข้า − ค่าใช้จ่ายเงินสด − นำออก</p></div><button type="button" onClick={()=>{setMovementType("CASH_OUT");setMovementAmount("");setMovementReason("");setMovementRiskConfirmed(false);setDrawerOpen(true);setMsg("")}} className="min-h-12 rounded-2xl bg-[#d4af37] px-5 text-sm font-bold text-black">บันทึกเงินเข้า / ออก</button></div>{movements.length>0&&<div className="mt-4 space-y-2">{movements.map(x=><div key={x.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm"><div><b className={x.type==="CASH_IN"?"text-emerald-700":"text-red-600"}>{x.type==="CASH_IN"?"เติมเข้า":"นำออก"} ฿{x.amount.toLocaleString()}</b><div className="text-xs text-slate-500">{x.reason}</div></div><small className="text-slate-400">{new Date(x.time).toLocaleTimeString("th-TH",{timeZone:"Asia/Bangkok",hour:"2-digit",minute:"2-digit"})}</small></div>)}</div>}</div>}

    {drawerOpen&&<div className="field-modal-overlay fixed inset-0 z-[100] flex items-end justify-center bg-black/35 backdrop-blur-[2px] sm:items-center" onMouseDown={()=>{if(!busy)setDrawerOpen(false)}}><ModalFocus labelId="cash-drawer-dialog-title" onEscape={busy?undefined:()=>setDrawerOpen(false)} className="field-modal-panel soft-scroll w-full max-w-lg overflow-y-auto rounded-t-[28px] bg-white p-4 shadow-2xl sm:rounded-[28px] sm:p-5"><div onMouseDown={e=>e.stopPropagation()}><div className="flex items-start justify-between gap-3"><div><p className="m-0 text-[10px] font-black tracking-[.2em] text-[#765b08]">เงินสดในลิ้นชัก</p><h2 id="cash-drawer-dialog-title" className="mt-1 text-xl font-bold text-slate-900">บันทึกเงินเข้า / ออกลิ้นชัก</h2><p className="mt-1 text-xs text-slate-500">ระบบจะตรวจยอดล่าสุดอีกครั้งตอนกดยืนยัน เพื่อกันยอดเปลี่ยนระหว่างทำรายการ</p></div><button type="button" disabled={busy} aria-label="ปิดหน้าต่างเงินสด" onClick={()=>setDrawerOpen(false)} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-lg disabled:opacity-40">×</button></div>{pendingMovement&&<div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"><b>รายการเดิมยังรอการยืนยันผล</b><p className="mt-1">ช่องข้อมูลถูกล็อกเพื่อไม่ให้เปลี่ยนยอดหรือสร้างรายการใหม่ · ระบบจะตรวจรายการเดิมซ้ำเท่านั้น</p></div>}{movementRecoveryBlocked&&<div className="mt-3 rounded-2xl border border-red-300 bg-red-50 p-3 text-xs font-semibold text-red-800">อ่านข้อมูลรายการค้างไม่ได้ · ห้ามทำรายการเงินเข้า/ออกใหม่จนกว่าจะตรวจพื้นที่เก็บข้อมูลของเครื่องได้</div>}<div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1"><button type="button" disabled={movementLocked} onClick={()=>{setMovementType("CASH_OUT");setMovementRiskConfirmed(false)}} className={"min-h-11 rounded-xl text-sm font-bold "+(movementType==="CASH_OUT"?"bg-white text-red-600 shadow-sm":"text-slate-600")}>นำเงินออก</button><button type="button" disabled={movementLocked} onClick={()=>{setMovementType("CASH_IN");setMovementRiskConfirmed(false)}} className={"min-h-11 rounded-xl text-sm font-bold "+(movementType==="CASH_IN"?"bg-white text-emerald-700 shadow-sm":"text-slate-600")}>เติมเงินเข้า</button></div><div className="mt-4 grid grid-cols-2 gap-2 text-center"><div className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><small className="text-slate-500">ก่อนทำรายการ</small><div className="mt-1 text-lg font-semibold">฿{currentDrawerCash.toLocaleString()}</div></div><div className={"rounded-2xl border p-3 "+(movementTooLarge?"border-red-200 bg-red-50":"border-slate-200 bg-slate-50")}><small className="text-slate-500">หลังทำรายการ</small><div className={"mt-1 text-lg font-semibold "+(movementTooLarge?"text-red-600":movementType==="CASH_IN"?"text-emerald-700":"text-slate-900")}>฿{movementAfterCash.toLocaleString()}</div></div></div><label className="mt-4 block text-sm"><span className="font-semibold text-slate-700">จำนวนเงิน</span><input autoFocus inputMode="decimal" disabled={movementLocked} value={movementAmount} onChange={e=>setMovementAmount(e.target.value)} placeholder="0" className="mt-2 min-h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-lg font-semibold"/></label>{movementTooLarge&&<div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">นำออกเกินยอดในลิ้นชักตามระบบ · ไม่อนุญาตให้บันทึก</div>}<label className="mt-3 block text-sm"><span className="font-semibold text-slate-700">เหตุผล</span><input disabled={movementLocked} value={movementReason} onChange={e=>setMovementReason(e.target.value)} placeholder={movementType==="CASH_OUT"?"เช่น นำเงินส่วนเกินไปเก็บ":"เช่น เติมเงินทอนเพิ่ม"} className="mt-2 min-h-12 w-full rounded-2xl border border-slate-300 bg-white px-4"/></label>{movementHighRisk&&<label className="mt-3 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><input type="checkbox" disabled={movementLocked} checked={movementRiskConfirmed} onChange={e=>setMovementRiskConfirmed(e.target.checked)} className="mt-1 h-4 w-4"/><span><b>ยืนยันรายการเงินสดจำนวนสูง</b><br/><span className="text-xs">ฉันยืนยันการนำเงินสดออกตั้งแต่ ฿500 ขึ้นไป และเข้าใจว่ารายการนี้จะถูกเก็บในประวัติถาวร</span></span></label>}<div className="mt-4 grid grid-cols-2 gap-2"><button type="button" disabled={busy} onClick={()=>setDrawerOpen(false)} className="min-h-12 rounded-2xl border border-slate-300 bg-white text-sm font-bold text-slate-700 disabled:opacity-40">ยกเลิก</button><button type="button" disabled={busy||!movementCanSubmit} onClick={addMovement} className={"min-h-12 rounded-2xl text-sm font-bold text-white disabled:opacity-40 "+(movementType==="CASH_IN"?"bg-emerald-700":"bg-red-600")}>{busy?"กำลังตรวจรายการ...":pendingMovement?"ตรวจผลรายการเดิม":movementType==="CASH_IN"?"ยืนยันเติมเงิน":"ยืนยันนำเงินออก"}</button></div></div></ModalFocus></div>}

    {msg&&<div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-sm"><span>{msg}</span><div className="flex flex-wrap gap-2">{msg.includes("รายการรับเงิน")&&msg.includes("ค้าง")&&<button type="button" onClick={()=>window.location.assign("/orders")} className="min-h-10 rounded-xl bg-amber-600 px-3 text-xs font-bold text-white">ไปตรวจรายการรับเงินค้าง</button>}{msg.includes("ออเดอร์")&&msg.includes("ยัง")&&<button type="button" onClick={()=>window.location.assign("/queue")} className="min-h-10 rounded-xl bg-slate-900 px-3 text-xs font-bold text-white">ไปจัดการคิว</button>}{msg.includes("สต๊อก")&&msg.includes("อนุมัติ")&&<button type="button" onClick={()=>window.location.assign("/stock")} className="min-h-10 rounded-xl bg-emerald-700 px-3 text-xs font-bold text-white">ไปหน้าสต็อก</button>}</div></div>}
    <div className="mt-5 grid gap-3">{rows.map(x=><div key={x.id} className="glass card p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><small className="text-slate-500">{x.date}</small><div className="mt-1 text-2xl font-semibold gold">฿{x.revenue.toLocaleString()}</div><small className="text-slate-500">{x.orders} บิล · {x.cups} แก้ว</small></div><div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4"><div><small className="text-slate-500">เงินตั้งต้น</small><div>฿{Number(x.openingCash||0).toLocaleString()}</div></div><div><small className="text-slate-500">ยอดขายเงินสด</small><div>฿{x.cash.toLocaleString()}</div></div><div><small className="text-slate-500">เติมเงินเข้า</small><div className="text-emerald-700">+฿{Number(x.cashIn||0).toLocaleString()}</div></div><div><small className="text-slate-500">ค่าใช้จ่ายเงินสด</small><div className="text-red-600">−฿{Number(x.cashPaidOut||0).toLocaleString()}</div></div><div><small className="text-slate-500">นำเงินออก</small><div className="text-red-600">−฿{Number(x.cashOut||0).toLocaleString()}</div></div><div><small className="text-slate-500">เงินสดที่ควรมี</small><div>฿{Number(x.expectedCash??x.cash).toLocaleString()}</div></div><div><small className="text-slate-500">นับจริง</small><div>฿{Number(x.countedCash??x.cash).toLocaleString()}</div></div><div><small className="text-slate-500">ส่วนต่างเงินสด</small><div className={Number(x.cashVariance||0)===0?"text-emerald-700":Number(x.cashVariance||0)>0?"text-amber-700":"text-red-600"}>{Number(x.cashVariance||0)>0?"+":""}฿{Number(x.cashVariance||0).toLocaleString()}</div></div><div><small className="text-slate-500">PromptPay</small><div>฿{x.promptpay.toLocaleString()}</div></div><div><small className="text-slate-500">โอนธนาคาร</small><div>฿{Number(x.bank||0).toLocaleString()}</div></div><div><small className="text-slate-500">บัตร</small><div>฿{Number(x.card||0).toLocaleString()}</div></div><div><small className="text-slate-500">ต้นทุนวัตถุดิบ</small><div>฿{x.cogs.toLocaleString()}</div></div><div><small className="text-slate-500">ค่าใช้จ่ายดำเนินงาน</small><div>฿{x.expenses.toLocaleString()}</div></div><div><small className="text-slate-500">ซื้อสต็อก</small><div>฿{Number(x.purchaseSpend||0).toLocaleString()}</div></div><div><small className="text-slate-500">กำไรขั้นต้น</small><div>฿{x.grossProfit.toLocaleString()}</div></div><div><small className="text-slate-500">กำไรหลังค่าใช้จ่าย</small><div className={x.operatingProfit>=0?"text-emerald-700":"text-red-600"}>฿{x.operatingProfit.toLocaleString()}</div></div></div></div></div>)}</div>
  </section>
}
