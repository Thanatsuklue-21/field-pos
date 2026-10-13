"use client";

import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {Bot,Boxes,ClipboardList,ListOrdered,RefreshCw,ShieldCheck,X} from "lucide-react";
import {api,type Bootstrap,type Session} from "@/lib/api-client";

type WorkspaceTab="queue"|"orders"|"stock"|"status";
type QueueOrder={
  id:string;queueNo:string;pagerNo:number;status:string;time:number;
  items:Array<{name:string;qty:number;readyQty?:number;calledQty?:number}>;
};
type Sale={
  id:string;billNo?:string;date:string;time:number;total:number;payment:string;
  status:string;queueNo?:string;itemCount:number;orderStatus?:string|null;
};
type Readiness={
  status:"READY"|"WARN"|"BLOCKED";score:number;
  summary:{total:number;ready:number;warn:number;blocked:number};
  checks:Array<{id:string;label:string;status:"READY"|"WARN"|"BLOCKED";message:string}>;
  nextActions:Array<{priority:"P0"|"P1"|"P2";checkId:string;label:string}>;
};
type ControlAnalysis={level:string;metrics?:Record<string,number>;readiness?:Readiness};

const n=(value:any)=>Number(value)||0;
const money=(value:any)=>new Intl.NumberFormat("th-TH",{minimumFractionDigits:0,maximumFractionDigits:2}).format(n(value));

export default function PosDailyWorkspace({
  session,bootstrap,open,online,onClose
}:{
  session:Session;bootstrap:Bootstrap|null;open:boolean;online:boolean;onClose:()=>void
}){
  const canQueue=session.user.role==="admin"||session.user.permissions?.queue===true;
  const canOrder=session.user.role==="admin"||session.user.permissions?.order===true;
  const canStock=session.user.role==="admin"||session.user.permissions?.stock===true;
  const canStatus=session.user.role==="admin";
  const tabs=useMemo(()=>[
    canQueue&&"queue",canOrder&&"orders",canStock&&"stock",canStatus&&"status"
  ].filter(Boolean) as WorkspaceTab[],[canQueue,canOrder,canStock,canStatus]);

  const [tab,setTab]=useState<WorkspaceTab>(tabs[0]||"orders");
  const [queue,setQueue]=useState<QueueOrder[]>([]);
  const [sales,setSales]=useState<Sale[]>([]);
  const [control,setControl]=useState<ControlAnalysis|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");

  useEffect(()=>{
    if(!tabs.includes(tab)&&tabs[0])setTab(tabs[0]);
  },[tabs.join("|"),tab]);

  async function refresh(){
    if(!online){
      setMessage("OFFLINE · ดูสัญญาณสต็อกจากข้อมูลล่าสุดได้ แต่คิว ออเดอร์ และสถานะระบบต้องรอเชื่อมต่อ");
      return;
    }
    setBusy(true);setMessage("");
    try{
      const jobs:Array<{key:"queue"|"orders"|"status";promise:Promise<any>}>= [];
      if(canQueue)jobs.push({key:"queue",promise:api<any>("/api/pos/queue")});
      if(canOrder)jobs.push({key:"orders",promise:api<any>("/api/pos/history")});
      if(canStatus)jobs.push({key:"status",promise:api<any>("/api/control-center")});
      const results=await Promise.allSettled(jobs.map(x=>x.promise));
      results.forEach((result,index)=>{
        if(result.status!=="fulfilled")return;
        const key=jobs[index].key,value=result.value;
        if(key==="queue")setQueue(Array.isArray(value.orders)?value.orders:[]);
        if(key==="orders")setSales(Array.isArray(value.sales)?value.sales:[]);
        if(key==="status")setControl(value.analysis||null);
      });
      if(results.some(x=>x.status==="rejected"))setMessage("บางข้อมูลโหลดไม่ได้ แต่หน้า POS และตะกร้ายังใช้งานต่อได้ตามปกติ");
    }catch{
      setMessage("โหลดงานร้านไม่สำเร็จ · หน้า POS ยังใช้งานต่อได้ตามปกติ");
    }finally{setBusy(false)}
  }

  useEffect(()=>{
    if(open)refresh().catch(()=>{});
  },[open]);

  useEffect(()=>{
    if(!open)return;
    const refreshOnFocus=()=>refresh().catch(()=>{});
    window.addEventListener("focus",refreshOnFocus);
    window.addEventListener("online",refreshOnFocus);
    return()=>{
      window.removeEventListener("focus",refreshOnFocus);
      window.removeEventListener("online",refreshOnFocus);
    };
  },[open,online,session.csrf]);

  const stockRows=useMemo(()=>{
    const rows:Array<{key:string;name:string;variant:string;level:"out"|"low";detail:string}>=[];
    for(const menu of bootstrap?.menu||[]){
      for(const variant of menu.variants||[]){
        if(!variant.available){
          const missing=(variant.missingIngredients||[]).map(x=>x.name).join(", ");
          rows.push({
            key:menu.id+"|"+variant.label,name:menu.name,variant:variant.label,level:"out",
            detail:missing?("ขาด "+missing):(variant.reason||"ทำเมนูนี้ไม่ได้")
          });
        }else if(variant.lowStock){
          rows.push({
            key:menu.id+"|"+variant.label,name:menu.name,variant:variant.label,level:"low",
            detail:"ทำได้ประมาณ "+variant.maxServings+" แก้ว"
          });
        }
      }
    }
    return rows.slice(0,12);
  },[bootstrap?.revision]);

  if(!open)return null;

  const queueRows=queue.slice().sort((a,b)=>n(a.time)-n(b.time)).slice(0,6);
  const orderRows=sales.slice(0,7);
  const outCount=stockRows.filter(x=>x.level==="out").length;
  const lowCount=stockRows.filter(x=>x.level==="low").length;
  const readiness=control?.readiness||null;

  const meta:Array<{key:WorkspaceTab;label:string;icon:any;allowed:boolean;count?:number}>=[
    {key:"queue",label:"คิว",icon:ListOrdered,allowed:canQueue,count:queue.length},
    {key:"orders",label:"ออเดอร์",icon:ClipboardList,allowed:canOrder,count:sales.length},
    {key:"stock",label:"สต็อก",icon:Boxes,allowed:canStock,count:outCount+lowCount},
    {key:"status",label:"สถานะ",icon:ShieldCheck,allowed:canStatus,count:readiness?.summary.blocked||0}
  ];

  return <div className="fixed inset-0 z-[90] bg-black/25 backdrop-blur-[2px]" onClick={onClose}>
    <aside
      role="dialog"
      aria-modal="true"
      aria-label="งานร้าน FIELD"
      onClick={e=>e.stopPropagation()}
      className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-slate-200 bg-[#f6f7f8] shadow-2xl sm:w-[520px]"
    >
      <header className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-4 sm:px-5">
        <div>
          <p className="m-0 text-[10px] font-black tracking-[.22em] text-[#765b08]">FIELD DAILY WORKSPACE</p>
          <h2 className="mt-1 text-xl font-black text-slate-900">งานร้าน</h2>
          <p className="mt-1 text-xs text-slate-500">เช็กงานหลักโดยไม่ออกจากหน้า POS · งานแก้ไขเชิงลึกค่อยเปิดหน้าเต็ม</p>
        </div>
        <div className="flex gap-1">
          <button type="button" onClick={()=>{
            onClose();
            window.dispatchEvent(new CustomEvent("field:ai-ask",{detail:{message:"ช่วยตรวจงานร้านตอนนี้และบอกสิ่งที่ควรทำต่อ"}}));
          }} aria-label="ถามผู้ช่วยเรื่องงานร้าน" className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white">
            <Bot size={18}/>
          </button>
          <button disabled={busy||!online} onClick={()=>refresh()} aria-label="รีเฟรชงานร้าน" className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white disabled:opacity-40">
            <RefreshCw size={17} className={busy?"animate-spin":""}/>
          </button>
          <button onClick={onClose} aria-label="ปิดงานร้าน" className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white">
            <X size={18}/>
          </button>
        </div>
      </header>

      <div className="grid grid-cols-4 gap-1 border-b border-slate-200 bg-white p-2">
        {meta.filter(x=>x.allowed).map(({key,label,icon:Icon,count})=><button
          key={key}
          onClick={()=>setTab(key)}
          className={"relative flex min-h-12 flex-col items-center justify-center rounded-xl px-1 text-[10px] font-bold "+(tab===key?"bg-[#d4af37]/20 text-[#6f5510]":"text-slate-600 hover:bg-slate-100")}
        >
          <Icon size={17}/><span className="mt-0.5">{label}</span>
          {Number(count)>0&&<span className="absolute right-2 top-1 rounded-full bg-slate-900 px-1.5 text-[9px] text-white">{count}</span>}
        </button>)}
      </div>

      {message&&<div className="mx-3 mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">{message}</div>}

      <div className="soft-scroll min-h-0 flex-1 overflow-auto p-3 sm:p-4">
        {tab==="queue"&&canQueue&&<div className="space-y-2">
          {queueRows.length===0?<Empty text={!online?"ออฟไลน์ · ยังไม่ดึงคิวจาก Server":"ไม่มีคิวที่กำลังทำ"}/>:queueRows.map(order=>{
            const total=(order.items||[]).reduce((s,x)=>s+n(x.qty),0);
            const ready=(order.items||[]).reduce((s,x)=>s+Math.min(n(x.qty),n(x.readyQty)),0);
            const called=(order.items||[]).reduce((s,x)=>s+Math.min(n(x.qty),n(x.calledQty)),0);
            return <div key={order.id} className="rounded-2xl border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <div><b className="text-base">{order.queueNo}</b><span className="ml-2 text-xs text-slate-500">บัตร {order.pagerNo||"—"}</span></div>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase">{order.status}</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                <Metric label="ทั้งหมด" value={total}/><Metric label="ทำแล้ว" value={ready}/><Metric label="เรียกแล้ว" value={called}/>
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-slate-500">{(order.items||[]).map(x=>x.name+" ×"+x.qty).join(" · ")}</p>
            </div>;
          })}
          <FullLink href="/queue" label="เปิดโหมดทำเครื่องดื่ม"/>
        </div>}

        {tab==="orders"&&canOrder&&<div className="space-y-2">
          {orderRows.length===0?<Empty text="ยังไม่มีออเดอร์ล่าสุด"/>:orderRows.map(sale=><div key={sale.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3">
            <div className="min-w-0">
              <div><b>{sale.queueNo||sale.billNo||"บิล"}</b><span className="ml-2 text-[10px] uppercase text-slate-500">{sale.payment}</span></div>
              <p className="mt-1 truncate text-xs text-slate-500">{sale.itemCount} รายการ · {sale.status}{sale.orderStatus?" · "+sale.orderStatus:""}</p>
            </div>
            <b className="shrink-0 text-[#765b08]">฿{money(sale.total)}</b>
          </div>)}
          <FullLink href="/orders" label="เปิดประวัติ/Refund/VOID"/>
        </div>}

        {tab==="stock"&&canStock&&<div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <StatusCard label="ทำไม่ได้" value={outCount} level="danger"/>
            <StatusCard label="ใกล้หมด" value={lowCount} level="warn"/>
          </div>
          {stockRows.length===0?<Empty text="เมนูที่เปิดขายยังไม่พบสัญญาณสต็อกต่ำ"/>:stockRows.map(row=><div key={row.key} className={"rounded-2xl border p-3 "+(row.level==="out"?"border-red-200 bg-red-50":"border-amber-200 bg-amber-50")}>
            <div className="flex items-start justify-between gap-2">
              <div><b className="text-sm">{row.name}</b><p className="mt-0.5 text-[11px] text-slate-500">{row.variant}</p></div>
              <span className={"rounded-full px-2 py-1 text-[9px] font-black "+(row.level==="out"?"bg-red-100 text-red-700":"bg-amber-100 text-amber-800")}>{row.level==="out"?"พักขาย":"LOW"}</span>
            </div>
            <p className="mt-2 text-xs text-slate-700">{row.detail}</p>
          </div>)}
          <FullLink href="/stock" label="เปิด Stock / รับเข้า / นับจริง"/>
        </div>}

        {tab==="status"&&canStatus&&<div className="space-y-3">
          {!readiness?<Empty text={!online?"ออฟไลน์ · ต้องเชื่อมต่อเพื่ออ่าน System Readiness":"ยังไม่มีข้อมูล System Readiness"}/>:<>
            <div className={"rounded-2xl border p-4 "+(readiness.status==="READY"?"border-emerald-200 bg-emerald-50":readiness.status==="WARN"?"border-amber-200 bg-amber-50":"border-red-200 bg-red-50")}>
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-[10px] font-black tracking-[.15em] text-slate-500">SYSTEM READINESS</p><b className="mt-1 block text-lg">{readiness.status}</b></div>
                <div className="text-right"><b className="text-2xl">{readiness.score}</b><span className="text-xs text-slate-500">/100</span></div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center"><Metric label="พร้อม" value={readiness.summary.ready}/><Metric label="เตือน" value={readiness.summary.warn}/><Metric label="บล็อก" value={readiness.summary.blocked}/></div>
            </div>
            <div className="space-y-2">{readiness.checks.map(check=><div key={check.id} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3">
              <div><b className="text-sm">{check.label}</b><p className="mt-1 text-xs text-slate-500">{check.message}</p></div>
              <span className={"rounded-full px-2 py-1 text-[9px] font-black "+(check.status==="READY"?"bg-emerald-100 text-emerald-700":check.status==="WARN"?"bg-amber-100 text-amber-800":"bg-red-100 text-red-700")}>{check.status}</span>
            </div>)}</div>
          </>}
          <FullLink href="/control" label="เปิด AI Control / ตรวจรายละเอียด"/>
        </div>}
      </div>
    </aside>
  </div>;
}

function Empty({text}:{text:string}){return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-center text-xs text-slate-500">{text}</div>}
function Metric({label,value}:{label:string;value:number}){return <div className="rounded-xl bg-slate-50 p-2"><b className="block text-base">{value}</b><span className="text-[10px] text-slate-500">{label}</span></div>}
function StatusCard({label,value,level}:{label:string;value:number;level:"danger"|"warn"}){return <div className={"rounded-2xl border p-3 "+(level==="danger"?"border-red-200 bg-red-50":"border-amber-200 bg-amber-50")}><b className="text-2xl">{value}</b><p className="mt-1 text-xs text-slate-600">{label}</p></div>}
function FullLink({href,label}:{href:string;label:string}){return <Link href={href} className="flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700">{label}</Link>}
