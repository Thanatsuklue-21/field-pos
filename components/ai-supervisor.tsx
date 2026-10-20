"use client";
import {useEffect,useMemo,useState} from "react";
import {useRouter,usePathname} from "next/navigation";
import {Bot,RefreshCw,Send,ShieldAlert,Sparkles,X} from "lucide-react";
import ModalFocus from "@/components/modal-focus";
import {api,type Session} from "@/lib/api-client";

type Alert={id:string;severity:"critical"|"high"|"medium"|"low"|"info";area:string;title:string;detail:string;href:string};
type Snapshot={health:"critical"|"review"|"ok";topSeverity:string;metrics:Record<string,number>;alerts:Alert[];policy:{auto:string[];approval:string[];never:string[]};generatedAt:number;revision:number};
type AiReply={answer:string;actions:{type:"navigate"|"refresh";label:string;href:string;reason:string}[];mode:"ai"|"rules";snapshot:Snapshot};

export default function AiSupervisor({session,initialRequest}:{session:Session|null;initialRequest?:{id:number;message:string}|null}){
  const router=useRouter(),path=usePathname(),[open,setOpen]=useState(false),[snap,setSnap]=useState<Snapshot|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("ช่วยตรวจว่าตอนนี้ต้องทำอะไรก่อน"),[reply,setReply]=useState<AiReply|null>(null),[error,setError]=useState("");
  async function load(){
    if(!session)return;
    try{setSnap(await api<Snapshot>("/api/ai/supervisor"));setError("")}
    catch(e:any){if(e?.message!=="network_unavailable")setError("AI Supervisor โหลดสถานะไม่ได้")}
  }
  useEffect(()=>{if(!session||!open)return;load();const id=setInterval(()=>{if(document.visibilityState==="visible")load()},30000);return()=>clearInterval(id)},[session?.user.id,open]);
  const badge=useMemo(()=>snap?.alerts?.filter(x=>x.severity==="critical"||x.severity==="high").length||0,[snap]);
  async function ask(text=message){
    if(!session||!text.trim())return;
    setBusy(true);setError("");
    try{
      const r=await api<AiReply>("/api/ai/chat",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({message:text.trim()})});
      setReply(r);setSnap(r.snapshot);
    }catch(e:any){setError(e?.message==="network_unavailable"?"ออฟไลน์ · ใช้กฎตรวจสอบในระบบเดิมต่อได้ แต่ AI อธิบายยังใช้งานไม่ได้":"AI ยังตอบไม่ได้ กรุณาลองใหม่")}
    finally{setBusy(false)}
  }
  useEffect(()=>{
    if(!session||!initialRequest)return;
    setOpen(true);
    if(initialRequest.message){setMessage(initialRequest.message);ask(initialRequest.message)}
  },[initialRequest?.id,session?.user.id]);

  useEffect(()=>{
    const handler=(event:Event)=>{
      const next=String((event as CustomEvent)?.detail?.message||"ช่วยตรวจสิ่งที่ผิดปกติตอนนี้");
      setOpen(true);setMessage(next);ask(next);
    };
    window.addEventListener("field:ai-ask",handler);
    return()=>window.removeEventListener("field:ai-ask",handler);
  },[session?.user.id,snap?.revision]);
  function runAction(a:AiReply["actions"][number]){
    if(a.type==="refresh"){load();return}
    if(a.type==="navigate"){router.push(a.href);setOpen(false)}
  }
  if(!session)return null;
  const critical=snap?.health==="critical",review=snap?.health==="review";
  return <>
    {open&&<div className="field-modal-overlay fixed inset-0 z-[120] bg-slate-950/20 backdrop-blur-[2px] md:flex md:items-end md:justify-end" onClick={e=>{if(e.currentTarget===e.target)setOpen(false)}}>
      <ModalFocus labelId="ai-supervisor-title" onEscape={()=>setOpen(false)} className="field-modal-panel ml-auto flex h-[min(760px,calc(100dvh-1rem))] w-full max-w-[430px] flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-[#f8fafc] shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div className="flex items-center gap-2"><div className="grid h-9 w-9 place-items-center rounded-full bg-[#d4af37]/15 text-[#765b08]"><Sparkles size={17}/></div><div><b id="ai-supervisor-title" className="text-sm">FIELD AI Supervisor</b><div className="text-[10px] text-slate-500">เฝ้าเงิน · สต๊อก · Flow · ความผิดปกติ</div></div></div>
          <button aria-label="ปิด FIELD AI Supervisor" onClick={()=>setOpen(false)} className="grid h-11 w-11 place-items-center rounded-full hover:bg-slate-100"><X size={17}/></button>
        </header>
        <div className="soft-scroll flex-1 overflow-auto p-3">
          <div className={"rounded-2xl border p-3 "+(critical?"border-red-200 bg-red-50":review?"border-amber-200 bg-amber-50":"border-emerald-200 bg-emerald-50")}>
            <div className="flex items-center justify-between gap-2"><b className="text-sm">{critical?"ต้องตรวจทันที":review?"มีรายการควรตรวจ":"สถานะหลักปกติ"}</b><button onClick={load} className="rounded-full bg-white/80 p-2"><RefreshCw size={14}/></button></div>
            <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[10px]">
              <div className="rounded-xl bg-white p-2"><b className="block text-sm">{snap?.metrics?.openOrders||0}</b>คิวค้าง</div>
              <div className="rounded-xl bg-white p-2"><b className="block text-sm">{snap?.metrics?.pendingPayments||0}</b>จ่ายค้าง</div>
              <div className="rounded-xl bg-white p-2"><b className="block text-sm">{snap?.metrics?.outOfStock||0}</b>หมด</div>
              <div className="rounded-xl bg-white p-2"><b className="block text-sm">{snap?.metrics?.lowStock||0}</b>ใกล้หมด</div>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {(snap?.alerts||[]).slice(0,6).map(a=><button key={a.id} onClick={()=>router.push(a.href)} className="w-full rounded-2xl border border-slate-200 bg-white p-3 text-left hover:border-[#d4af37]">
              <div className="flex gap-2"><ShieldAlert size={16} className={a.severity==="critical"?"text-red-600":a.severity==="high"?"text-amber-600":"text-slate-500"}/><div><b className="text-xs">{a.title}</b><p className="mt-1 text-[11px] leading-4 text-slate-500">{a.detail}</p></div></div>
            </button>)}
            {snap&&snap.alerts.length===0&&<div className="rounded-2xl border border-slate-200 bg-white p-3 text-xs text-slate-500">ไม่พบ Critical/High signal จากตัวตรวจหลักตอนนี้</div>}
          </div>
          {reply&&<div className="mt-3 rounded-2xl border border-[#d4af37]/30 bg-white p-3"><div className="mb-1 text-[10px] font-bold tracking-wider text-[#765b08]">{reply.mode==="ai"?"AI ANALYSIS":"RULES FALLBACK"}</div><p className="text-sm leading-6">{reply.answer}</p>{reply.actions.length>0&&<div className="mt-3 flex flex-wrap gap-2">{reply.actions.map((a,i)=><button key={i} onClick={()=>runAction(a)} className="rounded-full bg-[#1d1d1f] px-3 py-2 text-xs font-semibold text-white">{a.label}</button>)}</div>}</div>}
          {error&&<div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
        </div>
        <footer className="border-t border-slate-200 bg-white p-3">
          <div className="mb-2 flex gap-1 overflow-x-auto text-[10px]"><button onClick={()=>ask("ตรวจเรื่องเงินและลิ้นชักตอนนี้") } className="whitespace-nowrap rounded-full bg-slate-100 px-3 py-1.5">ตรวจเงิน</button><button onClick={()=>ask("ตรวจสต๊อกและเมนูที่เสี่ยงขายไม่ได้") } className="whitespace-nowrap rounded-full bg-slate-100 px-3 py-1.5">ตรวจสต๊อก</button><button onClick={()=>ask("ดู flow ตอนนี้แล้วพาไปทำสิ่งที่ควรทำก่อน") } className="whitespace-nowrap rounded-full bg-slate-100 px-3 py-1.5">ทำอะไรก่อน</button></div>
          <div className="flex gap-2"><input value={message} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();ask()}}} className="min-h-11 min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm" placeholder="ถาม AI เกี่ยวกับงานร้าน..."/><button disabled={busy||!message.trim()} onClick={()=>ask()} className="grid h-11 w-11 place-items-center rounded-2xl bg-[#d4af37] text-black disabled:opacity-40">{busy?<RefreshCw size={17} className="animate-spin"/>:<Send size={17}/>}</button></div>
          <p className="mt-2 text-[10px] leading-4 text-slate-400">AI ทำอัตโนมัติได้เฉพาะ Navigate / Refresh / Explain · เงินออก Refund Void Stock Adjustment และ Close Day ต้องยืนยันโดยคน</p>
        </footer>
      </ModalFocus>
    </div>}
  </>;
}
