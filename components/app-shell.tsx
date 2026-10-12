"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import Link from "next/link";
import {usePathname,useRouter} from "next/navigation";
import {BarChart3,ChevronDown,ClipboardList,ListOrdered,Package2,Settings,ShoppingBag,Sparkles,Boxes,LayoutDashboard,ReceiptText,Users,BookOpenCheck,CalendarCheck2,DatabaseBackup,UserCog,ScrollText,Calculator,MoreHorizontal,X} from "lucide-react";
import {useAppStore} from "@/stores/app-store";
import {dict} from "@/lib/i18n";
import NetworkStatus from "@/components/network-status";
import OperatorCoach from "@/components/operator-coach";
import {clearSessionCache,getSessionCached,type Session} from "@/lib/api-client";
import {getOfflineOperatorIfReady} from "@/lib/offline-operator";
import {mobileOverflow} from "@/lib/mobile-navigation";
import {splitNavigation} from "@/lib/navigation-groups";

const items=[["/dashboard","dashboard",LayoutDashboard,"report"],["/pos","pos",ShoppingBag,"order"],["/queue","queue",ListOrdered,"queue"],["/products","products",Package2,"admin"],["/stock","stock",Boxes,"stock"],["/costs","costs",Calculator,"admin"],["/expenses","expenses",ReceiptText,"report"],["/customers","customers",Users,"admin"],["/recipes","recipes",BookOpenCheck,"admin"],["/close","close",CalendarCheck2,"report"],["/orders","orders",ClipboardList,"order"],["/reports","reports",BarChart3,"report"],["/backup","backup",DatabaseBackup,"admin"],["/users","users",UserCog,"admin"],["/audit","audit",ScrollText,"admin"],["/settings","settings",Settings,"any"]] as const;
const primaryMobile=["/pos"];

export default function AppShell({children}:{children:React.ReactNode}){
  const path=usePathname(),lang=useAppStore(s=>s.language),t=dict[lang],[session,setSession]=useState<Session|null>(null),[moreOpen,setMoreOpen]=useState(false),[manageOpen,setManageOpen]=useState(false);
  const router=useRouter(),offlineRouteAllowed=!session?.offline||["/pos","/settings"].includes(path);
  const moreTriggerRef=useRef<HTMLButtonElement>(null);
  const moreDialogRef=useRef<HTMLDivElement>(null);

  useEffect(()=>{
    const logged=(e:Event)=>setSession((e as CustomEvent).detail||null),expired=()=>{clearSessionCache();setSession(null)};
    getSessionCached().then(setSession).catch(()=>{getOfflineOperatorIfReady().then(x=>{if(x)setSession(x)}).catch(()=>{})});
    window.addEventListener("field:session",logged);
    window.addEventListener("field:auth-expired",expired);
    return()=>{window.removeEventListener("field:session",logged);window.removeEventListener("field:auth-expired",expired)}
  },[]);
  useEffect(()=>{setMoreOpen(false);setManageOpen(false)},[path]);
  useEffect(()=>{
    if(!moreOpen)return;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    const dialog=moreDialogRef.current;
    const focusable=()=>Array.from(dialog?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])')||[]);
    window.requestAnimationFrame(()=>focusable()[0]?.focus());
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){
        event.preventDefault();
        setMoreOpen(false);
        window.requestAnimationFrame(()=>moreTriggerRef.current?.focus());
        return;
      }
      if(event.key!=="Tab")return;
      const items=focusable();
      if(!items.length){event.preventDefault();dialog?.focus();return}
      const first=items[0],last=items[items.length-1],active=document.activeElement;
      if(event.shiftKey&&(active===first||!dialog?.contains(active))){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&(active===last||!dialog?.contains(active))){event.preventDefault();first.focus()}
    };
    window.addEventListener("keydown",onKeyDown);
    return()=>{document.body.style.overflow=previousOverflow;window.removeEventListener("keydown",onKeyDown)};
  },[moreOpen]);
  useEffect(()=>{if(session?.offline&&!offlineRouteAllowed)router.replace("/pos")},[session?.offline,offlineRouteAllowed,router]);

  const closeMore=()=>{
    setMoreOpen(false);
    window.requestAnimationFrame(()=>moreTriggerRef.current?.focus());
  };

  const allowed=useMemo(()=>items.filter(([href, , ,access])=>session&&(session.offline?["/pos","/settings"].includes(href):(access==="any"||session.user.role==="admin"||session.user.permissions?.[access]===true))),[session]);
  const grouped=splitNavigation(allowed);
  const mobilePrimary=allowed.filter(([href])=>primaryMobile.includes(href)).sort((a,b)=>primaryMobile.indexOf(a[0])-primaryMobile.indexOf(b[0]));
  const mobileMore=mobileOverflow(allowed);
  const mobileGroups=splitNavigation(mobileMore);
  const moreActive=mobileMore.some(([href])=>path===href);
  const managementActive=[...grouped.operations,...grouped.management].some(([href])=>path===href);

  return <div className="field-app-root h-dvh w-full bg-[#e9edf2] p-1.5 pb-[70px] text-[#1d1d1f] sm:p-2 sm:pb-[76px] md:p-4 md:pb-4">
    <NetworkStatus/>
    <OperatorCoach operatorId={session?.user.id}/>
    <div className="flex h-full gap-2 sm:gap-3 md:gap-4">
      <aside className="glass card hidden w-[92px] shrink-0 flex-col items-center py-5 md:flex xl:w-[220px]">
        <div className="mb-6 flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-full border border-[#d4af37]/45 bg-[#d4af37]/10"><Sparkles size={19} className="gold"/></div><div className="hidden xl:block"><b className="tracking-[.3em]">FIELD</b><small className="block text-[10px] text-slate-500">CAFE POS</small></div></div>
        <nav aria-label="เมนูหลัก" className="soft-scroll w-full space-y-1 overflow-y-auto px-3">
          {grouped.front.map(([href,key,Icon])=><Link key={href} href={href} aria-label={t[key]} aria-current={path===href?"page":undefined} className={"flex items-center gap-3 rounded-full px-4 py-3 text-sm transition "+(path===href?"bg-[#d4af37]/16 text-[#6f5510] shadow-sm":"text-slate-600 hover:bg-slate-100 hover:text-slate-950")}><Icon size={18}/><span className="hidden xl:block">{t[key]}</span></Link>)}
          {(grouped.operations.length>0||grouped.management.length>0)&&<>
            <button type="button" aria-label="จัดการร้าน" aria-expanded={manageOpen} onClick={()=>setManageOpen(v=>!v)} className={"flex w-full items-center gap-3 rounded-full px-4 py-3 text-sm transition "+(managementActive||manageOpen?"bg-slate-100 font-bold text-slate-900":"text-slate-600 hover:bg-slate-100 hover:text-slate-950")}><MoreHorizontal size={18}/><span className="hidden min-w-0 flex-1 text-left xl:block">จัดการร้าน</span><ChevronDown size={14} className={"hidden transition xl:block "+(manageOpen?"rotate-180":"")}/></button>
            {manageOpen&&<div className="mt-1 space-y-3 rounded-2xl border border-slate-200 bg-white/75 p-2">
              {grouped.operations.length>0&&<div><p className="hidden px-2 pb-1 text-[9px] font-black tracking-[.14em] text-slate-400 xl:block">งานร้าน</p><div className="space-y-1">{grouped.operations.map(([href,key,Icon])=><Link key={href} href={href} aria-label={t[key]} aria-current={path===href?"page":undefined} className={"flex min-h-10 items-center gap-3 rounded-xl px-3 text-xs "+(path===href?"bg-[#d4af37]/16 font-bold text-[#6f5510]":"text-slate-600 hover:bg-slate-100")}><Icon size={16}/><span className="hidden xl:block">{t[key]}</span></Link>)}</div></div>}
              {grouped.management.length>0&&<div><p className="hidden px-2 pb-1 text-[9px] font-black tracking-[.14em] text-slate-400 xl:block">ตั้งค่าและหลังบ้าน</p><div className="space-y-1">{grouped.management.map(([href,key,Icon])=><Link key={href} href={href} aria-label={t[key]} aria-current={path===href?"page":undefined} className={"flex min-h-10 items-center gap-3 rounded-xl px-3 text-xs "+(path===href?"bg-[#d4af37]/16 font-bold text-[#6f5510]":"text-slate-600 hover:bg-slate-100")}><Icon size={16}/><span className="hidden xl:block">{t[key]}</span></Link>)}</div></div>}
            </div>}
          </>}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-hidden rounded-[20px] border border-slate-300/80 bg-[#f3f5f7] shadow-[0_10px_30px_rgba(15,23,42,.08)] sm:rounded-[24px] md:rounded-[32px]">{offlineRouteAllowed?children:<div className="grid h-full place-items-center p-6 text-center text-sm text-amber-800"><div><b>ออฟไลน์ · รับเงินสดเท่านั้น</b><p className="mt-2 text-xs text-slate-500">กำลังกลับหน้าขาย เพื่อป้องกันการใช้ข้อมูลคิวหรือรายการจาก Server ที่อาจไม่อัปเดต</p></div></div>}</main>
    </div>

    {mobileMore.length>0&&moreOpen&&<div className="fixed inset-0 z-[48] bg-black/20 md:hidden" onClick={closeMore}>
      <div ref={moreDialogRef} id="field-mobile-more" role="dialog" aria-modal="true" aria-label="เมนูอื่น" tabIndex={-1} className="frosted max-h-[calc(100dvh-110px)] overflow-y-auto overscroll-contain absolute bottom-[calc(70px+env(safe-area-inset-bottom))] left-2 right-2 rounded-[20px] p-2 shadow-2xl" onClick={e=>e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between px-2"><b className="text-xs">เมนูอื่น</b><button onClick={closeMore} className="grid h-11 w-11 place-items-center rounded-xl" aria-label="ปิดเมนูอื่น"><X size={17}/></button></div>
        <div className="grid gap-2">
          {mobileGroups.front.length>0&&<div className="grid gap-1"><p className="px-3 pt-2 text-[10px] font-black tracking-[.14em] text-slate-400">งานประจำวัน</p>{mobileGroups.front.map(([href,key,Icon])=><Link key={href} href={href} aria-label={t[key]} aria-current={path===href?"page":undefined} className={"flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm "+(path===href?"bg-[#d4af37]/18 font-bold text-[#6f5510]":"text-slate-700")}><Icon size={18}/><span>{t[key]}</span></Link>)}</div>}
          {mobileGroups.operations.length>0&&<div className="grid gap-1"><p className="px-3 pt-2 text-[10px] font-black tracking-[.14em] text-slate-400">งานร้าน</p>{mobileGroups.operations.map(([href,key,Icon])=><Link key={href} href={href} aria-label={t[key]} aria-current={path===href?"page":undefined} className={"flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm "+(path===href?"bg-[#d4af37]/18 font-bold text-[#6f5510]":"text-slate-700")}><Icon size={18}/><span>{t[key]}</span></Link>)}</div>}
          {mobileGroups.management.length>0&&<div className="grid gap-1"><p className="px-3 pt-2 text-[10px] font-black tracking-[.14em] text-slate-400">ตั้งค่าและหลังบ้าน</p>{mobileGroups.management.map(([href,key,Icon])=><Link key={href} href={href} aria-label={t[key]} aria-current={path===href?"page":undefined} className={"flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm "+(path===href?"bg-[#d4af37]/18 font-bold text-[#6f5510]":"text-slate-700")}><Icon size={18}/><span>{t[key]}</span></Link>)}</div>}
        </div>
      </div>
    </div>}

    {(mobilePrimary.length>0||mobileMore.length>0)&&<nav aria-label="เมนูหลักบนมือถือ" className="frosted fixed bottom-[max(.35rem,env(safe-area-inset-bottom))] left-1.5 right-1.5 z-50 flex items-stretch gap-0.5 overflow-hidden rounded-[20px] p-1 md:hidden">
      {mobilePrimary.map(([href,key,Icon])=><Link key={href} href={href} aria-label={t[key]} aria-current={path===href?"page":undefined} className={"flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[16px] px-1 py-1 text-[9px] "+(path===href?"bg-[#d4af37]/18 font-bold text-[#6f5510]":"text-slate-600")}><Icon size={17}/><span className="truncate">{t[key]}</span></Link>)}
      {mobileMore.length>0&&<button ref={moreTriggerRef} type="button" aria-controls="field-mobile-more" aria-expanded={moreOpen} onClick={()=>setMoreOpen(v=>!v)} className={"flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[16px] px-1 py-1 text-[9px] "+(moreActive||moreOpen?"bg-[#d4af37]/18 font-bold text-[#6f5510]":"text-slate-600")}><MoreHorizontal size={18}/><span>เมนูอื่น</span></button>}
    </nav>}
  </div>
}
