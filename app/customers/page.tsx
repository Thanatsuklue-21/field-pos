"use client";
import {formatMoney} from "@/lib/money-format.mjs";
import {useEffect,useMemo,useRef,useState} from "react";
import {Plus,Search,X} from "lucide-react";
import AuthGate from "@/components/auth-gate";
import ModalFocus from "@/components/modal-focus";
import {api,type Session} from "@/lib/api-client";
import {operatorErrorFallback} from "@/lib/operator-error-language.mjs";
import {prepareCustomerPointsIntent,readCustomerPointsIntent,sendCustomerPointsIntent,type CustomerPointsIntent} from "@/lib/customer-points-recovery";
import {prepareCustomerCreateIntent,readCustomerCreateIntent,sendCustomerCreateIntent,type CustomerCreateIntent} from "@/lib/customer-create-recovery";

type C={id:string;name:string;phone:string;lineId:string;points:number;visits:number;totalSpend:number;lastVisit:number};

export default function Customers(){return <AuthGate>{s=><View session={s}/>}</AuthGate>}

function View({session}:{session:Session}){
  const [rows,setRows]=useState<C[]>([]),[q,setQ]=useState(""),[open,setOpen]=useState(false),[name,setName]=useState(""),[phone,setPhone]=useState(""),[lineId,setLineId]=useState("");
  const [msg,setMsg]=useState(""),[busyCustomer,setBusyCustomer]=useState(""),[pendingPoints,setPendingPoints]=useState<CustomerPointsIntent|null>(null),[pointsRecoveryBlocked,setPointsRecoveryBlocked]=useState(false);
  const [pendingCustomerCreate,setPendingCustomerCreate]=useState<CustomerCreateIntent|null>(null),[customerCreateRecoveryBlocked,setCustomerCreateRecoveryBlocked]=useState(false),[creatingCustomer,setCreatingCustomer]=useState(false);
  const recoveryRef=useRef(false),createRecoveryRef=useRef(false);
  const load=()=>api<{customers:C[]}>("/api/customers").then(x=>setRows(x.customers||[]));
  useEffect(()=>{load().catch(()=>{})},[]);
  const list=useMemo(()=>rows.filter(x=>(x.name+" "+x.phone+" "+x.lineId).toLowerCase().includes(q.toLowerCase())),[rows,q]);

  function pointsError(code:string){
    const map:Record<string,string>={
      customer_not_found:"ไม่พบลูกค้ารายนี้ · กรุณารีเฟรชข้อมูล",
      invalid_points:"จำนวนแต้มไม่ถูกต้อง",
      invalid_request_key:"ระบบสร้างรหัสป้องกันรายการซ้ำไม่สำเร็จ",
      invalid_customer_points_request:"ข้อมูลลูกค้าของรายการเดิมไม่ตรงกัน · ระบบหยุดเพื่อป้องกันการปรับแต้มผิดคน",
      pending_customer_points_exists:"มีการปรับแต้มก่อนหน้าที่ยังไม่ทราบผล · ต้องตรวจรายการเดิมก่อน",
      customer_points_ack_unknown:"ระบบกลางยังยืนยันการปรับแต้มเดิมไม่ครบ · ระบบเก็บรายการเดิมไว้ ห้ามกดบวก/ลบซ้ำ",
      customer_points_recovery_unavailable:"อ่านหรือบันทึกข้อมูลป้องกันแต้มซ้ำไม่ได้ · ระบบหยุดปรับแต้มชั่วคราว",
      network_unavailable:"การเชื่อมต่อขาดระหว่างปรับแต้ม · ยังไม่ทราบผล ระบบเก็บรายการเดิมไว้และจะตรวจซ้ำ",
      offline_write_blocked:"ออฟไลน์อยู่ · ระบบเก็บรายการเดิมไว้และจะตรวจเมื่อเชื่อมต่อ"
    };
    return map[code]||operatorErrorFallback(code,"แต้มลูกค้า");
  }

  function createError(code:string){
    const map:Record<string,string>={
      invalid_customer:"กรุณากรอกชื่อลูกค้า",
      customer_phone_exists:"เบอร์นี้มีลูกค้าอยู่แล้ว · ค้นหาเบอร์เดิมก่อนสร้างใหม่",
      invalid_request_key:"ระบบสร้างรหัสป้องกันลูกค้าซ้ำไม่สำเร็จ",
      pending_customer_create_exists:"มีการเพิ่มลูกค้าก่อนหน้าที่ยังไม่ทราบผล · ต้องตรวจรายการเดิมก่อน",
      customer_create_ack_unknown:"Server ยังยืนยันลูกค้าที่สร้างก่อนหน้าไม่ครบ · ระบบเก็บ Request เดิมไว้ ห้ามสร้างลูกค้าใหม่แทน",
      customer_create_recovery_unavailable:"อ่าน/บันทึกข้อมูลป้องกันลูกค้าซ้ำไม่ได้ · ระบบหยุดเพิ่มลูกค้าใหม่ชั่วคราว",
      request_key_conflict:"Request เดิมถูกผูกกับข้อมูลหรือผู้ใช้อื่น · หยุดสร้างลูกค้าใหม่และตรวจรายการเดิม",
      network_unavailable:"การเชื่อมต่อขาดระหว่างเพิ่มลูกค้า · ยังไม่ทราบผล ระบบเก็บรายการเดิมไว้และจะตรวจซ้ำ",
      offline_write_blocked:"ออฟไลน์อยู่ · ระบบเก็บรายการเดิมไว้และจะตรวจเมื่อเชื่อมต่อ"
    };
    return map[code]||operatorErrorFallback(code,"เพิ่มลูกค้า");
  }

  async function submitPointsIntent(intent:CustomerPointsIntent,recovery=false){
    if(recoveryRef.current)return;
    recoveryRef.current=true;setBusyCustomer(intent.body.customerId);setMsg("");
    try{
      const result=await sendCustomerPointsIntent(intent,body=>api<any>("/api/customers/"+encodeURIComponent(body.customerId),{
        method:"PATCH",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)
      }));
      setPendingPoints(null);setPointsRecoveryBlocked(false);
      setMsg((recovery?"ตรวจรายการปรับแต้มเดิมแล้ว · ":"")+"แต้มลูกค้าถูกปรับ "+(intent.body.pointsDelta>0?"+":"")+intent.body.pointsDelta+" แต้ม");
      await load();
    }catch(error:any){
      try{setPendingPoints(readCustomerPointsIntent(session.user.id));setPointsRecoveryBlocked(false)}
      catch{setPointsRecoveryBlocked(true)}
      setMsg(pointsError(error?.message||"customer_points_ack_unknown"));
      await load().catch(()=>{});
    }finally{recoveryRef.current=false;setBusyCustomer("")}
  }

  async function recoverPoints(){
    if(recoveryRef.current)return;
    let intent:CustomerPointsIntent|null=null;
    try{intent=readCustomerPointsIntent(session.user.id);setPendingPoints(intent);setPointsRecoveryBlocked(false)}
    catch{setPointsRecoveryBlocked(true);setMsg(pointsError("customer_points_recovery_unavailable"));return}
    if(!intent)return;
    if(typeof navigator!=="undefined"&&!navigator.onLine){setMsg("มีการปรับแต้มเดิมรอตรวจ · ไม่ต้องกดซ้ำ เมื่อออนไลน์ระบบจะตรวจรายการเดิม");return}
    await submitPointsIntent(intent,true);
  }

  useEffect(()=>{
    let disposed=false;
    const recover=()=>{if(!disposed)recoverPoints().catch(()=>{})};
    const visible=()=>{if(document.visibilityState==="visible")recover()};
    recover();
    window.addEventListener("online",recover);window.addEventListener("focus",recover);document.addEventListener("visibilitychange",visible);
    return()=>{disposed=true;window.removeEventListener("online",recover);window.removeEventListener("focus",recover);document.removeEventListener("visibilitychange",visible)};
  },[session.user.id,session.csrf]);

  async function submitCustomerCreate(intent:CustomerCreateIntent,recovery=false){
    if(createRecoveryRef.current)return;
    createRecoveryRef.current=true;setCreatingCustomer(true);setMsg("");
    try{
      const result=await sendCustomerCreateIntent(intent,body=>api<any>("/api/customers",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)}));
      setPendingCustomerCreate(null);setCustomerCreateRecoveryBlocked(false);setOpen(false);setName("");setPhone("");setLineId("");
      setMsg((recovery?"ตรวจรายการเพิ่มลูกค้าเดิมแล้ว · ":"")+"เพิ่มลูกค้าแล้ว · "+String(result.customer?.name||intent.body.name));
      await load().catch(()=>{});
    }catch(error:any){
      try{setPendingCustomerCreate(readCustomerCreateIntent(session.user.id));setCustomerCreateRecoveryBlocked(false)}
      catch{setCustomerCreateRecoveryBlocked(true)}
      setMsg(createError(error?.message||"customer_create_ack_unknown"));
    }finally{createRecoveryRef.current=false;setCreatingCustomer(false)}
  }

  async function recoverCustomerCreate(){
    if(createRecoveryRef.current)return;
    let intent:CustomerCreateIntent|null=null;
    try{intent=readCustomerCreateIntent(session.user.id);setPendingCustomerCreate(intent);setCustomerCreateRecoveryBlocked(false)}
    catch{setCustomerCreateRecoveryBlocked(true);setMsg(createError("customer_create_recovery_unavailable"));return}
    if(!intent)return;
    setOpen(true);setName(intent.body.name);setPhone(intent.body.phone);setLineId(intent.body.lineId);
    if(typeof navigator!=="undefined"&&!navigator.onLine){setMsg("มีการเพิ่มลูกค้าเดิมรอตรวจ · ห้ามสร้างซ้ำ เมื่อออนไลน์ระบบจะตรวจ Request เดิม");return}
    await submitCustomerCreate(intent,true);
  }

  useEffect(()=>{
    let disposed=false;
    const recover=()=>{if(!disposed)recoverCustomerCreate().catch(()=>{})};
    const visible=()=>{if(document.visibilityState==="visible")recover()};
    recover();
    window.addEventListener("online",recover);window.addEventListener("focus",recover);document.addEventListener("visibilitychange",visible);
    return()=>{disposed=true;window.removeEventListener("online",recover);window.removeEventListener("focus",recover);document.removeEventListener("visibilitychange",visible)};
  },[session.user.id,session.csrf]);

  async function add(){
    if(customerCreateRecoveryBlocked){setMsg(createError("customer_create_recovery_unavailable"));return}
    let existing:CustomerCreateIntent|null=null;
    try{existing=readCustomerCreateIntent(session.user.id)}
    catch{setCustomerCreateRecoveryBlocked(true);setMsg(createError("customer_create_recovery_unavailable"));return}
    if(existing){setPendingCustomerCreate(existing);await submitCustomerCreate(existing,true);return}
    try{
      const body={requestKey:crypto.randomUUID(),name:name.trim(),phone:phone.trim(),lineId:lineId.trim()};
      const intent=prepareCustomerCreateIntent(session.user.id,body);
      setPendingCustomerCreate(intent);
      await submitCustomerCreate(intent,false);
    }catch(error:any){
      setMsg(createError(error?.message||"customer_create_recovery_unavailable"));
      if(error?.message==="customer_create_recovery_unavailable")setCustomerCreateRecoveryBlocked(true);
    }
  }

  async function points(id:string,delta:number){
    if(pointsRecoveryBlocked){setMsg(pointsError("customer_points_recovery_unavailable"));return}
    let existing:CustomerPointsIntent|null=null;
    try{existing=readCustomerPointsIntent(session.user.id)}
    catch{setPointsRecoveryBlocked(true);setMsg(pointsError("customer_points_recovery_unavailable"));return}
    if(existing){setPendingPoints(existing);await submitPointsIntent(existing,true);return}
    try{
      const intent=prepareCustomerPointsIntent(session.user.id,{requestKey:crypto.randomUUID(),customerId:id,pointsDelta:delta});
      setPendingPoints(intent);
      await submitPointsIntent(intent,false);
    }catch(error:any){setMsg(pointsError(error?.message||"customer_points_recovery_unavailable"))}
  }

  const pointsLocked=!!pendingPoints||pointsRecoveryBlocked||!!busyCustomer;
  return <section className="flex h-full flex-col p-3 sm:p-5 md:p-7">
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="gold m-0 text-[10px] font-bold tracking-[.3em]">LOYALTY</p><h1 className="mt-1 text-2xl font-semibold">ลูกค้า / แต้มสะสม</h1><p className="mt-1 text-xs text-slate-500">การเพิ่มหรือลดแต้มทุกครั้งมีรหัสกันรายการซ้ำ · หากเน็ตหลุดให้ตรวจรายการเดิม ไม่ต้องกดซ้ำ</p></div><button disabled={creatingCustomer||!!pendingCustomerCreate||customerCreateRecoveryBlocked} onClick={()=>setOpen(true)} className="flex min-h-11 items-center gap-2 rounded-full bg-[#d4af37] px-4 text-sm font-bold text-black disabled:opacity-40"><Plus size={16}/>เพิ่มลูกค้า</button></header>

    {(pendingCustomerCreate||customerCreateRecoveryBlocked)&&<div role="status" aria-live="polite" aria-atomic="true" className="mb-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"><div className="flex flex-wrap items-center justify-between gap-2"><div><b>{customerCreateRecoveryBlocked?"ระบบป้องกันลูกค้าซ้ำใช้งานไม่ได้":"มีการเพิ่มลูกค้าเดิมรอยืนยัน"}</b><p className="mt-1">{customerCreateRecoveryBlocked?"ระบบหยุดเพิ่มลูกค้าใหม่จนกว่าจะอ่าน recovery storage ได้":"ห้ามสร้างลูกค้าใหม่แทน · ระบบจะใช้ Request เดิมจนกว่าจะรู้ผลแน่ชัด"}</p></div>{pendingCustomerCreate&&<button disabled={creatingCustomer} onClick={()=>recoverCustomerCreate()} className="min-h-11 rounded-xl bg-amber-900 px-4 font-bold text-white disabled:opacity-40">ตรวจลูกค้าเดิม</button>}</div></div>}
    {(pendingPoints||pointsRecoveryBlocked)&&<div role="status" aria-live="polite" aria-atomic="true" className="mb-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"><div className="flex flex-wrap items-center justify-between gap-2"><div><b>{pointsRecoveryBlocked?"ระบบป้องกันแต้มซ้ำใช้งานไม่ได้":"มีการปรับแต้มเดิมรอยืนยัน"}</b><p className="mt-1">{pointsRecoveryBlocked?"ระบบหยุดปุ่มแต้มชั่วคราวจนกว่าจะอ่าน recovery storage ได้":"ห้ามกด +/− ซ้ำ · ระบบจะส่ง request เดิมจนกว่าจะรู้ผลแน่ชัด"}</p></div>{pendingPoints&&<button disabled={!!busyCustomer} onClick={()=>recoverPoints()} className="min-h-11 rounded-xl bg-amber-900 px-4 font-bold text-white disabled:opacity-40">ตรวจรายการเดิม</button>}</div></div>}
    {msg&&<div className="mb-3 rounded-2xl border border-slate-200 bg-white p-3 text-sm">{msg}</div>}
    <div className="glass mb-4 flex min-h-12 items-center gap-3 rounded-full px-4"><Search size={17} className="text-slate-500"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="ค้นหาชื่อ / เบอร์ / LINE" className="w-full bg-transparent outline-none"/></div>
    <div className="soft-scroll min-h-0 flex-1 overflow-auto"><div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">{list.map(x=><div key={x.id} className="glass card p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><b>{x.name}</b><p className="mt-1 text-xs text-slate-500">{x.phone||"ไม่มีเบอร์"} · {x.lineId||"ไม่มี LINE"}</p></div>{busyCustomer===x.id&&<span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-800">กำลังตรวจ…</span>}</div><div className="mt-5 grid grid-cols-3 gap-2 text-center"><div><small className="text-slate-500">Points</small><div className="gold text-xl">{x.points||0}</div></div><div><small className="text-slate-500">Visits</small><div className="text-xl">{x.visits||0}</div></div><div><small className="text-slate-500">Spend</small><div className="text-xl">฿{formatMoney(Number(x.totalSpend||0))}</div></div></div><div className="mt-4 grid grid-cols-2 gap-2"><button disabled={pointsLocked} onClick={()=>points(x.id,1)} className="min-h-11 rounded-full border border-emerald-300 bg-emerald-50 text-xs font-bold text-emerald-800 disabled:opacity-40">+1 แต้ม</button><button disabled={pointsLocked||Number(x.points||0)<=0} onClick={()=>points(x.id,-1)} className="min-h-11 rounded-full border border-red-200 bg-red-50 text-xs font-bold text-red-700 disabled:opacity-40">−1 แต้ม</button></div></div>)}</div></div>

    {open&&<div className="field-modal-overlay fixed inset-0 z-[80] grid place-items-center bg-black/45 p-4"><ModalFocus labelId="customer-create-title" onEscape={creatingCustomer||!!pendingCustomerCreate?undefined:()=>setOpen(false)} initialFocusSelector='[aria-label="ชื่อลูกค้า"]' className="field-modal-panel glass card w-full max-w-md bg-white p-5 sm:p-6"><div className="flex justify-between gap-3"><h3 id="customer-create-title" className="text-xl">เพิ่มลูกค้า</h3><button disabled={creatingCustomer||!!pendingCustomerCreate} aria-label="ปิดหน้าต่างเพิ่มลูกค้า" onClick={()=>setOpen(false)} className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 disabled:opacity-40"><X/></button></div>{(pendingCustomerCreate||customerCreateRecoveryBlocked)&&<div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"><b>{customerCreateRecoveryBlocked?"สร้างลูกค้าใหม่ไม่ได้ชั่วคราว":"รายการนี้กำลังรอการยืนยันผล"}</b><p className="mt-1">ข้อมูลถูกล็อกเพื่อป้องกัน Customer ID ซ้ำ</p>{pendingCustomerCreate&&<button disabled={creatingCustomer} onClick={()=>recoverCustomerCreate()} className="mt-2 min-h-11 rounded-xl bg-amber-900 px-4 font-bold text-white disabled:opacity-40">ตรวจรายการเดิม</button>}</div>}<fieldset disabled={creatingCustomer||!!pendingCustomerCreate||customerCreateRecoveryBlocked} className="mt-5 grid gap-3 disabled:opacity-70"><input aria-label="ชื่อลูกค้า" value={name} onChange={e=>setName(e.target.value)} placeholder="ชื่อ" className="min-h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4"/><input aria-label="เบอร์โทรลูกค้า" inputMode="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="เบอร์โทร" className="min-h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4"/><input aria-label="LINE ID ลูกค้า" value={lineId} onChange={e=>setLineId(e.target.value)} placeholder="LINE ID" className="min-h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4"/><button disabled={!name.trim()} onClick={add} className="min-h-12 rounded-full bg-[#d4af37] font-bold text-black disabled:opacity-40">{creatingCustomer?"กำลังตรวจ…":"บันทึกลูกค้า"}</button></fieldset></ModalFocus></div>}
  </section>
}
