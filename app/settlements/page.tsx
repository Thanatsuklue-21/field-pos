"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {CheckCircle2,RefreshCw,RotateCcw,TriangleAlert,X} from "lucide-react";
import AuthGate from "@/components/auth-gate";
import ModalFocus from "@/components/modal-focus";
import {api,type Session} from "@/lib/api-client";
import {operatorErrorFallback} from "@/lib/operator-error-language.mjs";
import {prepareSettlementWriteIntent,readSettlementWriteIntent,sendSettlementWriteIntent,type SettlementWriteBody,type SettlementWriteIntent} from "@/lib/settlement-write-recovery";

type Pending={key:string;saleDate:string;platform:string;gross:number;gpFees:number;expectedAmount:number;orders:number;saleIds:string[]};
type Rec={id:string;saleDate:string;platform:string;orders:number;gross:number;gpFees:number;expectedAmount:number;receivedAmount:number;receivedDate:string;variance:number;status:"matched"|"variance";note?:string;createdAt:number;createdBy:string;cancelledAt?:number;cancelReason?:string};
type Data={revision:number;pending:Pending[];history:Rec[];summary:{records:number;matched:number;variance:number;expected:number;received:number;netVariance:number}};
const today=()=>new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Bangkok"});
const platformLabel=(v:string)=>v==="grab"?"Grab":v==="lineman"?"LINE MAN":"Delivery อื่น";
const money=(v:number)=>Number(v||0).toLocaleString("th-TH",{minimumFractionDigits:0,maximumFractionDigits:2});

export default function Settlements(){return <AuthGate>{s=><View session={s}/>}</AuthGate>}
function View({session}:{session:Session}){
  const [data,setData]=useState<Data|null>(null),[selected,setSelected]=useState<Pending|null>(null),[received,setReceived]=useState(""),[receivedDate,setReceivedDate]=useState(today()),[note,setNote]=useState(""),[busy,setBusy]=useState(false),[msg,setMsg]=useState("");
  const [pendingSettlementIntent,setPendingSettlementIntent]=useState<SettlementWriteIntent|null>(null),[settlementRecoveryBlocked,setSettlementRecoveryBlocked]=useState(false);
  const settlementRecoveryRef=useRef(false);
  const load=()=>api<Data>("/api/accounting/settlements").then(setData);
  useEffect(()=>{load().catch((e:any)=>setMsg(operatorErrorFallback(e?.message||"load_failed","ข้อมูลกระทบยอด")))},[]);
  const pendingTotal=useMemo(()=>(data?.pending||[]).reduce((s,x)=>s+x.expectedAmount,0),[data]);
  function open(row:Pending){
    if(pendingSettlementIntent||settlementRecoveryBlocked){setMsg(settlementError(settlementRecoveryBlocked?"settlement_recovery_unavailable":"pending_settlement_write_exists"));return}
    setSelected(row);setReceived(String(row.expectedAmount));setReceivedDate(today());setNote("");setMsg("");
  }

  function settlementError(code:string){
    const map:Record<string,string>={
      invalid_request_key:"ระบบสร้างรหัสป้องกันรายการซ้ำไม่สำเร็จ",
      invalid_received_amount:"ยอดรับจริงไม่ถูกต้อง",
      invalid_settlement_date:"วันที่ไม่ถูกต้อง",
      invalid_delivery_platform:"แพลตฟอร์ม Delivery ไม่ถูกต้อง",
      delivery_settlement_group_not_found:"ยอดชุดนี้ถูกกระทบไปแล้ว · กรุณาตรวจ Request เดิมหรือรีเฟรช",
      settlement_cancel_reason_required:"กรุณาระบุเหตุผลยกเลิก",
      settlement_not_found:"ไม่พบ reconciliation นี้แล้ว · กรุณารีเฟรช",
      settlement_already_cancelled:"รายการนี้ถูกยกเลิกแล้ว · กรุณาตรวจประวัติ",
      pending_settlement_write_exists:"มีรายการกระทบยอดก่อนหน้าที่ยังไม่ทราบผล · ต้องตรวจ Request เดิมก่อน",
      settlement_ack_unknown:"Server ยังยืนยันรายการกระทบยอดเดิมไม่ครบ · ระบบเก็บ Request เดิมไว้ ห้ามบันทึกใหม่แทน",
      settlement_recovery_unavailable:"อ่าน/บันทึก recovery การกระทบยอดไม่ได้ · ระบบหยุดการเขียน Accounting ชั่วคราว",
      request_key_conflict:"Request เดิมถูกผูกกับข้อมูลหรือผู้ใช้อื่น · หยุดรายการใหม่และตรวจ Audit/Accounting",
      network_unavailable:"การเชื่อมต่อขาดระหว่างกระทบยอด · ยังไม่ทราบผล ระบบเก็บ Request เดิมไว้และจะตรวจซ้ำ",
      offline_write_blocked:"ออฟไลน์อยู่ · ระบบเก็บ Request เดิมไว้และจะตรวจเมื่อเชื่อมต่อ"
    };
    return map[code]||operatorErrorFallback(code,"การกระทบยอด"))
  }

  function settlementRequest(body:SettlementWriteBody){
    return body.operation==="reconcile"?"/api/accounting/settlements":"/api/accounting/settlements/"+encodeURIComponent(body.settlementId)+"/cancel";
  }

  async function submitSettlementIntent(intent:SettlementWriteIntent,recovery=false){
    if(settlementRecoveryRef.current)return null;
    settlementRecoveryRef.current=true;setBusy(true);setMsg("");
    try{
      const result=await sendSettlementWriteIntent(intent,body=>api<any>(settlementRequest(body),{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)}));
      setPendingSettlementIntent(null);setSettlementRecoveryBlocked(false);
      if(intent.body.operation==="reconcile"){
        const v=Number(result.reconciliation?.variance||0);
        setSelected(null);
        setMsg((recovery?"ตรวจ Request เดิมแล้ว · ":"")+(v===0?"กระทบยอดตรงพอดี":"บันทึกแล้ว · ส่วนต่าง "+(v>0?"+":"")+"฿"+money(v)));
      }else setMsg((recovery?"ตรวจ Request เดิมแล้ว · ":"")+"ยกเลิก reconciliation แล้ว");
      await load().catch(()=>{});
      return result;
    }catch(e:any){
      try{setPendingSettlementIntent(readSettlementWriteIntent(session.user.id));setSettlementRecoveryBlocked(false)}
      catch{setSettlementRecoveryBlocked(true)}
      setMsg(settlementError(e?.message||"settlement_ack_unknown"));
      await load().catch(()=>{});
      return null;
    }finally{settlementRecoveryRef.current=false;setBusy(false)}
  }

  async function recoverSettlementWrite(){
    if(settlementRecoveryRef.current)return;
    let intent:SettlementWriteIntent|null=null;
    try{intent=readSettlementWriteIntent(session.user.id);setPendingSettlementIntent(intent);setSettlementRecoveryBlocked(false)}
    catch{setSettlementRecoveryBlocked(true);setMsg(settlementError("settlement_recovery_unavailable"));return}
    if(!intent)return;
    if(typeof navigator!=="undefined"&&!navigator.onLine){setMsg("มีรายการกระทบยอดเดิมรอตรวจ · ห้ามบันทึกหรือลบรายการใหม่ เมื่อออนไลน์ระบบจะตรวจ Request เดิม");return}
    await submitSettlementIntent(intent,true);
  }

  useEffect(()=>{
    if(session.user.role!=="admin")return;
    let disposed=false;
    const recover=()=>{if(!disposed)recoverSettlementWrite().catch(()=>{})};
    const visible=()=>{if(document.visibilityState==="visible")recover()};
    recover();
    window.addEventListener("online",recover);window.addEventListener("focus",recover);document.addEventListener("visibilitychange",visible);
    return()=>{disposed=true;window.removeEventListener("online",recover);window.removeEventListener("focus",recover);document.removeEventListener("visibilitychange",visible)};
  },[session.user.id,session.csrf,session.user.role]);
  async function save(){
    if(!selected)return;
    if(settlementRecoveryBlocked){setMsg(settlementError("settlement_recovery_unavailable"));return}
    let existing:SettlementWriteIntent|null=null;
    try{existing=readSettlementWriteIntent(session.user.id)}
    catch{setSettlementRecoveryBlocked(true);setMsg(settlementError("settlement_recovery_unavailable"));return}
    if(existing){setPendingSettlementIntent(existing);await submitSettlementIntent(existing,true);return}
    try{
      const intent=prepareSettlementWriteIntent(session.user.id,{requestKey:crypto.randomUUID(),operation:"reconcile",saleDate:selected.saleDate,platform:selected.platform,receivedAmount:Number(received),receivedDate,note});
      setPendingSettlementIntent(intent);
      await submitSettlementIntent(intent,false);
    }catch(e:any){setMsg(settlementError(e?.message||"settlement_recovery_unavailable"));if(e?.message==="settlement_recovery_unavailable")setSettlementRecoveryBlocked(true)}
  }
  async function cancel(row:Rec){
    if(session.user.role!=="admin"||row.cancelledAt)return;
    if(settlementRecoveryBlocked){setMsg(settlementError("settlement_recovery_unavailable"));return}
    let existing:SettlementWriteIntent|null=null;
    try{existing=readSettlementWriteIntent(session.user.id)}
    catch{setSettlementRecoveryBlocked(true);setMsg(settlementError("settlement_recovery_unavailable"));return}
    if(existing){setPendingSettlementIntent(existing);await submitSettlementIntent(existing,true);return}
    const reason=window.prompt("เหตุผลที่ยกเลิกการกระทบยอด\nเช่น กรอกยอดรับจริงผิด","");
    if(!reason?.trim())return;
    if(!window.confirm("ยกเลิก reconciliation นี้?\nยอดชุดนี้จะกลับไปอยู่ในรายการรอกระทบยอด"))return;
    try{
      const intent=prepareSettlementWriteIntent(session.user.id,{requestKey:crypto.randomUUID(),operation:"cancel",settlementId:row.id,reason:reason.trim()});
      setPendingSettlementIntent(intent);
      await submitSettlementIntent(intent,false);
    }catch(e:any){setMsg(settlementError(e?.message||"settlement_recovery_unavailable"));if(e?.message==="settlement_recovery_unavailable")setSettlementRecoveryBlocked(true)}
  }

  return <section className="soft-scroll h-full overflow-auto p-3 sm:p-5 md:p-7">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="gold m-0 text-[10px] font-bold tracking-[.25em]">ACCOUNTING CONTROL</p><h1 className="mt-1 text-xl font-semibold sm:text-2xl">DELIVERY SETTLEMENTS</h1><p className="mt-1 text-xs text-slate-500">ยอดที่แพลตฟอร์มควรโอน → เงินเข้าเงินจริง → ส่วนต่าง</p></div><button onClick={()=>load()} className="grid h-11 w-11 place-items-center rounded-full border border-slate-300 bg-white" title="Refresh"><RefreshCw size={16}/></button></header>
    {(pendingSettlementIntent||settlementRecoveryBlocked)&&<div role="status" aria-live="polite" aria-atomic="true" className="mt-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"><div className="flex flex-wrap items-center justify-between gap-2"><div><b>{settlementRecoveryBlocked?"ระบบป้องกัน Accounting ซ้ำใช้งานไม่ได้":"มีรายการกระทบยอดเดิมรอยืนยัน"}</b><p className="mt-1">{settlementRecoveryBlocked?"ระบบหยุด Reconcile/Cancel จนกว่าจะอ่าน recovery storage ได้":"ห้ามบันทึกหรือยกเลิกด้วย Request ใหม่ · ระบบจะใช้ Request เดิมจนกว่าจะรู้ผลแน่ชัด"}</p></div>{pendingSettlementIntent&&<button disabled={busy} onClick={()=>recoverSettlementWrite()} className="min-h-11 rounded-xl bg-amber-900 px-4 font-bold text-white disabled:opacity-40">ตรวจ Request เดิม</button>}</div></div>}
    {msg&&<div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 text-sm">{msg}</div>}

    <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4"><div className="glass card p-4"><small className="text-slate-500">รอรับเงิน</small><b className="mt-1 block text-xl text-[#765b08]">฿{money(pendingTotal)}</b><small>{data?.pending.length||0} ชุด</small></div><div className="glass card p-4"><small className="text-slate-500">กระทบยอดแล้ว</small><b className="mt-1 block text-xl">{data?.summary.records||0}</b><small>รายการ</small></div><div className="glass card p-4"><small className="text-slate-500">ตรงพอดี</small><b className="mt-1 block text-xl text-emerald-700">{data?.summary.matched||0}</b></div><div className="glass card p-4"><small className="text-slate-500">ส่วนต่างสุทธิ</small><b className={"mt-1 block text-xl "+(Number(data?.summary.netVariance||0)===0?"text-emerald-700":"text-amber-700")}>{Number(data?.summary.netVariance||0)>0?"+":""}฿{money(data?.summary.netVariance||0)}</b></div></div>

    <div className="mt-4 grid gap-3 xl:grid-cols-[1.15fr_.85fr]">
      <div className="glass card p-3 sm:p-4"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">รอกระทบยอด</h2><p className="text-xs text-slate-500">รวมตามวันขายและแพลตฟอร์ม</p></div><span className="rounded-full bg-amber-100 px-3 py-1 text-[10px] font-bold text-amber-800">{data?.pending.length||0} PENDING</span></div><div className="mt-3 space-y-2">{(data?.pending||[]).map(x=><article key={x.key} className="rounded-2xl border bg-white p-3"><div className="flex items-start justify-between gap-3"><div><b>{platformLabel(x.platform)}</b><p className="text-xs text-slate-500">{x.saleDate} · {x.orders} orders</p></div><div className="text-right"><small className="text-slate-500">ควรได้รับ</small><b className="block text-lg text-[#765b08]">฿{money(x.expectedAmount)}</b></div></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-xl bg-slate-50 p-2">ยอดขายเต็ม <b className="float-right">฿{money(x.gross)}</b></div><div className="rounded-xl bg-red-50 p-2 text-red-700">GP <b className="float-right">−฿{money(x.gpFees)}</b></div></div>{session.user.role==="admin"&&<button disabled={busy||!!pendingSettlementIntent||settlementRecoveryBlocked} onClick={()=>open(x)} className="mt-3 min-h-11 w-full rounded-2xl bg-[#d4af37] text-sm font-bold text-black">บันทึกเงินเข้า / กระทบยอด</button>}</article>)}{data&&data.pending.length===0&&<div className="py-10 text-center text-sm text-slate-500"><CheckCircle2 className="mx-auto mb-2 text-emerald-600"/>ไม่มี Delivery ที่รอกระทบยอด</div>}</div></div>

      <div className="glass card p-3 sm:p-4"><h2 className="text-sm font-semibold">ประวัติกระทบยอด</h2><div className="soft-scroll mt-3 max-h-[560px] space-y-2 overflow-auto">{(data?.history||[]).map(r=><article key={r.id} className={"rounded-2xl border p-3 "+(r.cancelledAt?"bg-slate-100 opacity-70":"bg-white")}><div className="flex items-start justify-between gap-2"><div><b className="text-sm">{platformLabel(r.platform)}</b><p className="text-[11px] text-slate-500">ขาย {r.saleDate} · เงินเข้า {r.receivedDate}</p></div>{r.cancelledAt?<span className="rounded-full bg-slate-200 px-2 py-1 text-[9px] font-bold">CANCELLED</span>:r.status==="matched"?<span className="rounded-full bg-emerald-100 px-2 py-1 text-[9px] font-bold text-emerald-700">MATCHED</span>:<span className="rounded-full bg-amber-100 px-2 py-1 text-[9px] font-bold text-amber-800">VARIANCE</span>}</div><div className="mt-2 grid grid-cols-3 gap-1 text-center text-[10px]"><div className="rounded-xl bg-slate-50 p-2">ควรได้<b className="block text-xs">฿{money(r.expectedAmount)}</b></div><div className="rounded-xl bg-slate-50 p-2">รับจริง<b className="block text-xs">฿{money(r.receivedAmount)}</b></div><div className="rounded-xl bg-slate-50 p-2">ต่าง<b className={"block text-xs "+(r.variance===0?"text-emerald-700":"text-amber-700")}>{r.variance>0?"+":""}฿{money(r.variance)}</b></div></div>{r.note&&<p className="mt-2 text-xs text-slate-600">{r.note}</p>}{r.cancelReason&&<p className="mt-2 text-xs text-red-600">ยกเลิก: {r.cancelReason}</p>}{session.user.role==="admin"&&!r.cancelledAt&&<button disabled={busy||!!pendingSettlementIntent||settlementRecoveryBlocked} onClick={()=>cancel(r)} className="mt-2 flex min-h-10 w-full items-center justify-center gap-1 rounded-xl border border-slate-200 text-xs text-slate-600"><RotateCcw size={13}/>ยกเลิก reconciliation</button>}</article>)}{data&&data.history.length===0&&<p className="py-8 text-center text-sm text-slate-500">ยังไม่มีประวัติ</p>}</div></div>
    </div>

    {selected&&<div className="field-modal-overlay fixed inset-0 z-[80] grid place-items-center bg-black/70"><ModalFocus labelId="settlement-reconcile-title" onEscape={busy||!!pendingSettlementIntent?undefined:()=>setSelected(null)} className="field-modal-panel glass card soft-scroll w-full max-w-md overflow-auto p-5"><div className="flex items-start justify-between"><div><p className="gold text-[10px] tracking-[.25em]">RECONCILE</p><h3 id="settlement-reconcile-title" className="mt-1 text-lg">{platformLabel(selected.platform)} · {selected.saleDate}</h3></div><button disabled={busy||!!pendingSettlementIntent} aria-label="ปิดการกระทบยอด" onClick={()=>setSelected(null)} className="grid h-11 w-11 place-items-center rounded-xl disabled:opacity-40"><X/></button></div><fieldset disabled={!!pendingSettlementIntent||settlementRecoveryBlocked} className="disabled:opacity-70"><div className="mt-4 rounded-2xl bg-slate-50 p-3"><div className="flex justify-between text-sm"><span>ยอดขายเต็ม</span><b>฿{money(selected.gross)}</b></div><div className="mt-1 flex justify-between text-sm text-red-600"><span>GP</span><b>−฿{money(selected.gpFees)}</b></div><div className="mt-2 flex justify-between border-t pt-2"><b>ควรได้รับ</b><b className="text-xl text-[#765b08]">฿{money(selected.expectedAmount)}</b></div></div><label className="mt-4 block text-xs text-slate-500">ยอดเงินที่เข้าจริง<input autoFocus inputMode="decimal" value={received} onChange={e=>setReceived(e.target.value)} className="mt-1 w-full rounded-2xl border bg-white px-4 py-3 text-lg font-semibold"/></label><label className="mt-3 block text-xs text-slate-500">วันที่เงินเข้า<input type="date" value={receivedDate} onChange={e=>setReceivedDate(e.target.value)} className="mt-1 w-full rounded-2xl border bg-white px-4 py-3"/></label><label className="mt-3 block text-xs text-slate-500">หมายเหตุ<input value={note} onChange={e=>setNote(e.target.value)} placeholder="เลขอ้างอิง / หมายเหตุธนาคาร" className="mt-1 w-full rounded-2xl border bg-white px-4 py-3"/></label>{Number.isFinite(Number(received))&&<div className={"mt-3 flex items-center gap-2 rounded-2xl p-3 text-sm "+(Math.abs(Number(received)-selected.expectedAmount)<.01?"bg-emerald-50 text-emerald-800":"bg-amber-50 text-amber-800")}>{Math.abs(Number(received)-selected.expectedAmount)<.01?<CheckCircle2 size={16}/>:<TriangleAlert size={16}/>}ส่วนต่าง {Number(received)-selected.expectedAmount>0?"+":""}฿{money(Number(received)-selected.expectedAmount)}</div>}<button disabled={busy||!Number.isFinite(Number(received))||Number(received)<0} onClick={save} className="mt-4 min-h-12 w-full rounded-full bg-[#d4af37] font-bold text-black disabled:opacity-40">{busy?"กำลังบันทึก...":"ยืนยันเงินเข้าและกระทบยอด"}</button></fieldset></ModalFocus></div>}
  </section>
}
