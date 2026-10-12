"use client";
import {formatMoney} from "@/lib/money-format.mjs";
import {useEffect,useMemo,useRef,useState} from "react";
import {Plus,Search,X} from "lucide-react";
import AuthGate from "@/components/auth-gate";
import {api,type Session} from "@/lib/api-client";
import {CRM_POINTS_PENDING_KEY,shouldRetainCrmPointsPending,validateCrmPointsAck,validatePendingCrmPoints} from "@/lib/crm-points-recovery.mjs";

type C={id:string;name:string;phone:string;lineId:string;points:number;visits:number;totalSpend:number;lastVisit:number};
type PointsBody={requestKey:string;expectedPoints:number;pointsSet:number};
type PendingPoints={customerId:string;body:PointsBody;createdAt:number};

function pendingRead():PendingPoints|null{
  let raw:string|null=null;
  try{raw=localStorage.getItem(CRM_POINTS_PENDING_KEY)}catch{throw new Error("crm_points_recovery_storage_unavailable")}
  if(!raw)return null;
  try{return validatePendingCrmPoints(JSON.parse(raw)) as PendingPoints}catch{throw new Error("crm_points_recovery_corrupt")}
}
function pendingWrite(pending:PendingPoints){
  try{localStorage.setItem(CRM_POINTS_PENDING_KEY,JSON.stringify(pending))}
  catch{throw new Error("crm_points_recovery_storage_unavailable")}
}
function pendingClear(){
  try{localStorage.removeItem(CRM_POINTS_PENDING_KEY)}
  catch{throw new Error("crm_points_recovery_storage_unavailable")}
}

export default function Customers(){return <AuthGate>{s=><View session={s}/>}</AuthGate>}

function View({session}:{session:Session}){
  const [rows,setRows]=useState<C[]>([]);
  const [q,setQ]=useState("");
  const [open,setOpen]=useState(false);
  const [name,setName]=useState("");
  const [phone,setPhone]=useState("");
  const [lineId,setLineId]=useState("");
  const [busyPoints,setBusyPoints]=useState(false);
  const [msg,setMsg]=useState("");
  const recoveryRef=useRef(false);
  const load=()=>api<{customers:C[]}>("/api/customers").then(x=>setRows(x.customers));
  const list=useMemo(()=>rows.filter(x=>(x.name+" "+x.phone+" "+x.lineId).toLowerCase().includes(q.toLowerCase())),[rows,q]);

  function pointError(code:string){
    const map:Record<string,string>={
      points_conflict:"แต้มลูกค้าถูกเปลี่ยนจากรายการอื่นแล้ว · รีเฟรชข้อมูลก่อนปรับใหม่",
      request_key_conflict:"Request แต้มเดิมไม่ตรงกับข้อมูลเดิม · ระบบหยุดเพื่อป้องกันแต้มซ้ำ",
      points_update_requires_cas:"หน้าจอนี้เป็นเวอร์ชันเก่า · กรุณารีเฟรชแอปก่อนปรับแต้ม",
      crm_points_pending:"มีการปรับแต้มเดิมที่ยังไม่ทราบผล · ระบบจะตรวจ request เดิมก่อน",
      crm_points_unconfirmed:"Server ยังไม่ยืนยันการปรับแต้มเดิมครบถ้วน · ระบบเก็บ request เดิมไว้",
      crm_points_recovery_corrupt:"ข้อมูล recovery แต้มในเครื่องเสีย · ห้ามปรับแต้มใหม่จนกว่าจะตรวจสอบ",
      crm_points_recovery_storage_unavailable:"เครื่องนี้เก็บ recovery แต้มไม่ได้ · ระบบไม่ส่งรายการเพื่อป้องกันแต้มซ้ำ"
    };
    return map[code]||code;
  }

  async function sendPoints(pending:PendingPoints){
    const existing=pendingRead();
    if(existing&&existing.body.requestKey!==pending.body.requestKey)throw Object.assign(new Error("crm_points_pending"),{status:409});
    if(!existing)pendingWrite(pending);
    const exact=existing||pending;
    try{
      const r=await api<any>("/api/customers/"+encodeURIComponent(exact.customerId),{
        method:"PATCH",
        headers:{"X-CSRF-Token":session.csrf},
        body:JSON.stringify(exact.body)
      });
      validateCrmPointsAck(r,exact);
      pendingClear();
      return r;
    }catch(e:any){
      if(!shouldRetainCrmPointsPending(e))pendingClear();
      throw e;
    }
  }

  useEffect(()=>{
    load().catch(()=>{});
    let disposed=false;
    const recover=async()=>{
      if(disposed||recoveryRef.current||session.offline)return;
      let pending:PendingPoints|null=null;
      try{pending=pendingRead()}catch(e:any){if(!disposed)setMsg(pointError(e.message));return}
      if(!pending)return;
      recoveryRef.current=true;setBusyPoints(true);setMsg("");
      try{
        await sendPoints(pending);
        if(!disposed){setMsg("กู้คืนการปรับแต้มเดิมสำเร็จ · ไม่บวก/ลบซ้ำ");await load().catch(()=>{})}
      }catch(e:any){
        if(!disposed){
          setMsg(shouldRetainCrmPointsPending(e)?"การปรับแต้มเดิมยังไม่ทราบผล · ระบบเก็บ request เดิมไว้และจะตรวจซ้ำ":pointError(e.message));
          await load().catch(()=>{});
        }
      }finally{
        recoveryRef.current=false;
        if(!disposed)setBusyPoints(false);
      }
    };
    const onOnline=()=>recover(),onFocus=()=>recover(),onVisible=()=>{if(document.visibilityState==="visible")recover()};
    recover();
    window.addEventListener("online",onOnline);
    window.addEventListener("focus",onFocus);
    document.addEventListener("visibilitychange",onVisible);
    return()=>{disposed=true;window.removeEventListener("online",onOnline);window.removeEventListener("focus",onFocus);document.removeEventListener("visibilitychange",onVisible)};
  },[session.csrf,session.offline]);

  async function add(){
    await api("/api/customers",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({name,phone,lineId})});
    setOpen(false);setName("");setPhone("");setLineId("");await load();
  }

  async function points(customer:C,delta:number){
    const expected=Math.max(0,Math.trunc(Number(customer.points||0)));
    const target=Math.max(0,expected+Math.trunc(delta));
    if(target===expected)return;
    const pending:PendingPoints={customerId:customer.id,body:{requestKey:crypto.randomUUID(),expectedPoints:expected,pointsSet:target},createdAt:Date.now()};
    setBusyPoints(true);setMsg("");
    try{
      await sendPoints(pending);
      setMsg("ปรับแต้มแล้ว "+expected+" → "+target);
      await load();
    }catch(e:any){
      setMsg(shouldRetainCrmPointsPending(e)?"การปรับแต้มยังไม่ทราบผล · ระบบเก็บ request เดิมไว้เพื่อป้องกันแต้มซ้ำ":pointError(e.message));
      await load().catch(()=>{});
    }finally{setBusyPoints(false)}
  }

  return <section className="flex h-full flex-col p-5 md:p-7">
    <header className="mb-5 flex items-end justify-between"><div><p className="gold m-0 text-[10px] font-bold tracking-[.3em]">LOYALTY</p><h1 className="mt-1 text-2xl font-semibold">CUSTOMERS</h1></div><button onClick={()=>setOpen(true)} className="flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black"><Plus size={16}/>ADD</button></header>
    {msg&&<div className="mb-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm">{msg}</div>}
    <div className="glass mb-4 flex items-center gap-3 rounded-full px-4 py-3"><Search size={17} className="text-slate-500"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="ค้นหาชื่อ / เบอร์ / LINE" className="w-full bg-transparent outline-none"/></div>
    <div className="soft-scroll min-h-0 flex-1 overflow-auto"><div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">{list.map(x=><div key={x.id} className="glass card p-5"><b>{x.name}</b><p className="mt-1 text-xs text-slate-500">{x.phone||"ไม่มีเบอร์"} · {x.lineId||"ไม่มี LINE"}</p><div className="mt-5 grid grid-cols-3 gap-2 text-center"><div><small className="text-slate-500">Points</small><div className="gold text-xl">{x.points||0}</div></div><div><small className="text-slate-500">Visits</small><div className="text-xl">{x.visits||0}</div></div><div><small className="text-slate-500">Spend</small><div className="text-xl">฿{formatMoney(Number(x.totalSpend||0))}</div></div></div><div className="mt-4 flex gap-2"><button disabled={busyPoints} onClick={()=>points(x,1)} className="flex-1 rounded-full border border-slate-200 py-2 text-xs disabled:opacity-40">+1 Point</button><button disabled={busyPoints||Number(x.points||0)<=0} onClick={()=>points(x,-1)} className="flex-1 rounded-full border border-slate-200 py-2 text-xs disabled:opacity-40">-1 Point</button></div></div>)}</div></div>
    {open&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"><div className="glass card w-full max-w-md p-6"><div className="flex justify-between"><h3 className="text-xl">เพิ่มลูกค้า</h3><button onClick={()=>setOpen(false)}><X/></button></div><div className="mt-5 grid gap-3"><input value={name} onChange={e=>setName(e.target.value)} placeholder="ชื่อ" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"/><input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="เบอร์โทร" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"/><input value={lineId} onChange={e=>setLineId(e.target.value)} placeholder="LINE ID" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"/><button disabled={!name.trim()} onClick={add} className="rounded-full bg-[#d4af37] py-3 font-bold text-black disabled:opacity-40">SAVE</button></div></div></div>}
  </section>
}
