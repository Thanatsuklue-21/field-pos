"use client";

import {useEffect,useRef,useState} from "react";
import {AlertTriangle,CheckCircle2,RefreshCw} from "lucide-react";
import {api,type Session} from "@/lib/api-client";
import {readCloseDayDevicePreflight,type CloseDayDeviceBlocker,type CloseDayDevicePreflight} from "@/lib/close-day-device-preflight";
import {prepareCloseDayWriteIntent,readCloseDayWriteIntent,sendCloseDayWriteIntent,type CloseDayWriteBody,type CloseDayWriteIntent} from "@/lib/close-day-write-recovery";
import {operatorErrorFallback} from "@/lib/operator-error-language.mjs";

type WorkspaceTabTarget="queue"|"orders"|"stock"|"expense"|"status";
type Shift={status:"open"|"closed";openingCash:number}|null;
type Review={
  id:string;countedCash:number;expectedCash:number;variance:number;summary?:string;
  reasonRequired?:boolean;ownerConfirmRequired?:boolean;level?:string;
};

const money=(value:any)=>new Intl.NumberFormat("th-TH",{minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(value)||0);

function errorText(code:string){
  const map:Record<string,string>={
    invalid_request_key:"รหัสกันรายการซ้ำไม่ถูกต้อง",
    invalid_date:"วันทำการไม่ถูกต้อง · รีเฟรชก่อนตรวจหรือปิดร้าน",
    business_date_changed:"วันทำการเปลี่ยนแล้ว · ระบบจะไม่สร้างรายการซ้ำ กรุณารีเฟรช",
    first_cash_count_required:"กรุณากรอกยอดนับรอบที่ 1",
    second_cash_count_required:"กรุณากรอกยอดนับรอบที่ 2",
    cash_recount_mismatch:"ยอดนับรอบ 1 และรอบ 2 ไม่ตรงกัน · กรุณานับรอบ 2 ใหม่โดยไม่ดูยอดระบบ",
    day_already_closed:"วันนี้ถูกปิดร้านแล้ว",
    cash_shift_not_open:"ยังไม่ได้เปิดร้านวันนี้",
    close_day_pending_payments:"ยังมีรายการรับเงินที่ค้างอยู่",
    close_day_open_orders:"ยังมีออเดอร์ที่ยังไม่ได้ส่งมอบ",
    close_day_pending_stock_count_approval:"มีผลนับสต็อกรออนุมัติ",
    accounting_reconciliation_failed:"บัญชียังมียอดที่กระทบกันไม่ครบ · ต้องแก้ก่อนปิดร้าน",
    close_day_review_required:"ต้องตรวจเงินสด 2 รอบก่อน",
    close_day_review_expired:"ผลตรวจหมดอายุ · กรุณานับใหม่",
    close_day_review_stale:"ข้อมูลการเงินเปลี่ยนหลังตรวจ · กรุณานับใหม่",
    close_day_review_count_changed:"ยอดนับเปลี่ยนจากผลตรวจ · กรุณาตรวจใหม่",
    cash_variance_reason_required:"เงินขาด/เกินต้องระบุเหตุผล",
    cash_variance_owner_confirmation_required:"ส่วนต่างสูง · ต้องยืนยันโดยเจ้าของร้าน",
    pending_close_day_write_exists:"มีการตรวจหรือปิดร้านครั้งก่อนที่ยังไม่ทราบผล · ต้องตรวจรายการเดิมก่อน",
    close_day_ack_unknown:"ระบบยังยืนยันผลเดิมไม่ครบ · เก็บรายการเดิมไว้และห้ามสร้างรายการใหม่",
    close_day_recovery_unavailable:"อ่านข้อมูลป้องกันการปิดร้านซ้ำไม่ได้ · ระบบหยุดการตรวจและปิดร้านใหม่ชั่วคราว",
    request_key_conflict:"ข้อมูลรายการเดิมไม่ตรงกัน · หยุดปิดร้านและตรวจประวัติก่อน",
    network_unavailable:"เน็ตขาดระหว่างตรวจหรือปิดร้าน · ยังไม่ทราบผล ระบบเก็บรายการเดิมไว้",
    offline_write_blocked:"ออฟไลน์อยู่ · ต้องเชื่อมต่อก่อนตรวจหรือปิดร้าน"
  };
  return map[code]||operatorErrorFallback(code,"การปิดร้าน");
}

function errorTarget(code:string):WorkspaceTabTarget|null{
  if(code==="close_day_pending_payments")return "orders";
  if(code==="close_day_open_orders")return "queue";
  if(code==="close_day_pending_stock_count_approval")return "stock";
  if(code==="accounting_reconciliation_failed")return "status";
  return null;
}

function blockerTarget(blocker:CloseDayDeviceBlocker):WorkspaceTabTarget|null{
  if(blocker.route==="/orders")return "orders";
  if(blocker.route==="/stock")return "stock";
  if(blocker.route==="/expenses")return "expense";
  return null;
}

export default function WorkspaceCloseDay({
  session,businessDate,shift,online,onGoToTab,onClosed,onReturnToPos
}:{
  session:Session;
  businessDate:string;
  shift:Shift;
  online:boolean;
  onGoToTab:(tab:WorkspaceTabTarget)=>void;
  onClosed:()=>void|Promise<void>;
  onReturnToPos:()=>void;
}){
  const [firstCount,setFirstCount]=useState("");
  const [secondCount,setSecondCount]=useState("");
  const [review,setReview]=useState<Review|null>(null);
  const [varianceReason,setVarianceReason]=useState("");
  const [confirmVariance,setConfirmVariance]=useState(false);
  const [pending,setPending]=useState<CloseDayWriteIntent|null>(null);
  const [recoveryBlocked,setRecoveryBlocked]=useState(false);
  const [preflight,setPreflight]=useState<CloseDayDevicePreflight|null>(null);
  const [checking,setChecking]=useState(false);
  const [busy,setBusy]=useState(false);
  const [feedback,setFeedback]=useState("");
  const [resolutionTab,setResolutionTab]=useState<WorkspaceTabTarget|null>(null);
  const recoveryRef=useRef(false);

  async function refreshPreflight(){
    if(!businessDate){
      const blocked:CloseDayDevicePreflight={
        ok:false,checkedAt:Date.now(),businessDate:"",
        blockers:[{kind:"storage_unreadable",title:"ยังยืนยันวันทำการไม่ได้",detail:"รีเฟรชงานร้านก่อนตรวจหรือปิดร้าน"}]
      };
      setPreflight(blocked);return blocked;
    }
    setChecking(true);
    try{
      const result=await readCloseDayDevicePreflight(session.user.id,businessDate);
      setPreflight(result);return result;
    }finally{setChecking(false)}
  }

  function requestPath(body:CloseDayWriteBody){
    return body.operation==="review"?"/api/close-day/review":"/api/close-day";
  }

  async function submitIntent(intent:CloseDayWriteIntent,recovery=false){
    if(recoveryRef.current)return false;
    recoveryRef.current=true;setBusy(true);setFeedback("");setResolutionTab(null);
    try{
      const result=await sendCloseDayWriteIntent(intent,body=>api<any>(requestPath(body),{
        method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)
      }));
      setPending(null);setRecoveryBlocked(false);
      if(intent.body.operation==="review"){
        setReview(result.review);setVarianceReason("");setConfirmVariance(false);
        const variance=Number(result.review?.variance||0);
        setFeedback((recovery?"ตรวจรายการเดิมสำเร็จ · ":"")+(variance===0?"เงินสดตรงพอดี · พร้อมยืนยันปิดร้าน":result.review?.summary||"พบส่วนต่าง · ตรวจเหตุผลก่อนปิดร้าน"));
      }else{
        const variance=Number(result.close?.cashVariance||0);
        setFeedback((recovery?"ตรวจผลการปิดร้านเดิมสำเร็จ · ":"")+"ปิดร้านสำเร็จ · เงินสด "+(variance===0?"ตรงพอดี":variance>0?"เกิน ฿"+money(variance):"ขาด ฿"+money(Math.abs(variance))));
        setFirstCount("");setSecondCount("");setReview(null);setVarianceReason("");setConfirmVariance(false);
        await onClosed();
      }
      await refreshPreflight().catch(()=>{});
      return true;
    }catch(error:any){
      try{setPending(readCloseDayWriteIntent(session.user.id));setRecoveryBlocked(false)}
      catch{setRecoveryBlocked(true)}
      if(error?.message==="cash_recount_mismatch"){setSecondCount("");setReview(null)}
      if(["close_day_review_expired","close_day_review_stale","close_day_review_count_changed"].includes(String(error?.message||"")))setReview(null);
      setResolutionTab(errorTarget(String(error?.message||"")));
      setFeedback(errorText(String(error?.message||"")));
      await refreshPreflight().catch(()=>{});
      return false;
    }finally{recoveryRef.current=false;setBusy(false)}
  }

  async function recover(){
    if(session.user.role!=="admin"||recoveryRef.current)return;
    let intent:CloseDayWriteIntent|null=null;
    try{intent=readCloseDayWriteIntent(session.user.id);setRecoveryBlocked(false)}
    catch{setRecoveryBlocked(true);setFeedback(errorText("close_day_recovery_unavailable"));return}
    setPending(intent);
    if(!intent)return;
    if(!online){setFeedback("มีรายการปิดร้านเดิมรอตรวจ · ตอนออฟไลน์ระบบจะไม่สร้างรายการใหม่");return}
    await submitIntent(intent,true);
  }

  useEffect(()=>{
    refreshPreflight().catch(()=>{});
    recover().catch(()=>{});
  },[businessDate,session.user.id]);

  useEffect(()=>{
    const onlineHandler=()=>recover().catch(()=>{});
    const focusHandler=()=>recover().catch(()=>{});
    const visible=()=>{if(document.visibilityState==="visible")recover().catch(()=>{})};
    window.addEventListener("online",onlineHandler);
    window.addEventListener("focus",focusHandler);
    document.addEventListener("visibilitychange",visible);
    return()=>{
      window.removeEventListener("online",onlineHandler);
      window.removeEventListener("focus",focusHandler);
      document.removeEventListener("visibilitychange",visible);
    };
  },[online,session.user.id,session.csrf]);

  async function reviewCash(){
    if(!online||busy)return;
    if(recoveryBlocked){setFeedback(errorText("close_day_recovery_unavailable"));return}
    let existing:CloseDayWriteIntent|null=null;
    try{existing=readCloseDayWriteIntent(session.user.id)}
    catch{setRecoveryBlocked(true);setFeedback(errorText("close_day_recovery_unavailable"));return}
    if(existing){setPending(existing);await submitIntent(existing,true);return}
    const first=Number(firstCount),second=Number(secondCount);
    if(!shift||shift.status!=="open"){setFeedback("ต้องเปิดร้านวันนี้ก่อนจึงจะปิดร้านได้");return}
    if(!firstCount.trim()||!Number.isFinite(first)||first<0){setFeedback("กรุณากรอกยอดนับรอบที่ 1");return}
    if(!secondCount.trim()||!Number.isFinite(second)||second<0){setFeedback("กรุณากรอกยอดนับรอบที่ 2");return}
    const local=await refreshPreflight();
    if(!local.ok){setReview(null);setFeedback("ยังตรวจปิดร้านไม่ได้ · มีรายการค้างในเครื่องนี้ กรุณาจัดการรายการด้านล่างก่อน");return}
    setReview(null);setVarianceReason("");setConfirmVariance(false);setResolutionTab(null);
    try{
      const intent=prepareCloseDayWriteIntent(session.user.id,{
        requestKey:crypto.randomUUID(),operation:"review",date:businessDate,firstCount:first,secondCount:second
      });
      setPending(intent);await submitIntent(intent,false);
    }catch(error:any){
      setFeedback(errorText(String(error?.message||"")));
      if(error?.message==="close_day_recovery_unavailable")setRecoveryBlocked(true);
    }
  }

  async function closeDay(){
    if(!online||busy)return;
    if(recoveryBlocked){setFeedback(errorText("close_day_recovery_unavailable"));return}
    let existing:CloseDayWriteIntent|null=null;
    try{existing=readCloseDayWriteIntent(session.user.id)}
    catch{setRecoveryBlocked(true);setFeedback(errorText("close_day_recovery_unavailable"));return}
    if(existing){setPending(existing);await submitIntent(existing,true);return}
    if(!review){setFeedback("กรุณานับเงิน 2 รอบและให้ระบบตรวจสอบก่อนปิดร้าน");return}
    if(review.variance!==0&&varianceReason.trim().length<2){setFeedback("เงินขาด/เกินต้องระบุเหตุผลก่อนปิดร้าน");return}
    if(review.ownerConfirmRequired&&!confirmVariance){setFeedback("ส่วนต่างสูง · กรุณาติ๊กยืนยันโดยเจ้าของร้าน");return}
    const local=await refreshPreflight();
    if(!local.ok){setFeedback("ยังปิดร้านไม่ได้ · พบรายการค้างใหม่ในเครื่อง กรุณาจัดการก่อน");return}
    if(!window.confirm("ยืนยันปิดร้านวันนี้? "+(review.variance===0?"เงินสดตรงพอดี":review.summary||"พบส่วนต่างเงินสด")))return;
    const finalLocal=await refreshPreflight();
    if(!finalLocal.ok){setReview(null);setFeedback("ยกเลิกการปิดร้าน · พบรายการค้างใหม่หลังยืนยัน กรุณาจัดการแล้วนับใหม่");return}
    try{
      const intent=prepareCloseDayWriteIntent(session.user.id,{
        requestKey:crypto.randomUUID(),operation:"close",date:businessDate,
        openingCash:Number(shift?.openingCash||0),countedCash:Number(review.countedCash),
        reviewId:review.id,varianceReason:varianceReason.trim(),confirmVariance
      });
      setPending(intent);await submitIntent(intent,false);
    }catch(error:any){
      setFeedback(errorText(String(error?.message||"")));
      if(error?.message==="close_day_recovery_unavailable")setRecoveryBlocked(true);
    }
  }

  if(!shift)return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><b>ยังไม่ได้เปิดร้านวันนี้</b><p className="mt-1 text-xs">เปิดร้านจากการ์ดด้านบนก่อน ระบบจึงจะเริ่มขั้นตอนปิดร้านได้</p></div>;
  if(shift.status==="closed")return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><div className="flex items-center gap-2"><CheckCircle2 size={18}/><b>วันนี้ปิดร้านเรียบร้อยแล้ว</b></div><p className="mt-1 text-xs">วันทำการนี้ถูกล็อกแล้ว · รอวันทำการถัดไปก่อนรับออเดอร์ใหม่</p></div>;

  const locked=!!pending||recoveryBlocked;
  const reasonRequired=!!review&&Number(review.variance)!==0;
  const canClose=!!review&&(!reasonRequired||varianceReason.trim().length>=2)&&(!review.ownerConfirmRequired||confirmVariance)&&!locked&&online;
  const blockers=preflight?.blockers||[];

  return <div className="space-y-3">
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div><b className="text-base">ปิดร้านวันนี้</b><p className="mt-1 text-xs leading-5 text-slate-600">นับเงินสด 2 รอบโดยไม่ดูยอดระบบก่อน · ระบบจะแสดงยอดที่ควรมีหลังตรวจครบเท่านั้น</p></div>
        <button type="button" disabled={checking||busy||!online} onClick={()=>refreshPreflight()} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white disabled:opacity-40" aria-label="ตรวจรายการค้างก่อนปิดร้าน"><RefreshCw size={16} className={checking?"animate-spin":""}/></button>
      </div>
    </div>

    {(pending||recoveryBlocked)&&<div role="status" aria-live="polite" className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
      <b>{recoveryBlocked?"ระบบป้องกันการปิดร้านซ้ำใช้งานไม่ได้":"มีการตรวจหรือปิดร้านเดิมรอยืนยัน"}</b>
      <p className="mt-1">{recoveryBlocked?"ห้ามสร้างรายการใหม่จนกว่าจะอ่านข้อมูลเดิมได้":"ไม่ต้องเริ่มใหม่ · ระบบจะใช้คำสั่งเดิมจนกว่าจะรู้ผล"}</p>
      {pending&&<button type="button" disabled={busy||!online} onClick={()=>recover()} className="mt-2 min-h-11 rounded-xl bg-amber-900 px-4 font-bold text-white disabled:opacity-40">ตรวจรายการเดิม</button>}
    </div>}

    {blockers.length>0&&<div className="rounded-2xl border-2 border-red-200 bg-red-50 p-3">
      <div className="flex items-center gap-2 text-red-900"><AlertTriangle size={17}/><b className="text-sm">ยังมีรายการค้างในเครื่องนี้</b></div>
      <div className="mt-2 space-y-2">{blockers.map((blocker,index)=>{
        const target=blockerTarget(blocker);
        return <div key={blocker.kind+":"+index} className="rounded-xl bg-white p-3 text-xs text-slate-700">
          <b>{blocker.title}</b><p className="mt-1 leading-5 text-slate-500">{blocker.detail}</p>
          {target&&<button type="button" onClick={()=>onGoToTab(target)} className="mt-2 min-h-11 rounded-xl border border-slate-300 px-3 font-bold">แก้ในงานร้าน</button>}
          {blocker.route==="/pos"&&<button type="button" onClick={onReturnToPos} className="mt-2 min-h-11 rounded-xl border border-slate-300 px-3 font-bold">กลับหน้า POS เพื่อตรวจ</button>}
        </div>;
      })}</div>
    </div>}

    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-[10px] font-black tracking-[.12em] text-slate-500">นับเงินสดแบบไม่ดูยอดระบบ</p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs text-slate-600">รอบที่ 1<input aria-label="เงินสดที่นับได้รอบที่ 1" inputMode="decimal" disabled={locked||busy} value={firstCount} onChange={e=>{setFirstCount(e.target.value);setReview(null)}} placeholder="กรอกยอดที่นับได้" className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base font-bold disabled:bg-slate-100"/></label>
        <label className="text-xs text-slate-600">รอบที่ 2<input aria-label="เงินสดที่นับได้รอบที่ 2" inputMode="decimal" disabled={locked||busy} value={secondCount} onChange={e=>{setSecondCount(e.target.value);setReview(null)}} placeholder="นับใหม่แล้วกรอกอีกครั้ง" className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base font-bold disabled:bg-slate-100"/></label>
      </div>
      <button type="button" disabled={locked||busy||!online||!firstCount.trim()||!secondCount.trim()||preflight?.ok===false} onClick={reviewCash} className="mt-3 min-h-12 w-full rounded-xl bg-[#d4af37] text-sm font-black text-black disabled:opacity-40">{busy?"กำลังตรวจ…":"ตรวจยอดก่อนปิดร้าน"}</button>
      <p className="mt-2 text-[10px] text-slate-500">ระบบไม่แสดง Expected Cash ก่อนตรวจ เพื่อป้องกันการนับตามตัวเลขในระบบ</p>
    </div>

    {review&&<div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Metric label="ควรมี" value={"฿"+money(review.expectedCash)}/>
        <Metric label="นับได้" value={"฿"+money(review.countedCash)}/>
        <Metric label="ส่วนต่าง" value={(review.variance>0?"+":"")+"฿"+money(review.variance)}/>
      </div>
      <div className={"mt-3 rounded-xl p-3 text-xs "+(review.variance===0?"bg-emerald-50 text-emerald-800":"bg-amber-50 text-amber-900")}><b>{review.variance===0?"เงินสดตรงพอดี":"พบส่วนต่างเงินสด"}</b><p className="mt-1">{review.summary||"ตรวจเหตุผลก่อนยืนยัน"}</p></div>
      {reasonRequired&&<textarea aria-label="เหตุผลเงินสดขาดหรือเกิน" value={varianceReason} onChange={e=>setVarianceReason(e.target.value)} maxLength={240} placeholder="ระบุเหตุผล เช่น เงินทอนผิด / เติมเงินระหว่างวัน" className="mt-3 min-h-20 w-full rounded-xl border border-slate-300 p-3 text-sm"/>}
      {review.ownerConfirmRequired&&<label className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800"><input type="checkbox" checked={confirmVariance} onChange={e=>setConfirmVariance(e.target.checked)} className="mt-0.5 h-4 w-4"/><span>ฉันเป็นเจ้าของร้านและตรวจส่วนต่างจำนวนสูงนี้แล้ว</span></label>}
      <button type="button" disabled={!canClose||busy} onClick={closeDay} className="mt-3 min-h-12 w-full rounded-xl bg-[#1F4D3A] text-sm font-black text-white disabled:opacity-40">ยืนยันปิดร้านวันนี้</button>
    </div>}

    {feedback&&<div role="status" aria-live="polite" className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <b>{feedback}</b>
      {resolutionTab&&<button type="button" onClick={()=>onGoToTab(resolutionTab)} className="mt-2 min-h-11 rounded-xl border border-amber-300 bg-white px-3 font-bold text-slate-800">ไปแก้ในงานร้าน</button>}
    </div>}
  </div>;
}

function Metric({label,value}:{label:string;value:string}){return <div className="rounded-xl bg-slate-50 p-2"><b className="block text-sm sm:text-base">{value}</b><span className="text-[10px] text-slate-500">{label}</span></div>}
