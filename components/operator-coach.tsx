"use client";

import {useEffect,useMemo,useState} from "react";
import {ArrowRight,CheckCircle2,CircleHelp,ShieldCheck,X} from "lucide-react";
import {usePathname} from "next/navigation";

const KEY="field-operator-coach-v2";
type Guide={title:string;rule:string;steps:string[];cta:string};

const guides:Record<string,Guide>={
  pos:{
    title:"รับออเดอร์แบบไม่ต้องจำ",
    rule:"ทำจากบนลงล่าง ระบบจะปิดสิ่งที่ยังทำไม่ได้เอง",
    steps:[
      "1 · แตะเมนู แล้วเลือกความหวาน/สูตรที่ลูกค้าต้องการ",
      "2 · กด “ตรวจรายการ / ชำระเงิน” แล้วทวนเมนู จำนวน ความหวาน และยอดกับลูกค้า",
      "3 · กด “ทวนแล้ว · พร้อมรับเงิน” แล้วรับเงินตามวิธีที่เลือก",
      "4 · เมื่อชำระสำเร็จ หยิบบัตรเลขที่ระบบแสดงให้ลูกค้า"
    ],
    cta:"งานขายส่วนใหญ่จบจากหน้าเดียว · งานคิว/สต็อก/รายจ่ายด่วนเปิดจาก “งานร้าน” ได้"
  },
  queue:{
    title:"ทำเครื่องดื่มตามคิวแบบไม่หลง",
    rule:"ทำบัตรแรกก่อนเสมอ และทำตามขั้นตอนที่ระบบชี้",
    steps:[
      "1 · ดูบัตรปัจจุบันและเมนูที่ต้องทำ",
      "2 · ทำให้ครบก่อนกดเสร็จ ระบบจะพาไปขั้นตอนถัดไป",
      "3 · เมื่อครบจึงเรียกลูกค้า",
      "4 · ก่อนส่งมอบ เปิดดูบัตร จำนวนแก้ว และรายการให้ตรง แล้วค่อยกด “ลูกค้ารับแล้ว”"
    ],
    cta:"ถ้าชงเสีย ใช้ “ชงเสีย / ทำใหม่” เพื่อให้ Stock และต้นทุนถูกต้อง"
  }
};

export default function OperatorCoach(){
  const path=usePathname();
  const mode=path.startsWith("/queue")?"queue":path.startsWith("/pos")?"pos":"";
  const guide=useMemo(()=>mode?guides[mode]:null,[mode]);
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState(false);

  useEffect(()=>{
    const onBusy=(event:Event)=>{
      const next=!!(event as CustomEvent).detail?.busy;
      setBusy(next);
      if(next)setOpen(false);
    };
    window.addEventListener("field:transaction-busy",onBusy);
    return()=>window.removeEventListener("field:transaction-busy",onBusy);
  },[]);

  useEffect(()=>{
    if(!guide||busy)return;
    try{
      if(localStorage.getItem(KEY)!=="seen"){
        const timer=window.setTimeout(()=>setOpen(true),300);
        return()=>window.clearTimeout(timer);
      }
    }catch{}
  },[guide,busy]);

  if(!guide)return null;
  const close=()=>{setOpen(false);try{localStorage.setItem(KEY,"seen")}catch{}};

  return <>
    <button type="button" disabled={busy} onClick={()=>setOpen(true)} aria-label="เปิดคู่มือใช้งาน 1 นาที"
      className="fixed right-0 top-1/2 z-[75] flex min-h-14 w-12 -translate-y-1/2 flex-col items-center justify-center gap-0.5 rounded-l-2xl border border-r-0 border-[#d4af37]/60 bg-white/95 text-[#6f5510] shadow-lg disabled:opacity-35">
      <CircleHelp size={18}/><span className="text-[9px] font-black">1 นาที</span><span className="sr-only">ใช้เป็นใน 1 นาที</span>
    </button>
    {open&&!busy&&<div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/45 p-3">
      <div role="dialog" aria-modal="true" aria-label="คู่มือใช้งาน FIELD POS 1 นาที" className="soft-scroll max-h-[92dvh] w-full max-w-lg overflow-auto rounded-[28px] border border-slate-200 bg-white p-4 shadow-2xl sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#fff5c7] text-[#765b08]"><ShieldCheck size={21}/></div><div><p className="text-[10px] font-black tracking-[.18em] text-[#8a6b12]">คู่มือ 1 นาที</p><h2 className="mt-1 text-xl font-black">{guide.title}</h2></div></div>
          <button type="button" onClick={close} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-slate-200 bg-slate-50" aria-label="ปิดคู่มือ"><X size={18}/></button>
        </div>
        <div className="mt-4 rounded-2xl border-2 border-[#d4af37] bg-[#fffaf0] px-4 py-3"><div className="flex gap-2"><ShieldCheck size={17} className="mt-0.5 shrink-0 text-[#8a6b12]"/><p className="text-sm font-bold leading-6 text-[#5f4b13]">{guide.rule}</p></div></div>
        <div className="mt-4 space-y-2">{guide.steps.map(step=><div key={step} className="flex min-h-12 items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3"><CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600"/><p className="text-sm font-semibold leading-5">{step}</p></div>)}</div>
        <div className="mt-4 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold leading-5 text-white">{guide.cta}</div>
        <button type="button" onClick={close} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#d4af37] px-4 text-sm font-black text-black">เข้าใจแล้ว · ทำตามระบบ <ArrowRight size={17}/></button>
      </div>
    </div>}
  </>;
}
