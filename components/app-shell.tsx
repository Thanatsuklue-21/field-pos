"use client";
import {useEffect,useMemo,useState} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {BarChart3,ClipboardList,ListOrdered,Package2,Settings,ShoppingBag,Sparkles,Boxes,LayoutDashboard,ReceiptText,Users,BookOpenCheck,CalendarCheck2,DatabaseBackup,UserCog,ScrollText,Calculator,ShieldCheck,MoreHorizontal,X} from "lucide-react";
import {useAppStore} from "@/stores/app-store";
import {dict} from "@/lib/i18n";
import NetworkStatus from "@/components/network-status";
import PosWebVitals from "@/components/pos-web-vitals";
const AiSupervisor=dynamic(()=>import("@/components/ai-supervisor"),{ssr:false});
import {clearSessionCache,getSessionCached,type Session} from "@/lib/api-client";

const items=[["/dashboard","dashboard",LayoutDashboard,"report"],["/control","control",ShieldCheck,"admin"],["/pos","pos",ShoppingBag,"order"],["/queue","queue",ListOrdered,"queue"],["/products","products",Package2,"admin"],["/stock","stock",Boxes,"stock"],["/costs","costs",Calculator,"admin"],["/expenses","expenses",ReceiptText,"report"],["/customers","customers",Users,"admin"],["/recipes","recipes",BookOpenCheck,"admin"],["/close","close",CalendarCheck2,"report"],["/orders","orders",ClipboardList,"order"],["/reports","reports",BarChart3,"report"],["/backup","backup",DatabaseBackup,"admin"],["/users","users",UserCog,"admin"],["/audit","audit",ScrollText,"admin"],["/settings","settings",Settings,"any"]] as const;
const workRoutes=["/pos","/queue","/orders","/close"];
const backOfficePriority=["/dashboard","/control","/products","/stock","/recipes","/costs","/expenses","/customers","/reports","/backup","/users","/audit","/settings"];
const primaryMobile=["/pos","/queue","/orders","/close"];

export default function AppShell({children}:{children:React.ReactNode}){
  const path=usePathname(),lang=useAppStore(s=>s.language),t=dict[lang],[session,setSession]=useState<Session|null>(null),[moreOpen,setMoreOpen]=useState(false),[manageOpen,setManageOpen]=useState(false),[aiMounted,setAiMounted]=useState(path!=="/pos"),[aiRequest,setAiRequest]=useState<{id:number;message:string}|null>(null);
  useEffect(()=>{const logged=(e:Event)=>setSession((e as CustomEvent).detail||null),expired=()=>{clearSessionCache();setSession(null)};getSessionCached().then(setSession).catch(()=>{});window.addEventListener("field:session",logged);window.addEventListener("field:auth-expired",expired);return()=>{window.removeEventListener("field:session",logged);window.removeEventListener("field:auth-expired",expired)}},[]);
  useEffect(()=>{setMoreOpen(false);setManageOpen(!workRoutes.includes(path));if(path!=="/pos")setAiMounted(true)},[path]);
  useEffect(()=>{
    if(path!=="/pos"||aiMounted)return;
    const requestAi=(event:Event)=>{
      const message=String((event as CustomEvent)?.detail?.message||"ช่วยตรวจสิ่งที่ผิดปกติตอนนี้");
      setAiRequest({id:Date.now(),message});
      setAiMounted(true);
    };
    window.addEventListener("field:ai-ask",requestAi);
    return()=>window.removeEventListener("field:ai-ask",requestAi);
  },[path,aiMounted]);

  const allowed=useMemo(()=>items.filter(([, , ,access])=>session&&(access==="any"||session.user.role==="admin"||session.user.permissions?.[access]===true)),[session]);
  const desktopPrimary=allowed.filter(([href])=>workRoutes.includes(href)).sort((a,b)=>workRoutes.indexOf(a[0])-workRoutes.indexOf(b[0]));
  const desktopManage=allowed.filter(([href])=>!workRoutes.includes(href)).sort((a,b)=>{
    const ai=backOfficePriority.indexOf(a[0]),bi=backOfficePriority.indexOf(b[0]);
    return (ai<0?backOfficePriority.length:ai)-(bi<0?backOfficePriority.length:bi);
  });
  const desktopManageActive=desktopManage.some(([href])=>path===href);
  const mobilePrimary=allowed.filter(([href])=>primaryMobile.includes(href)).sort((a,b)=>primaryMobile.indexOf(a[0])-primaryMobile.indexOf(b[0]));
  const mobileMore=desktopManage;
  const moreActive=mobileMore.some(([href])=>path===href);
  const openPosWorkspace=(tab:"queue"|"orders"|"stock"|"expense"|null)=>window.dispatchEvent(new CustomEvent("field:open-pos-workspace",{detail:{tab}}));

  return <div className="field-app-root h-dvh w-full bg-[#e9edf2] p-1.5 pb-[70px] text-[#1d1d1f] sm:p-2 sm:pb-[76px] md:p-4 md:pb-4">
    <NetworkStatus/>
    <PosWebVitals session={session}/>
    <div className="flex h-full gap-2 sm:gap-3 md:gap-4">
      <aside className="glass card hidden w-[92px] shrink-0 flex-col items-center py-5 md:flex xl:w-[220px]">
        <div className="mb-5 flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-full border border-[#d4af37]/45 bg-[#d4af37]/10"><Sparkles size={19} className="gold"/></div><div className="hidden xl:block"><b className="tracking-[.3em]">FIELD</b><small className="block text-[10px] text-slate-500">CAFE POS</small></div></div>
        <div className="hidden w-full px-5 pb-2 text-[9px] font-bold uppercase tracking-[.18em] text-slate-400 xl:block">หน้าทำงาน · งานประจำวัน</div>
        <nav aria-label="งานประจำวัน" className="soft-scroll w-full space-y-1 overflow-y-auto px-3">
          {desktopPrimary.map(([href,key,Icon])=><Link key={href} href={href} prefetch={path==="/pos"?false:undefined} aria-current={path===href?"page":undefined} className={"flex min-h-11 items-center gap-3 rounded-full px-4 py-2.5 text-sm transition "+(path===href?"bg-[#d4af37]/16 font-semibold text-[#6f5510] shadow-sm":"text-slate-600 hover:bg-slate-100 hover:text-slate-950")}><Icon size={18}/><span className="hidden xl:block">{t[key]}</span></Link>)}
          {desktopManage.length>0&&<div className="pt-2">
            <button type="button" aria-expanded={manageOpen} aria-controls="field-desktop-manage" aria-label="เปิดหรือปิดเมนูหลังบ้าน" onClick={()=>setManageOpen(v=>!v)} className={"flex min-h-11 w-full items-center gap-3 rounded-full border px-4 py-2.5 text-sm transition "+(desktopManageActive||manageOpen?"border-[#d4af37]/50 bg-[#fff8dc] font-semibold text-[#6f5510]":"border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-950")}><Settings size={18}/><span className="hidden xl:block">หลังบ้าน</span></button>
            {manageOpen&&<div id="field-desktop-manage" className="mt-2 space-y-1 rounded-2xl border border-slate-200 bg-slate-50/80 p-1.5"><div className="hidden px-3 py-1 text-[9px] font-bold uppercase tracking-[.16em] text-slate-400 xl:block">หลังบ้าน · เจ้าของร้าน / จัดการระบบ</div>
              {desktopManage.map(([href,key,Icon])=><Link key={href} href={href} prefetch={path==="/pos"?false:undefined} aria-current={path===href?"page":undefined} className={"flex min-h-11 items-center gap-3 rounded-full px-4 py-2.5 text-sm transition "+(path===href?"bg-[#d4af37]/16 font-semibold text-[#6f5510] shadow-sm":"text-slate-600 hover:bg-slate-100 hover:text-slate-950")}><Icon size={18}/><span className="hidden xl:block">{t[key]}</span></Link>)}
            </div>}
          </div>}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-hidden rounded-[20px] border border-slate-300/80 bg-[#f3f5f7] shadow-[0_10px_30px_rgba(15,23,42,.08)] sm:rounded-[24px] md:rounded-[32px]">{children}</main>
    </div>

    {(path!=="/pos"||aiMounted)&&<AiSupervisor session={session} initialRequest={aiRequest}/>} 

    {mobileMore.length>0&&moreOpen&&<div className="fixed inset-0 z-[48] bg-black/20 md:hidden" onClick={()=>setMoreOpen(false)}>
      <div id="field-mobile-more" aria-label="เมนูหลังบ้าน" className="frosted absolute bottom-[calc(70px+env(safe-area-inset-bottom))] left-2 right-2 max-h-[calc(100dvh-110px)] overflow-y-auto overscroll-contain rounded-[20px] p-2 shadow-2xl" onClick={e=>e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between px-2"><div><b className="text-sm">หลังบ้าน</b><p className="mt-0.5 text-[10px] text-slate-500">สต็อก ต้นทุน รายจ่าย สูตร รายงาน ผู้ใช้ และการตั้งค่าร้าน</p></div><button onClick={()=>setMoreOpen(false)} className="grid h-11 w-11 place-items-center rounded-xl" aria-label="ปิดเมนูหลังบ้าน"><X size={17}/></button></div>
        <div className="mb-2 rounded-xl border border-[#d4af37]/35 bg-[#fff8dc] px-3 py-2 text-[10px] leading-4 text-[#6f5510]">โซนนี้เป็นงานจัดการร้าน ไม่ใช่ขั้นตอนรับออเดอร์ประจำวัน</div>
        <div className="grid gap-1">{mobileMore.map(([href,key,Icon])=><Link key={href} href={href} prefetch={path==="/pos"?false:undefined} className={"flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm "+(path===href?"bg-[#d4af37]/18 font-bold text-[#6f5510]":"text-slate-700")}><Icon size={18}/><span>{t[key]}</span></Link>)}</div>
      </div>
    </div>}

    {(mobilePrimary.length>0||mobileMore.length>0)&&<nav aria-label="เมนูหลักบนมือถือ" className="frosted fixed bottom-[max(.35rem,env(safe-area-inset-bottom))] left-1.5 right-1.5 z-50 flex items-stretch gap-0.5 overflow-hidden rounded-[20px] p-1 md:hidden">
      {mobilePrimary.map(([href,key,Icon])=>path==="/pos"&&href==="/queue"?<button key={href} type="button" onClick={()=>openPosWorkspace(null)} className="flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[16px] bg-[#fff8dc] px-1 py-1 text-[9px] font-bold text-[#6f5510]"><ClipboardList size={17}/><span className="truncate">งานร้าน</span></button>:<Link key={href} href={href} prefetch={path==="/pos"?false:undefined} className={"flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[16px] px-1 py-1 text-[9px] "+(path===href?"bg-[#d4af37]/18 font-bold text-[#6f5510]":"text-slate-600")}><Icon size={17}/><span className="truncate">{t[key]}</span></Link>)}
      {mobileMore.length>0&&<button type="button" aria-controls="field-mobile-more" aria-expanded={moreOpen} onClick={()=>setMoreOpen(v=>!v)} className={"flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[16px] px-1 py-1 text-[9px] "+(moreActive||moreOpen?"bg-[#d4af37]/18 font-bold text-[#6f5510]":"text-slate-600")}><Settings size={18}/><span>หลังบ้าน</span></button>}
    </nav>}
  </div>
}
