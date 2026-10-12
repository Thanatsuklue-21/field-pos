"use client";
import {formatMoney} from "@/lib/money-format.mjs";
import {useEffect,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import AuthGate from "@/components/auth-gate";
import {api,type Session} from "@/lib/api-client";
import {getOfflineCashSummary,type OfflineCashSummary} from "@/lib/offline-sales";
import {CASH_MOVEMENT_PENDING_KEY,shouldRetainCashMovementPending,validateCashMovementAck,validatePendingCashMovement} from "@/lib/cash-movement-recovery.mjs";

type Close={id:string;date:string;revenue:number;cogs:number;expenses:number;purchaseSpend?:number;totalCashOut?:number;grossProfit:number;operatingProfit:number;deliveryFees?:number;cash:number;promptpay:number;bank?:number;card?:number;other:number;openingCash?:number;cashIn?:number;cashPaidOut?:number;cashOut?:number;expectedCash?:number;countedCash?:number;cashVariance?:number;orders:number;cups:number;time:number};
type Shift={id:string;date:string;status:"open"|"closed";openingCash:number;openedAt:number;openedBy:string;closedAt?:number;cashVariance?:number};
type Movement={id:string;requestKey?:string;shiftId:string;date:string;type:"CASH_IN"|"CASH_OUT";amount:number;reason:string;time:number;createdBy:string};
type CashMovementBody={requestKey:string;type:"CASH_IN"|"CASH_OUT";amount:number;reason:string};
type PendingCashMovement={body:CashMovementBody;createdAt:number};
type PaymentBlocker={id:string;status:"collecting"|"requires_resolution";mode:string;total:number;pager:number;createdAt:number;expiresAt:number;chargeId:string;provider:string;providerStatus:string;payments:number};
type OrderBlocker={id:string;queueNo:string;pagerNo:number;status:string;time:number;cups:number;ready:number;called:number;remainingPrep:number;remainingHandoff:number;items:{name:string;qty:number;readyQty:number;calledQty:number}[]};
type CloseData={closes:Close[];shift:Shift|null;businessDate:string;cashMovements:Movement[];paymentBlockers?:PaymentBlocker[];orderBlockers?:OrderBlocker[];closeBlockedByPayments?:boolean;closeBlockedByOrders?:boolean};

function cashMovementPendingRead():PendingCashMovement|null{
  let raw:string|null=null;
  try{raw=localStorage.getItem(CASH_MOVEMENT_PENDING_KEY)}catch{throw new Error("cash_movement_recovery_storage_unavailable")}
  if(!raw)return null;
  try{return validatePendingCashMovement(JSON.parse(raw)) as PendingCashMovement}catch{throw new Error("cash_movement_recovery_corrupt")}
}
function cashMovementPendingWrite(body:CashMovementBody){
  try{localStorage.setItem(CASH_MOVEMENT_PENDING_KEY,JSON.stringify({body,createdAt:Date.now()}))}
  catch{throw new Error("cash_movement_recovery_storage_unavailable")}
}
function cashMovementPendingClear(){
  try{localStorage.removeItem(CASH_MOVEMENT_PENDING_KEY)}
  catch{throw new Error("cash_movement_recovery_storage_unavailable")}
}

export default function CloseDay(){return <AuthGate>{s=><View session={s}/>}</AuthGate>}

function View({session}:{session:Session}){
  const router=useRouter();
  const [rows,setRows]=useState<Close[]>([]),[shift,setShift]=useState<Shift|null>(null),[businessDate,setBusinessDate]=useState(""),[movements,setMovements]=useState<Movement[]>([]),[paymentBlockers,setPaymentBlockers]=useState<PaymentBlocker[]>([]),[orderBlockers,setOrderBlockers]=useState<OrderBlocker[]>([]),[offlineOutbox,setOfflineOutbox]=useState<OfflineCashSummary|null>(null),[offlineOutboxError,setOfflineOutboxError]=useState(false),[msg,setMsg]=useState(""),[busy,setBusy]=useState(false),[openingCash,setOpeningCash]=useState("0"),[countedCash,setCountedCash]=useState(""),[movementType,setMovementType]=useState<"CASH_IN"|"CASH_OUT">("CASH_OUT"),[movementAmount,setMovementAmount]=useState(""),[movementReason,setMovementReason]=useState("");
  const movementRecoveryRef=useRef(false);
  const load=()=>api<CloseData>("/api/close-day").then(x=>{setRows(x.closes||[]);setShift(x.shift||null);setBusinessDate(x.businessDate||"");setMovements(x.cashMovements||[]);setPaymentBlockers(Array.isArray(x.paymentBlockers)?x.paymentBlockers:[]);setOrderBlockers(Array.isArray(x.orderBlockers)?x.orderBlockers:[]) });
  const refreshOfflineOutbox=async()=>{
    try{
      const summary=await getOfflineCashSummary();
      setOfflineOutbox(summary);setOfflineOutboxError(false);
      return summary;
    }catch{
      setOfflineOutbox(null);setOfflineOutboxError(true);
      throw new Error("offline_outbox_unavailable");
    }
  };
  useEffect(()=>{load().catch(()=>{});refreshOfflineOutbox().catch(()=>{})},[]);

  function movementError(code:string){
    return code==="drawer_cash_shortage"?"เงินสดตามระบบไม่พอสำหรับนำออกจำนวนนี้":
      code==="cash_shift_not_open"?"ต้องเปิดร้านก่อนบันทึกเงินเข้า/ออก":
      code==="day_already_closed"?"วันนี้ถูกปิดวันแล้ว":
      code==="cash_movement_pending"?"มีรายการเงินสดเข้า/ออกเดิมที่ยังไม่ทราบผล · ระบบจะตรวจ request เดิมก่อน":
      code==="cash_movement_unconfirmed"?"Server ยังไม่ยืนยันรายการเงินสดเดิมครบถ้วน · ระบบเก็บ request เดิมไว้เพื่อป้องกันยอดซ้ำ":
      code==="cash_movement_recovery_corrupt"?"ข้อมูล recovery เงินสดในเครื่องเสีย · ห้ามบันทึกรายการใหม่จนกว่าจะตรวจสอบ":
      code==="cash_movement_recovery_storage_unavailable"?"เครื่องนี้เก็บ recovery เงินสดไม่ได้ · ระบบไม่ส่งรายการเพื่อป้องกันยอดซ้ำ":
      code;
  }

  async function sendCashMovement(body:CashMovementBody){
    let pending=cashMovementPendingRead();
    if(pending&&pending.body.requestKey!==body.requestKey)throw Object.assign(new Error("cash_movement_pending"),{status:409});
    if(!pending){cashMovementPendingWrite(body);pending={body,createdAt:Date.now()}}
    try{
      const r=await api<any>("/api/cash-shift/movements",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(pending.body)});
      validateCashMovementAck(r,pending.body);
      cashMovementPendingClear();
      return r;
    }catch(e:any){
      if(!shouldRetainCashMovementPending(e))cashMovementPendingClear();
      throw e;
    }
  }

  useEffect(()=>{
    let disposed=false;
    const recover=async()=>{
      if(disposed||movementRecoveryRef.current||session.offline)return;
      let pending:PendingCashMovement|null=null;
      try{pending=cashMovementPendingRead()}catch(e:any){if(!disposed)setMsg(movementError(e.message));return}
      if(!pending)return;
      movementRecoveryRef.current=true;setBusy(true);setMsg("");
      try{
        await sendCashMovement(pending.body);
        if(!disposed){
          setMovementAmount("");setMovementReason("");
          setMsg("กู้คืนรายการเงินสดเข้า/ออกเดิมสำเร็จ · ใช้ request key เดิมและไม่บันทึกซ้ำ");
          await load().catch(()=>{});
        }
      }catch(e:any){
        if(!disposed){
          setMsg(shouldRetainCashMovementPending(e)?"รายการเงินสดเดิมยังไม่ทราบผล · ระบบเก็บ request เดิมไว้และจะตรวจซ้ำเมื่อเชื่อมต่อ":movementError(e.message));
          await load().catch(()=>{});
        }
      }finally{
        movementRecoveryRef.current=false;
        if(!disposed)setBusy(false);
      }
    };
    const onOnline=()=>recover(),onFocus=()=>recover(),onVisible=()=>{if(document.visibilityState==="visible")recover()};
    recover();
    window.addEventListener("online",onOnline);
    window.addEventListener("focus",onFocus);
    document.addEventListener("visibilitychange",onVisible);
    return()=>{disposed=true;window.removeEventListener("online",onOnline);window.removeEventListener("focus",onFocus);document.removeEventListener("visibilitychange",onVisible)};
  },[session.csrf,session.offline]);

  async function openShift(){
    const opening=Number(openingCash||0);
    if(!Number.isFinite(opening)||opening<0){setMsg("เงินตั้งต้นต้องไม่ติดลบ");return}
    if(!window.confirm("ยืนยันเปิดร้านด้วยเงินตั้งต้น ฿"+formatMoney(opening)+" ? หลังเปิดแล้วจำนวนนี้จะถูกล็อกสำหรับการกระทบยอดวันนี้"))return;
    setBusy(true);setMsg("");
    try{const r=await api<any>("/api/cash-shift/open",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({openingCash:opening})});setShift(r.shift);setMsg("เปิดร้านแล้ว · เงินตั้งต้น ฿"+formatMoney(Number(r.shift.openingCash))+" ถูกล็อกแล้ว");await load()}
    catch(e:any){setMsg(e.message==="cash_shift_already_opened"?"วันนี้เปิดร้านไปแล้ว กรุณารีเฟรช":e.message==="day_already_closed"?"วันนี้ถูกปิดวันแล้ว":e.message)}
    finally{setBusy(false)}
  }

  async function addMovement(){
    const amount=Number(movementAmount);
    if(!shift||shift.status!=="open"){setMsg("ต้องเปิดร้านก่อนบันทึกเงินเข้า/ออกลิ้นชัก");return}
    if(!Number.isFinite(amount)||amount<=0){setMsg("กรุณากรอกจำนวนเงินที่ถูกต้อง");return}
    if(movementReason.trim().length<2){setMsg("กรุณาระบุเหตุผล");return}
    setBusy(true);setMsg("");
    const body:CashMovementBody={requestKey:crypto.randomUUID(),type:movementType,amount,reason:movementReason.trim().slice(0,240)};
    try{
      await sendCashMovement(body);
      setMovementAmount("");setMovementReason("");setMsg(movementType==="CASH_IN"?"บันทึกเติมเงินสดเข้าลิ้นชักแล้ว":"บันทึกนำเงินสดออกจากลิ้นชักแล้ว");await load();
    }catch(e:any){setMsg(movementError(e.message))}
    finally{setBusy(false)}
  }

  async function close(){
    const counted=Number(countedCash);
    if(!shift||shift.status!=="open"){setMsg("กรุณาเปิดร้านและล็อกเงินตั้งต้นก่อนปิดวัน");return}
    let outbox:OfflineCashSummary;
    try{outbox=await refreshOfflineOutbox()}catch{
      setMsg("ปิดวันไม่ได้ · ตรวจ Offline outbox ในเครื่องไม่สำเร็จ กรุณาเปิดหน้า POS/ตรวจพื้นที่เก็บข้อมูลก่อน");
      return;
    }
    if(outbox.total>0){
      setMsg("ปิดวันไม่ได้ · มีบิล Offline ในเครื่อง "+outbox.total+" รายการ (รอ Sync "+outbox.pending+" · ต้องตรวจ "+outbox.needsReview+") กรุณาจัดการให้เหลือ 0 ก่อน");
      return;
    }
    if(paymentBlockers.length){setMsg("ยังมี Payment ที่ค้างอยู่ "+paymentBlockers.length+" รายการ · กรุณาตรวจและจัดการก่อนปิดวัน");return}
    if(orderBlockers.length){setMsg("ยังมีออเดอร์ที่ยังไม่ส่งมอบ "+orderBlockers.length+" คิว · กรุณาทำ/เรียก/ส่งมอบให้ครบก่อนปิดวัน");return}
    if(!countedCash.trim()||!Number.isFinite(counted)||counted<0){setMsg("กรุณากรอกเงินสดที่นับได้จริง");return}
    if(!window.confirm("ยืนยันปิดวัน? ระบบจะใช้เงินตั้งต้นที่ล็อกไว้ ฿"+formatMoney(Number(shift.openingCash))+" และคำนวณเงินสดขาด/เกิน"))return;
    setBusy(true);setMsg("");
    try{const r=await api<any>("/api/close-day",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({countedCash:counted})});const v=Number(r.close.cashVariance||0);setMsg("ปิดวันสำเร็จ · เงินสด "+(v===0?"ตรงพอดี":v>0?"เกิน ฿"+formatMoney(v):"ขาด ฿"+formatMoney(Math.abs(v))));setCountedCash("");await load()}
    catch(e:any){setMsg(e.message==="day_already_closed"?"วันนี้ถูกปิดวันแล้ว":e.message==="close_day_pending_payments"?"ยังมี Split/Payment ที่ค้างอยู่ กรุณาจัดการให้เสร็จก่อนปิดวัน":e.message==="close_day_open_orders"?"ยังมีออเดอร์ที่ยังไม่ได้ส่งมอบ กรุณาปิดคิวให้ครบก่อนปิดวัน":e.message==="counted_cash_required"?"กรุณากรอกเงินสดที่นับได้จริง":e.message)}
    finally{setBusy(false)}
  }

  return <section className="soft-scroll h-full overflow-auto p-3 sm:p-5 md:p-7">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="gold m-0 text-[10px] font-bold tracking-[.3em]">DAILY CONTROL</p><h1 className="mt-1 text-xl font-semibold sm:text-2xl">OPEN / CLOSE DAY</h1><p className="mt-1 text-xs text-slate-500">{businessDate||"วันนี้"} · เปิดร้านด้วยเงินทอนตั้งต้น แล้วนับเงินจริงก่อนปิดร้าน</p></div>{session.user.role==="admin"&&<button disabled={busy||!shift||shift.status!=="open"||offlineOutbox===null||offlineOutboxError||offlineOutbox.total>0||paymentBlockers.length>0||orderBlockers.length>0} onClick={close} className="min-h-11 rounded-full bg-[#d4af37] px-5 text-sm font-bold text-black disabled:opacity-40">{busy?"กำลังบันทึก...":offlineOutboxError?"ตรวจ Offline ไม่ได้":offlineOutbox===null?"กำลังตรวจ Offline...":offlineOutbox.total>0?"มีบิล Offline "+offlineOutbox.total+" รายการ":paymentBlockers.length>0?"มี Payment ค้าง "+paymentBlockers.length+" รายการ":orderBlockers.length>0?"มีคิวค้าง "+orderBlockers.length+" คิว":"ปิดร้านวันนี้"}</button>}</header>

    {session.user.role==="admin"&&(offlineOutboxError||offlineOutbox===null||offlineOutbox.total>0)&&<div className="mt-4 rounded-2xl border border-red-300 bg-red-50 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><b className="text-red-900">ปิดวันไม่ได้ · Offline outbox ยังไม่พร้อม</b><p className="mt-1 text-xs text-red-700">{offlineOutboxError?"อ่านข้อมูลบิล Offline ในเครื่องไม่ได้ ต้องแก้ storage/เปิดหน้า POS ให้พร้อมก่อน":offlineOutbox===null?"กำลังตรวจบิล Offline ในเครื่อง…":"รอ Sync "+offlineOutbox.pending+" · ต้องตรวจ "+offlineOutbox.needsReview+" · รวม "+offlineOutbox.total+" รายการ"}</p></div>
        <button onClick={()=>router.push("/pos")} className="min-h-11 rounded-xl bg-red-800 px-4 text-xs font-bold text-white">ไป POS / Sync Offline</button>
      </div>
    </div>}

    {session.user.role==="admin"&&paymentBlockers.length>0&&<div className="mt-4 rounded-2xl border border-red-300 bg-red-50 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><b className="text-red-900">ปิดวันไม่ได้ · มี Payment ค้าง {paymentBlockers.length} รายการ</b><p className="mt-1 text-xs text-red-700">ต้องเคลียร์ collecting / requires_resolution ให้จบก่อน เพื่อไม่ให้ยอดขาย Stock และเงินรับชำระค้างข้ามวัน</p></div>
        <button onClick={()=>router.push("/orders")} className="min-h-11 rounded-xl bg-red-800 px-4 text-xs font-bold text-white">ไป Orders / Payment Resolution</button>
      </div>
      <div className="mt-3 space-y-2">{paymentBlockers.map(p=><div key={p.id} className="rounded-xl border border-red-200 bg-white p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2"><b>{p.id}</b><span className={"rounded-full px-2 py-1 text-[10px] font-black "+(p.status==="requires_resolution"?"bg-red-100 text-red-800":"bg-amber-100 text-amber-800")}>{p.status}</span></div>
        <div className="mt-1 text-slate-600">ยอด ฿{formatMoney(p.total)} · Pager {p.pager||"—"} · {p.mode}</div>
        <div className="mt-1 text-slate-500">Provider {p.provider||"—"} · Charge {p.chargeId||"—"} · Status {p.providerStatus||"—"} · Payments {p.payments}</div>
      </div>)}</div>
    </div>}

    {session.user.role==="admin"&&orderBlockers.length>0&&<div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><b className="text-amber-950">ปิดวันไม่ได้ · มีออเดอร์ค้าง {orderBlockers.length} คิว</b><p className="mt-1 text-xs text-amber-800">ทุกออเดอร์ของวันนี้ต้องทำเสร็จ เรียกลูกค้า และบันทึกส่งมอบก่อนปิดวัน</p></div>
        <button onClick={()=>router.push("/queue")} className="min-h-11 rounded-xl bg-amber-800 px-4 text-xs font-bold text-white">ไปหน้าทำออเดอร์ / คิว</button>
      </div>
      <div className="mt-3 space-y-2">{orderBlockers.map(o=><div key={o.id} className="rounded-xl border border-amber-200 bg-white p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2"><b>คิว {o.queueNo||"—"} · Pager {o.pagerNo||"—"}</b><span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-900">{o.status}</span></div>
        <div className="mt-1 text-slate-600">{o.cups} แก้ว · พร้อม {o.ready}/{o.cups} · เรียกแล้ว {o.called}/{o.cups}</div>
        <div className="mt-1 text-slate-500">{o.remainingPrep>0?"เหลือทำ "+o.remainingPrep+" แก้ว":o.remainingHandoff>0?"ทำครบแล้ว · เหลือเรียก/ส่งมอบ "+o.remainingHandoff+" แก้ว":"รอบันทึกส่งมอบ"}</div>
        <div className="mt-1 text-slate-500">{o.items.map(i=>i.name+" ×"+i.qty).join(" · ")}</div>
      </div>)}</div>
    </div>}

    {session.user.role==="admin"&&<div className="glass card mt-4 p-4 sm:p-5">{!shift?<><div className="flex items-start justify-between gap-3"><div><b>1. เปิดร้าน / เงินทอนตั้งต้น</b><p className="mt-1 text-xs text-slate-500">ใส่เงินทอนตั้งต้นก่อนเริ่มขาย · ร้านทำงานคนเดียวจึงเปิดรอบเงินสดครั้งเดียวต่อวัน</p></div><span className="rounded-full bg-amber-100 px-3 py-1 text-[10px] font-bold text-amber-800">ยังไม่เปิดร้าน</span></div><div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]"><input inputMode="decimal" value={openingCash} onChange={e=>setOpeningCash(e.target.value)} className="min-h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4" placeholder="เงินตั้งต้น เช่น 500"/><button type="button" disabled={busy} onClick={()=>setOpeningCash("0")} className="min-h-12 rounded-2xl border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 disabled:opacity-40">ไม่มีเงินทอน · ฿0</button><button disabled={busy} onClick={openShift} className="min-h-12 rounded-2xl bg-[#d4af37] px-5 font-bold text-black disabled:opacity-40">เปิดร้านวันนี้</button></div></>:<><div className="flex flex-wrap items-start justify-between gap-3"><div><b>{shift.status==="open"?"ร้านเปิดอยู่":"วันนี้ปิดร้านแล้ว"}</b><p className="mt-1 text-xs text-slate-500">เปิดเมื่อ {new Date(shift.openedAt).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})}</p></div><div className="text-right"><small className="text-slate-500">เงินตั้งต้นที่ล็อก</small><div className="text-2xl font-semibold text-[#765b08]">฿{formatMoney(Number(shift.openingCash))}</div></div></div>{shift.status==="open"&&<div className="mt-4 border-t border-slate-200 pt-4"><label className="text-sm"><span className="text-slate-500">2. เงินสดที่นับได้จริงก่อนปิดวัน</span><input inputMode="decimal" value={countedCash} onChange={e=>setCountedCash(e.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" placeholder="จำนวนเงินสดจริง"/></label><p className="mt-2 text-xs text-slate-500">ระบบไม่แสดง Expected Cash ก่อนกดยืนยัน เพื่อให้การนับเป็นอิสระจากยอดในระบบ · Expected Cash = เงินตั้งต้น + ยอดขายเงินสด + เงินเติมเข้า − ค่าใช้จ่ายเงินสด − เงินนำออก</p></div>}</>}</div>}

    {session.user.role==="admin"&&shift?.status==="open"&&<div className="glass card mt-4 p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><b>เงินสดเข้า/ออกลิ้นชักระหว่างวัน</b><p className="mt-1 text-xs text-slate-500">ใช้เฉพาะเงินที่ไม่ใช่ยอดขายและไม่ใช่ค่าใช้จ่าย เช่น เติมเงินทอนเพิ่ม หรือนำเงินสดส่วนเกินออกไปเก็บ</p></div><div className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold text-slate-600">{movements.length} รายการวันนี้</div></div><div className="mt-4 grid gap-2 sm:grid-cols-[140px_1fr_1.5fr_auto]"><select value={movementType} onChange={e=>setMovementType(e.target.value as "CASH_IN"|"CASH_OUT")} className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3"><option value="CASH_OUT">นำเงินออก</option><option value="CASH_IN">เติมเงินเข้า</option></select><input inputMode="decimal" value={movementAmount} onChange={e=>setMovementAmount(e.target.value)} placeholder="จำนวนเงิน" className="min-h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3"/><input value={movementReason} onChange={e=>setMovementReason(e.target.value)} placeholder="เหตุผล เช่น เก็บเงินสดส่วนเกิน / เติมเงินทอน" className="min-h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3"/><button disabled={busy||!(Number(movementAmount)>0)||movementReason.trim().length<2} onClick={addMovement} className="min-h-11 rounded-2xl bg-[#d4af37] px-4 text-sm font-bold text-black disabled:opacity-40">บันทึก</button></div>{movements.length>0&&<div className="mt-4 space-y-2">{movements.map(x=><div key={x.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm"><div><b className={x.type==="CASH_IN"?"text-emerald-700":"text-red-600"}>{x.type==="CASH_IN"?"เติมเข้า":"นำออก"} ฿{formatMoney(x.amount)}</b><div className="text-xs text-slate-500">{x.reason}</div></div><small className="text-slate-400">{new Date(x.time).toLocaleTimeString("th-TH",{timeZone:"Asia/Bangkok",hour:"2-digit",minute:"2-digit"})}</small></div>)}</div>}</div>}

    {msg&&<div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3 text-sm">{msg}</div>}
    <div className="mt-5 grid gap-3">{rows.map(x=><div key={x.id} className="glass card p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><small className="text-slate-500">{x.date}</small><div className="mt-1 text-2xl font-semibold gold">฿{formatMoney(x.revenue)}</div><small className="text-slate-500">{x.orders} orders · {x.cups} cups</small></div><div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4"><div><small className="text-slate-500">Opening Cash</small><div>฿{formatMoney(Number(x.openingCash||0))}</div></div><div><small className="text-slate-500">Cash Sales</small><div>฿{formatMoney(x.cash)}</div></div><div><small className="text-slate-500">Cash In</small><div className="text-emerald-700">+฿{formatMoney(Number(x.cashIn||0))}</div></div><div><small className="text-slate-500">Cash Paid Out</small><div className="text-red-600">−฿{formatMoney(Number(x.cashPaidOut||0))}</div></div><div><small className="text-slate-500">Cash Out</small><div className="text-red-600">−฿{formatMoney(Number(x.cashOut||0))}</div></div><div><small className="text-slate-500">Expected Drawer</small><div>฿{formatMoney(Number(x.expectedCash??x.cash))}</div></div><div><small className="text-slate-500">Counted Cash</small><div>฿{formatMoney(Number(x.countedCash??x.cash))}</div></div><div><small className="text-slate-500">Cash Variance</small><div className={Number(x.cashVariance||0)===0?"text-emerald-700":Number(x.cashVariance||0)>0?"text-amber-700":"text-red-600"}>{Number(x.cashVariance||0)>0?"+":""}฿{formatMoney(Number(x.cashVariance||0))}</div></div><div><small className="text-slate-500">PromptPay</small><div>฿{formatMoney(x.promptpay)}</div></div><div><small className="text-slate-500">โอนธนาคาร</small><div>฿{formatMoney(Number(x.bank||0))}</div></div><div><small className="text-slate-500">บัตร</small><div>฿{formatMoney(Number(x.card||0))}</div></div><div><small className="text-slate-500">COGS</small><div>฿{formatMoney(x.cogs)}</div></div><div><small className="text-slate-500">Operating Expenses</small><div>฿{formatMoney(x.expenses)}</div></div><div><small className="text-slate-500">Purchase Spend</small><div>฿{formatMoney(Number(x.purchaseSpend||0))}</div></div><div><small className="text-slate-500">Gross Profit</small><div>฿{formatMoney(x.grossProfit)}</div></div><div><small className="text-slate-500">GP Delivery</small><div>−฿{formatMoney(Number(x.deliveryFees||0))}</div></div><div><small className="text-slate-500">กำไร / ขาดทุนหลังรายจ่ายและ GP</small><div className={x.operatingProfit>=0?"text-emerald-700":"text-red-600"}>฿{formatMoney(x.operatingProfit)}</div></div></div></div></div>)}</div>
  </section>
}
