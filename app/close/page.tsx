"use client";
import {useEffect,useState} from "react";
import AuthGate from "@/components/auth-gate";
import {api,type Session} from "@/lib/api-client";
import {readCloseDayDevicePreflight,type CloseDayDevicePreflight} from "@/lib/close-day-device-preflight";
import {prepareCriticalWriteIntent,readCriticalWriteIntent,sendCriticalWriteIntent,type CriticalWriteIntent} from "@/lib/critical-write-recovery";

type Close={id:string;date:string;revenue:number;cogs:number;expenses:number;purchaseSpend?:number;totalCashOut?:number;grossProfit:number;operatingProfit:number;cash:number;promptpay:number;bank?:number;card?:number;other:number;openingCash?:number;cashIn?:number;cashPaidOut?:number;cashOut?:number;expectedCash?:number;countedCash?:number;cashVariance?:number;orders:number;cups:number;time:number};
type Shift={id:string;date:string;status:"open"|"closed";openingCash:number;openedAt:number;openedBy:string;closedAt?:number;cashVariance?:number};
type Movement={id:string;shiftId:string;date:string;type:"CASH_IN"|"CASH_OUT";amount:number;reason:string;time:number;createdBy:string};
type DrawerSnapshot={openingCash:number;cashSales:number;cashIn:number;cashPaidOut:number;cashOut:number;availableCash:number};
type CloseData={closes:Close[];shift:Shift|null;businessDate:string;cashMovements:Movement[];drawerSnapshot:DrawerSnapshot|null};
type CashMovementBody=Record<string,any>&{requestKey:string;date:string;type:"CASH_IN"|"CASH_OUT";amount:number;reason:string;riskConfirmed:boolean};

export default function CloseDay(){return <AuthGate>{s=><View session={s}/>}</AuthGate>}

function View({session}:{session:Session}){
  const [rows,setRows]=useState<Close[]>([]),[shift,setShift]=useState<Shift|null>(null),[businessDate,setBusinessDate]=useState(""),[movements,setMovements]=useState<Movement[]>([]),[drawerSnapshot,setDrawerSnapshot]=useState<DrawerSnapshot|null>(null),[msg,setMsg]=useState(""),[busy,setBusy]=useState(false),[openingCash,setOpeningCash]=useState("0"),[firstCount,setFirstCount]=useState(""),[secondCount,setSecondCount]=useState(""),[review,setReview]=useState<any|null>(null),[varianceReason,setVarianceReason]=useState(""),[confirmVariance,setConfirmVariance]=useState(false),[drawerOpen,setDrawerOpen]=useState(false),[movementType,setMovementType]=useState<"CASH_IN"|"CASH_OUT">("CASH_OUT"),[movementAmount,setMovementAmount]=useState(""),[movementReason,setMovementReason]=useState(""),[movementRiskConfirmed,setMovementRiskConfirmed]=useState(false),[devicePreflight,setDevicePreflight]=useState<CloseDayDevicePreflight|null>(null),[deviceChecking,setDeviceChecking]=useState(false),[pendingMovement,setPendingMovement]=useState<CriticalWriteIntent<CashMovementBody>|null>(null);
  const load=()=>api<CloseData>("/api/close-day").then(x=>{setRows(x.closes||[]);setShift(x.shift||null);setBusinessDate(x.businessDate||"");setMovements(x.cashMovements||[]);setDrawerSnapshot(x.drawerSnapshot||null) });
  useEffect(()=>{load().catch(()=>{})},[]);
  useEffect(()=>{
    try{
      const intent=readCriticalWriteIntent<CashMovementBody>(session.user.id,"cashMovement");
      setPendingMovement(intent);
      if(intent)setMsg("มีรายการเงินสดเข้า/ออกที่ยังไม่ทราบผล · ระบบเก็บ Request Key เดิมไว้ กรุณาตรวจผลรายการเดิมก่อน");
    }catch{
      setMsg("ตรวจ Recovery ของเงินสดเข้า/ออกไม่ได้ · งดทำรายการใหม่จนกว่าจะอ่านข้อมูล Recovery ได้");
    }
  },[session.user.id]);
  useEffect(()=>{
    if(!drawerOpen)return;
    const onKey=(e:KeyboardEvent)=>{if(e.key==="Escape"&&!busy)setDrawerOpen(false)};
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[drawerOpen,busy]);

  async function refreshDevicePreflight(){
    if(!businessDate){
      const blocked:CloseDayDevicePreflight={ok:false,checkedAt:Date.now(),businessDate:"",blockers:[{kind:"storage_unreadable",title:"ยังยืนยันวันทำการไม่ได้",detail:"ระบบยังไม่ได้วันทำการจาก Server · กรุณารีเฟรชก่อนตรวจหรือปิดวัน"}]};
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

  async function openShift(){
    const opening=Number(openingCash||0);
    if(!Number.isFinite(opening)||opening<0){setMsg("เงินตั้งต้นต้องไม่ติดลบ");return}
    if(!window.confirm("ยืนยันเปิดร้านด้วยเงินตั้งต้น ฿"+opening.toLocaleString()+" ? หลังเปิดแล้วจำนวนนี้จะถูกล็อกสำหรับการกระทบยอดวันนี้"))return;
    setBusy(true);setMsg("");
    try{const r=await api<any>("/api/cash-shift/open",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({openingCash:opening})});setShift(r.shift);setMsg("เปิดร้านแล้ว · เงินตั้งต้น ฿"+Number(r.shift.openingCash).toLocaleString()+" ถูกล็อกแล้ว");await load()}
    catch(e:any){setMsg(e.message==="cash_shift_already_opened"?"วันนี้เปิดร้านไปแล้ว กรุณารีเฟรช":e.message==="day_already_closed"?"วันนี้ถูกปิดวันแล้ว":e.message)}
    finally{setBusy(false)}
  }

  const movementNotCommitted=new Set(["invalid_request_key","invalid_cash_movement_type","invalid_cash_movement_amount","cash_movement_reason_required","high_risk_confirmation_required","high_risk_reason_required","cash_shift_not_open","drawer_cash_shortage","day_already_closed","business_date_changed"]);

  async function sendMovementIntent(intent:CriticalWriteIntent<CashMovementBody>,recovered=false){
    const r=await sendCriticalWriteIntent(
      intent,
      body=>api<any>("/api/cash-shift/movements",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)}),
      (result,body,current)=>{
        const movement=result?.movement;
        return result?.ok===true&&movement&&movement.requestKey===body.requestKey&&movement.createdBy===current.actorId&&movement.date===body.date&&movement.type===body.type&&Number(movement.amount)===body.amount&&String(movement.reason||"")===body.reason;
      },
      movementNotCommitted
    );
    setPendingMovement(null);setMovementAmount("");setMovementReason("");setMovementRiskConfirmed(false);setDrawerOpen(false);
    setMsg((recovered?"ยืนยันผลรายการเดิมแล้ว · ":"")+(intent.body.type==="CASH_IN"?"บันทึกเติมเงินสดเข้าลิ้นชักแล้ว":"บันทึกนำเงินสดออกจากลิ้นชักแล้ว")+" · คงเหลือตามระบบ ฿"+Number(r.availableCash||0).toLocaleString());
    await load();
    await refreshDevicePreflight().catch(()=>{});
  }

  async function recoverMovement(){
    if(!pendingMovement)return;
    setBusy(true);setMsg("");
    try{await sendMovementIntent(pendingMovement,true)}
    catch(e:any){
      try{setPendingMovement(readCriticalWriteIntent<CashMovementBody>(session.user.id,"cashMovement"))}catch{}
      await refreshDevicePreflight().catch(()=>{});
      if(!e?.status||["network_unavailable","offline_write_blocked","critical_ack_unknown","critical_recovery_unavailable"].includes(String(e.message||""))){
        setMsg("ยังยืนยันผลรายการเงินสดเดิมไม่ได้ · ระบบเก็บ Request Key เดิมไว้ ห้ามสร้างรายการใหม่จนกว่าจะได้ ACK จาก Server");
      }else if(e.message==="request_key_conflict"){
        setMsg("Request Key เดิมไม่ตรงกับข้อมูลบน Server · หยุดและตรวจ Audit ก่อนดำเนินการต่อ");
      }else{
        setMsg("Server ยืนยันว่าไม่ได้บันทึกรายการเดิม · ตรวจยอดล่าสุดก่อนสร้างรายการใหม่");
      }
    }finally{setBusy(false)}
  }

  async function addMovement(){
    const amount=Number(movementAmount);
    if(pendingMovement){setMsg("มีรายการเงินสดเดิมที่ยังไม่ทราบผล · กรุณากดตรวจผลรายการเดิมก่อน");return}
    if(!businessDate){setMsg("ยังไม่ได้วันทำการจาก Server · กรุณารีเฟรชก่อนทำรายการเงินสด");return}
    if(!shift||shift.status!=="open"){setMsg("ต้องเปิดร้านก่อนบันทึกเงินเข้า/ออกลิ้นชัก");return}
    if(!Number.isFinite(amount)||amount<=0){setMsg("กรุณากรอกจำนวนเงินที่ถูกต้อง");return}
    if(movementReason.trim().length<2){setMsg("กรุณาระบุเหตุผล");return}
    if(movementType==="CASH_OUT"&&amount>=500&&!movementRiskConfirmed){setMsg("รายการนำเงินออกตั้งแต่ ฿500 ต้องยืนยัน High-Risk Action ก่อน");return}
    setBusy(true);setMsg("");
    try{
      const body:CashMovementBody={requestKey:crypto.randomUUID(),date:businessDate,type:movementType,amount,reason:movementReason.trim(),riskConfirmed:movementRiskConfirmed};
      const intent=prepareCriticalWriteIntent(session.user.id,"cashMovement",body);
      setPendingMovement(intent);
      await refreshDevicePreflight().catch(()=>{});
      await sendMovementIntent(intent);
    }catch(e:any){
      try{setPendingMovement(readCriticalWriteIntent<CashMovementBody>(session.user.id,"cashMovement"))}catch{}
      setDrawerOpen(false);
      await refreshDevicePreflight().catch(()=>{});
      if(!e?.status||["network_unavailable","offline_write_blocked","critical_ack_unknown","critical_recovery_unavailable","pending_critical_write_exists"].includes(String(e.message||""))){
        setMsg("ยังไม่ทราบว่า Server บันทึกรายการเงินสดแล้วหรือไม่ · ระบบเก็บข้อมูลและ Request Key เดิมไว้ ห้ามทำรายการซ้ำ ให้ใช้ “ตรวจผลรายการเดิม”");
      }else{
        const map:Record<string,string>={
          drawer_cash_shortage:"เงินสดตามระบบไม่พอ · Server ยืนยันว่าไม่ได้บันทึกรายการนี้",
          cash_shift_not_open:"กะเงินสดไม่เปิด · Server ยืนยันว่าไม่ได้บันทึกรายการนี้",
          day_already_closed:"วันนี้ถูกปิดวันแล้ว · Server ยืนยันว่าไม่ได้บันทึกรายการใหม่",
          business_date_changed:"วันทำการเปลี่ยนแล้ว · Server ยืนยันว่าไม่ได้บันทึกรายการใหม่ กรุณาโหลดวันล่าสุดก่อนทำรายการ",
          high_risk_confirmation_required:"รายการนี้ต้องยืนยัน High-Risk Action ก่อน",
          high_risk_reason_required:"กรุณาระบุเหตุผลให้ชัดเจน",
          cash_movement_reason_required:"กรุณาระบุเหตุผลให้ชัดเจน",
          invalid_cash_movement_amount:"จำนวนเงินไม่ถูกต้อง",
          request_key_conflict:"Request Key เดิมไม่ตรงกับข้อมูลเดิม · หยุดและตรวจ Audit ก่อน"
        };
        setMsg(map[e.message]||"Server ปฏิเสธรายการนี้ · ตรวจยอดล่าสุดก่อนลองใหม่");
      }
      await load().catch(()=>{});
    }finally{setBusy(false)}
  }

  async function reviewCash(){
    const first=Number(firstCount),second=Number(secondCount);
    if(!shift||shift.status!=="open"){setMsg("กรุณาเปิดร้านและล็อกเงินตั้งต้นก่อนปิดวัน");return}
    if(!firstCount.trim()||!Number.isFinite(first)||first<0){setMsg("กรุณากรอกยอดนับรอบที่ 1");return}
    if(!secondCount.trim()||!Number.isFinite(second)||second<0){setMsg("กรุณากรอกยอดนับรอบที่ 2");return}
    const local=await refreshDevicePreflight();
    if(!local.ok){setReview(null);setMsg("ยังตรวจปิดวันไม่ได้ · เครื่องนี้มีรายการค้างหรืออ่าน recovery ไม่ได้ กรุณาจัดการรายการที่แสดงด้านบนก่อน");return}
    setBusy(true);setMsg("");setReview(null);setVarianceReason("");setConfirmVariance(false);
    try{
      const r=await api<any>("/api/close-day/review",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({firstCount:first,secondCount:second})});
      setReview(r.review);
      const v=Number(r.review.variance||0);
      setMsg(v===0?"AI ตรวจแล้ว · เงินสดตรงพอดี":r.review.summary||"AI พบส่วนต่าง กรุณาตรวจสอบก่อนปิดวัน");
    }catch(e:any){
      if(e.message==="cash_recount_mismatch"){
        setSecondCount("");setMsg("ยอดนับรอบ 1 และรอบ 2 ไม่ตรงกัน · กรุณานับรอบ 2 ใหม่โดยไม่ดูยอดระบบ");
      }else setMsg(e.message==="close_day_pending_payments"?"ยังมี Payment ค้าง ต้องจัดการก่อน":e.message==="close_day_open_orders"?"ยังมีออเดอร์ที่ยังไม่ส่งมอบ":e.message==="close_day_pending_stock_count_approval"?"มีผลนับสต๊อกรอ Owner อนุมัติ กรุณาจัดการก่อนปิดวัน":e.message==="cash_shift_not_open"?"ยังไม่ได้เปิดกะเงินสด":e.message);
    }finally{setBusy(false)}
  }

  async function close(){
    if(!review){setMsg("กรุณานับเงิน 2 รอบและให้ AI ตรวจสอบก่อนปิดวัน");return}
    const counted=Number(review.countedCash);
    if(review.variance!==0&&varianceReason.trim().length<2){setMsg("เงินขาด/เกินต้องระบุเหตุผลก่อนปิดวัน");return}
    if(review.ownerConfirmRequired&&!confirmVariance){setMsg("ส่วนต่างสูง ต้องติ๊กยืนยันโดยเจ้าของก่อนปิดวัน");return}
    const local=await refreshDevicePreflight();
    if(!local.ok){setMsg("ยังปิดวันไม่ได้ · พบรายการค้างในเครื่องหรืออ่าน recovery ไม่ได้ กรุณาจัดการก่อน แล้วตรวจใหม่");return}
    if(!window.confirm("ยืนยันปิดวันตามผลตรวจ AI? "+(review.variance===0?"เงินสดตรงพอดี":review.summary)))return;
    setBusy(true);setMsg("");
    try{
      const r=await api<any>("/api/close-day",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({countedCash:counted,reviewId:review.id,varianceReason:varianceReason.trim(),confirmVariance})});
      const v=Number(r.close.cashVariance||0);
      setMsg("ปิดวันสำเร็จ · เงินสด "+(v===0?"ตรงพอดี":v>0?"เกิน ฿"+v.toLocaleString():"ขาด ฿"+Math.abs(v).toLocaleString()));
      setFirstCount("");setSecondCount("");setReview(null);setVarianceReason("");setConfirmVariance(false);await load();
    }catch(e:any){
      const map:Record<string,string>={
        day_already_closed:"วันนี้ถูกปิดวันแล้ว",
        close_day_pending_payments:"ยังมี Payment ที่ค้างอยู่",
        close_day_open_orders:"ยังมีออเดอร์ที่ยังไม่ได้ส่งมอบ",
        close_day_pending_stock_count_approval:"มีผลนับสต๊อกรอ Owner อนุมัติ กรุณาไปหน้า Stock เพื่ออนุมัติหรือตีกลับก่อนปิดวัน",
        close_day_review_required:"ต้องผ่านการตรวจ 2 รอบก่อน",
        close_day_review_expired:"ผลตรวจหมดอายุ กรุณานับใหม่",
        close_day_review_stale:"ข้อมูลการเงินเปลี่ยนหลังตรวจ กรุณานับและตรวจใหม่",
        close_day_review_count_changed:"ยอดนับเปลี่ยนจากผลตรวจ กรุณาตรวจใหม่",
        cash_variance_reason_required:"เงินขาด/เกินต้องระบุเหตุผล",
        cash_variance_owner_confirmation_required:"ส่วนต่างสูง ต้องยืนยันโดยเจ้าของ"
      };
      if(["close_day_review_expired","close_day_review_stale","close_day_review_count_changed"].includes(e.message))setReview(null);
      setMsg(map[e.message]||e.message);
    }finally{setBusy(false)}
  }

  const movementAmountNumber=Number(movementAmount)||0;
  const currentDrawerCash=Number(drawerSnapshot?.availableCash||0);
  const movementHighRisk=movementType==="CASH_OUT"&&movementAmountNumber>=500;
  const movementTooLarge=movementType==="CASH_OUT"&&movementAmountNumber>currentDrawerCash;
  const movementAfterCash=movementType==="CASH_IN"?currentDrawerCash+movementAmountNumber:currentDrawerCash-movementAmountNumber;
  const movementCanSubmit=!pendingMovement&&!!businessDate&&!!shift&&shift.status==="open"&&movementAmountNumber>0&&movementReason.trim().length>=2&&!movementTooLarge&&(!movementHighRisk||movementRiskConfirmed);

  return <section className="soft-scroll h-full overflow-auto p-3 sm:p-5 md:p-7">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="gold m-0 text-[10px] font-bold tracking-[.3em]">DAILY CONTROL</p><h1 className="mt-1 text-xl font-semibold sm:text-2xl">OPEN / CLOSE DAY</h1><p className="mt-1 text-xs text-slate-500">{businessDate||"วันนี้"} · เปิดร้านด้วยเงินทอนตั้งต้น แล้วนับเงินจริงก่อนปิดร้าน</p></div>{session.user.role==="admin"&&<button disabled={busy||deviceChecking||devicePreflight?.ok===false||!shift||shift.status!=="open"} onClick={close} className="min-h-11 rounded-full bg-[#d4af37] px-5 text-sm font-bold text-black disabled:opacity-40">{busy?"กำลังบันทึก...":"ปิดร้านวันนี้"}</button>}</header>

    {pendingMovement&&<div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><b>มีรายการเงินสดเข้า/ออกที่ยังไม่ทราบผล</b><p className="mt-1 text-xs">ระบบล็อก Request Key เดิมไว้ · {pendingMovement.body.type==="CASH_IN"?"เติมเงิน":"นำเงินออก"} ฿{Number(pendingMovement.body.amount).toLocaleString()} · ห้ามสร้างรายการใหม่แทนจนกว่า Server จะยืนยันผลเดิม</p><button type="button" disabled={busy} onClick={recoverMovement} className="mt-3 min-h-11 rounded-xl bg-amber-700 px-4 text-xs font-bold text-white disabled:opacity-40">ตรวจผลรายการเดิม</button></div>}

    {devicePreflight?.ok===false&&<div className="mt-4 rounded-2xl border-2 border-red-300 bg-red-50 p-4 text-red-950">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><b>ยังปิดวันไม่ได้ · ต้องจัดการรายการค้างในเครื่องนี้ก่อน</b><p className="mt-1 text-xs text-red-800">Server ตรวจเฉพาะรายการที่ขึ้น Cloud แล้ว ส่วนรายการ Offline/Recovery ใน browser ต้องตรวจจากเครื่องนี้แยกต่างหาก</p></div><button type="button" disabled={deviceChecking} onClick={()=>refreshDevicePreflight()} className="min-h-11 rounded-xl border border-red-300 bg-white px-4 text-xs font-bold disabled:opacity-40">{deviceChecking?"กำลังตรวจ…":"ตรวจเครื่องนี้อีกครั้ง"}</button></div>
      <div className="mt-3 grid gap-2">{devicePreflight.blockers.map((blocker,index)=><div key={blocker.kind+":"+index} className="rounded-xl border border-red-200 bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><b className="text-sm">{blocker.title}</b><p className="mt-1 text-xs text-slate-600">{blocker.detail}</p>{(blocker.kind==="expense_unknown"||blocker.kind==="critical_write_unknown")&&blocker.actorId&&blocker.actorId!==session.user.id&&<p className="mt-1 text-[11px] font-semibold text-amber-800">ให้สลับกลับไปผู้ใช้ {blocker.actorId} บนเครื่องนี้เพื่อตรวจรายการเดิม ห้ามสร้างรายการใหม่แทน</p>}</div>{blocker.route&&<button type="button" onClick={()=>window.location.assign(blocker.route!)} className="min-h-11 shrink-0 rounded-xl bg-red-700 px-4 text-xs font-bold text-white">{blocker.route==="/pos"?"ไปหน้า POS":blocker.route==="/orders"?"ไป Payment Recovery":blocker.route==="/stock"?"ไปหน้า Stock":blocker.route==="/close"?"ตรวจรายการเงินสด":"ไปหน้า Expenses"}</button>}</div></div>)}</div>
    </div>}

    {session.user.role==="admin"&&<div className="glass card mt-4 p-4 sm:p-5">{!shift?<><div className="flex items-start justify-between gap-3"><div><b>1. เปิดร้าน / เงินทอนตั้งต้น</b><p className="mt-1 text-xs text-slate-500">ใส่เงินทอนตั้งต้นก่อนเริ่มขาย · ร้านทำงานคนเดียวจึงเปิดรอบเงินสดครั้งเดียวต่อวัน</p></div><span className="rounded-full bg-amber-100 px-3 py-1 text-[10px] font-bold text-amber-800">ยังไม่เปิดร้าน</span></div><div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]"><input inputMode="decimal" value={openingCash} onChange={e=>setOpeningCash(e.target.value)} className="min-h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4" placeholder="เงินตั้งต้น เช่น 500"/><button type="button" disabled={busy} onClick={()=>setOpeningCash("0")} className="min-h-12 rounded-2xl border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 disabled:opacity-40">ไม่มีเงินทอน · ฿0</button><button disabled={busy} onClick={openShift} className="min-h-12 rounded-2xl bg-[#d4af37] px-5 font-bold text-black disabled:opacity-40">เปิดร้านวันนี้</button></div></>:<><div className="flex flex-wrap items-start justify-between gap-3"><div><b>{shift.status==="open"?"ร้านเปิดอยู่":"วันนี้ปิดร้านแล้ว"}</b><p className="mt-1 text-xs text-slate-500">เปิดเมื่อ {new Date(shift.openedAt).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})}</p></div><div className="text-right"><small className="text-slate-500">เงินตั้งต้นที่ล็อก</small><div className="text-2xl font-semibold text-[#765b08]">฿{Number(shift.openingCash).toLocaleString()}</div></div></div>{shift.status==="open"&&<div className="mt-4 border-t border-slate-200 pt-4"><div className="flex items-start justify-between gap-3"><div><b>2. นับเงินสดแบบ Blind Count 2 รอบ</b><p className="mt-1 text-xs text-slate-500">ระบบยังไม่แสดง Expected Cash จนกว่านับ 2 รอบตรงกัน เพื่อลดทั้งการกรอกผิดและการปรับตัวเลขตามระบบ · เงินสดที่นับได้จริงต้องนับใหม่อย่างอิสระทั้ง 2 รอบ · Expected Cash = เงินตั้งต้น + ยอดขายเงินสด + เงินเติมเข้า − ค่าใช้จ่ายเงินสด − เงินนำออก</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold">{review?"ตรวจแล้ว":"รอตรวจ"}</span></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="text-sm"><span className="text-slate-500">รอบที่ 1</span><input inputMode="decimal" value={firstCount} onChange={e=>{setFirstCount(e.target.value);setReview(null)}} className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" placeholder="นับเงินจริงรอบแรก"/></label><label className="text-sm"><span className="text-slate-500">รอบที่ 2 · นับใหม่อีกครั้ง</span><input inputMode="decimal" value={secondCount} onChange={e=>{setSecondCount(e.target.value);setReview(null)}} className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" placeholder="นับเงินจริงรอบสอง"/></label></div><button type="button" onClick={reviewCash} disabled={busy||deviceChecking||devicePreflight?.ok===false||!firstCount.trim()||!secondCount.trim()} className="mt-3 min-h-11 rounded-2xl border border-[#d4af37] bg-[#d4af37]/10 px-4 text-sm font-bold text-[#6f5510] disabled:opacity-40">AI ตรวจความถูกต้องก่อนปิดวัน</button>{review&&<div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4"><div className="grid gap-2 sm:grid-cols-3"><div><small className="text-slate-500">Expected Cash</small><div className="text-xl font-semibold">฿{Number(review.expectedCash).toLocaleString()}</div></div><div><small className="text-slate-500">นับจริง</small><div className="text-xl font-semibold">฿{Number(review.countedCash).toLocaleString()}</div></div><div><small className="text-slate-500">ส่วนต่าง</small><div className={"text-xl font-semibold "+(Number(review.variance)===0?"text-emerald-700":Number(review.variance)>0?"text-amber-700":"text-red-600")}>{Number(review.variance)>0?"+":""}฿{Number(review.variance).toLocaleString()}</div></div></div><div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm"><b>AI Assessment · {review.level}</b><div className="mt-1 text-slate-600">{review.summary}</div>{Array.isArray(review.evidence)&&review.evidence.length>0&&<div className="mt-2 text-xs text-slate-500">ตรวจประกอบจาก {review.evidence.map((x:any)=>x.code).join(" · ")}</div>}</div>{Number(review.variance)!==0&&<label className="mt-3 block text-sm"><span className="text-slate-500">เหตุผลเงินขาด/เกิน</span><input value={varianceReason} onChange={e=>setVarianceReason(e.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" placeholder="เช่น นับผิดรอบแรก / ทอนผิด / เงินออกยังไม่ได้บันทึก / ต้องตรวจเพิ่ม"/></label>}{review.ownerConfirmRequired&&<label className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><input type="checkbox" checked={confirmVariance} onChange={e=>setConfirmVariance(e.target.checked)} className="mt-1"/><span>ฉันเป็นเจ้าของและยืนยันว่าตรวจส่วนต่างนี้แล้ว ระบบจะเก็บเหตุผลและ Audit Log ถาวร</span></label>}</div>}</div>}</>}</div>}

    {session.user.role==="admin"&&shift?.status==="open"&&<div className="glass card mt-4 p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><b>เงินสดเข้า/ออกลิ้นชักระหว่างวัน</b><p className="mt-1 text-xs text-slate-500">ใช้เฉพาะเงินที่ไม่ใช่ยอดขายและไม่ใช่ค่าใช้จ่าย เช่น เติมเงินทอนเพิ่ม หรือนำเงินสดส่วนเกินออกไปเก็บ</p></div><div className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold text-slate-600">{movements.length} รายการวันนี้</div></div><div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]"><div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><small className="text-slate-500">เงินในลิ้นชักตามระบบตอนนี้</small><div className={"mt-1 text-2xl font-semibold "+(currentDrawerCash<0?"text-red-600":"text-slate-900")}>฿{currentDrawerCash.toLocaleString()}</div><p className="mt-1 text-[11px] text-slate-500">คำนวณจาก Server: เงินตั้งต้น + ขายเงินสด + เติมเข้า − ค่าใช้จ่ายเงินสด − นำออก</p></div><button type="button" disabled={busy||!!pendingMovement} onClick={()=>{setMovementType("CASH_OUT");setMovementAmount("");setMovementReason("");setMovementRiskConfirmed(false);setDrawerOpen(true);setMsg("")}} className="min-h-12 rounded-2xl bg-[#d4af37] px-5 text-sm font-bold text-black disabled:opacity-40">บันทึกเงินเข้า / ออก</button></div>{movements.length>0&&<div className="mt-4 space-y-2">{movements.map(x=><div key={x.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm"><div><b className={x.type==="CASH_IN"?"text-emerald-700":"text-red-600"}>{x.type==="CASH_IN"?"เติมเข้า":"นำออก"} ฿{x.amount.toLocaleString()}</b><div className="text-xs text-slate-500">{x.reason}</div></div><small className="text-slate-400">{new Date(x.time).toLocaleTimeString("th-TH",{timeZone:"Asia/Bangkok",hour:"2-digit",minute:"2-digit"})}</small></div>)}</div>}</div>}

    {drawerOpen&&<div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onClick={()=>{if(!busy)setDrawerOpen(false)}}><div role="dialog" aria-modal="true" aria-labelledby="cash-drawer-dialog-title" onClick={e=>e.stopPropagation()} className="w-full max-w-lg rounded-t-[28px] bg-white p-4 shadow-2xl sm:rounded-[28px] sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="m-0 text-[10px] font-black tracking-[.2em] text-[#765b08]">CASH DRAWER CONTROL</p><h2 id="cash-drawer-dialog-title" className="mt-1 text-xl font-bold text-slate-900">บันทึกเงินเข้า / ออกลิ้นชัก</h2><p className="mt-1 text-xs text-slate-500">ระบบจะตรวจยอดอีกครั้งที่ Server ตอนกดยืนยัน เพื่อกันยอดเปลี่ยนระหว่างทำรายการ</p></div><button type="button" disabled={busy} aria-label="ปิดหน้าต่างเงินสด" onClick={()=>setDrawerOpen(false)} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-lg disabled:opacity-40">×</button></div><div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1"><button type="button" onClick={()=>{setMovementType("CASH_OUT");setMovementRiskConfirmed(false)}} className={"min-h-11 rounded-xl text-sm font-bold "+(movementType==="CASH_OUT"?"bg-white text-red-600 shadow-sm":"text-slate-600")}>นำเงินออก</button><button type="button" onClick={()=>{setMovementType("CASH_IN");setMovementRiskConfirmed(false)}} className={"min-h-11 rounded-xl text-sm font-bold "+(movementType==="CASH_IN"?"bg-white text-emerald-700 shadow-sm":"text-slate-600")}>เติมเงินเข้า</button></div><div className="mt-4 grid grid-cols-2 gap-2 text-center"><div className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><small className="text-slate-500">ก่อนทำรายการ</small><div className="mt-1 text-lg font-semibold">฿{currentDrawerCash.toLocaleString()}</div></div><div className={"rounded-2xl border p-3 "+(movementTooLarge?"border-red-200 bg-red-50":"border-slate-200 bg-slate-50")}><small className="text-slate-500">หลังทำรายการ</small><div className={"mt-1 text-lg font-semibold "+(movementTooLarge?"text-red-600":movementType==="CASH_IN"?"text-emerald-700":"text-slate-900")}>฿{movementAfterCash.toLocaleString()}</div></div></div><label className="mt-4 block text-sm"><span className="font-semibold text-slate-700">จำนวนเงิน</span><input autoFocus inputMode="decimal" value={movementAmount} onChange={e=>setMovementAmount(e.target.value)} placeholder="0" className="mt-2 min-h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-lg font-semibold"/></label>{movementTooLarge&&<div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">นำออกเกินยอดในลิ้นชักตามระบบ · ไม่อนุญาตให้บันทึก</div>}<label className="mt-3 block text-sm"><span className="font-semibold text-slate-700">เหตุผล</span><input value={movementReason} onChange={e=>setMovementReason(e.target.value)} placeholder={movementType==="CASH_OUT"?"เช่น นำเงินส่วนเกินไปเก็บ":"เช่น เติมเงินทอนเพิ่ม"} className="mt-2 min-h-12 w-full rounded-2xl border border-slate-300 bg-white px-4"/></label>{movementHighRisk&&<label className="mt-3 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><input type="checkbox" checked={movementRiskConfirmed} onChange={e=>setMovementRiskConfirmed(e.target.checked)} className="mt-1 h-4 w-4"/><span><b>High-Risk Action</b><br/><span className="text-xs">ฉันยืนยันการนำเงินสดออกตั้งแต่ ฿500 ขึ้นไป และเข้าใจว่ารายการนี้จะถูกบันทึก Audit Log ถาวร</span></span></label>}<div className="mt-4 grid grid-cols-2 gap-2"><button type="button" disabled={busy} onClick={()=>setDrawerOpen(false)} className="min-h-12 rounded-2xl border border-slate-300 bg-white text-sm font-bold text-slate-700 disabled:opacity-40">ยกเลิก</button><button type="button" disabled={busy||!movementCanSubmit} onClick={addMovement} className={"min-h-12 rounded-2xl text-sm font-bold text-white disabled:opacity-40 "+(movementType==="CASH_IN"?"bg-emerald-700":"bg-red-600")}>{busy?"กำลังบันทึก...":movementType==="CASH_IN"?"ยืนยันเติมเงิน":"ยืนยันนำเงินออก"}</button></div></div></div>}

    {msg&&<div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-sm"><span>{msg}</span><div className="flex flex-wrap gap-2">{msg.includes("Payment")&&msg.includes("ค้าง")&&<button type="button" onClick={()=>window.location.assign("/orders")} className="min-h-10 rounded-xl bg-amber-600 px-3 text-xs font-bold text-white">ไป Payment Recovery</button>}{msg.includes("ออเดอร์")&&msg.includes("ยัง")&&<button type="button" onClick={()=>window.location.assign("/queue")} className="min-h-10 rounded-xl bg-slate-900 px-3 text-xs font-bold text-white">ไปจัดการคิว</button>}{msg.includes("สต๊อก")&&msg.includes("อนุมัติ")&&<button type="button" onClick={()=>window.location.assign("/stock")} className="min-h-10 rounded-xl bg-emerald-700 px-3 text-xs font-bold text-white">ไปหน้า Stock</button>}</div></div>}
    <div className="mt-5 grid gap-3">{rows.map(x=><div key={x.id} className="glass card p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><small className="text-slate-500">{x.date}</small><div className="mt-1 text-2xl font-semibold gold">฿{x.revenue.toLocaleString()}</div><small className="text-slate-500">{x.orders} orders · {x.cups} cups</small></div><div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4"><div><small className="text-slate-500">Opening Cash</small><div>฿{Number(x.openingCash||0).toLocaleString()}</div></div><div><small className="text-slate-500">Cash Sales</small><div>฿{x.cash.toLocaleString()}</div></div><div><small className="text-slate-500">Cash In</small><div className="text-emerald-700">+฿{Number(x.cashIn||0).toLocaleString()}</div></div><div><small className="text-slate-500">Cash Paid Out</small><div className="text-red-600">−฿{Number(x.cashPaidOut||0).toLocaleString()}</div></div><div><small className="text-slate-500">Cash Out</small><div className="text-red-600">−฿{Number(x.cashOut||0).toLocaleString()}</div></div><div><small className="text-slate-500">Expected Drawer</small><div>฿{Number(x.expectedCash??x.cash).toLocaleString()}</div></div><div><small className="text-slate-500">Counted Cash</small><div>฿{Number(x.countedCash??x.cash).toLocaleString()}</div></div><div><small className="text-slate-500">Cash Variance</small><div className={Number(x.cashVariance||0)===0?"text-emerald-700":Number(x.cashVariance||0)>0?"text-amber-700":"text-red-600"}>{Number(x.cashVariance||0)>0?"+":""}฿{Number(x.cashVariance||0).toLocaleString()}</div></div><div><small className="text-slate-500">PromptPay</small><div>฿{x.promptpay.toLocaleString()}</div></div><div><small className="text-slate-500">โอนธนาคาร</small><div>฿{Number(x.bank||0).toLocaleString()}</div></div><div><small className="text-slate-500">บัตร</small><div>฿{Number(x.card||0).toLocaleString()}</div></div><div><small className="text-slate-500">COGS</small><div>฿{x.cogs.toLocaleString()}</div></div><div><small className="text-slate-500">Operating Expenses</small><div>฿{x.expenses.toLocaleString()}</div></div><div><small className="text-slate-500">Purchase Spend</small><div>฿{Number(x.purchaseSpend||0).toLocaleString()}</div></div><div><small className="text-slate-500">Gross Profit</small><div>฿{x.grossProfit.toLocaleString()}</div></div><div><small className="text-slate-500">Operating Profit</small><div className={x.operatingProfit>=0?"text-emerald-700":"text-red-600"}>฿{x.operatingProfit.toLocaleString()}</div></div></div></div></div>)}</div>
  </section>
}
