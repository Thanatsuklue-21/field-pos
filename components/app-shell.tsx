"use client";
import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {BarChart3,ClipboardList,ListOrdered,Package2,Settings,ShoppingBag,Sparkles,Boxes,LayoutDashboard,ReceiptText,Users,BookOpenCheck,CalendarCheck2,DatabaseBackup,UserCog,ScrollText,Calculator,ShieldCheck,MoreHorizontal,X} from "lucide-react";
import {useAppStore} from "@/stores/app-store";
import {dict} from "@/lib/i18n";
import NetworkStatus from "@/components/network-status";
import AiSupervisor from "@/components/ai-supervisor";
import {clearSessionCache,getSessionCached,type Session} from "@/lib/api-client";

const items=[["/dashboard","dashboard",LayoutDashboard,"report"],["/control","control",ShieldCheck,"admin"],["/pos","pos",ShoppingBag,"order"],["/queue","queue",ListOrdered,"queue"],["/products","products",Package2,"admin"],["/stock","stock",Boxes,"stock"],["/costs","costs",Calculator,"admin"],["/expenses","expenses",ReceiptText,"report"],["/customers","customers",Users,"admin"],["/recipes","recipes",BookOpenCheck,"admin"],["/close","close",CalendarCheck2,"report"],["/orders","orders",ClipboardList,"order"],["/reports","reports",BarChart3,"report"],["/backup","backup",DatabaseBackup,"admin"],["/users","users",UserCog,"admin"],["/audit","audit",ScrollText,"admin"],["/settings","settings",Settings,"any"]] as const;
const focusPrimary=["/pos","/queue","/orders","/stock","/close"];
const primaryMobile=["/pos","/queue"];
const mobileMorePriority=["/orders","/stock","/expenses","/close","/settings"];

export default function AppShell({children}:{children:React.ReactNode}){
  const path=usePathname(),lang=useAppStore(s=>s.language),t=dict[lang],[session,setSession]=useState<Session|null>(null),[moreOpen,setMoreOpen]=useState(false),[manageOpen,setManageOpen]=useState(false);
  useEffect(()=>{const logged=(e:Event)=>setSession((e as CustomEvent).detail||null),expired=()=>{clearSessionCache();setSession(null)};getSessionCached().then(setSession).catch(()=>{});window.addEventListener("field:session",logged);window.addEventListener("field:auth-expired",expired);return()=>{window.removeEventListener("field:session",logged);window.removeEventListener("field:auth-expired",expired)}},[]);
  useEffect(()=>{setMoreOpen(false);setManageOpen(!focusPrimary.includes(path))},[path]);

  const allowed=useMemo(()=>items.filter(([, , ,access])=>session&&(access==="any"||session.user.role==="admin"||session.user.permissions?.[access]===true)),[session]);
  const desktopPrimary=allowed.filter(([href])=>focusPrimary.includes(href)).sort((a,b)=>focusPrimary.indexOf(a[0])-focusPrimary.indexOf(b[0]));
  const desktopManage=allowed.filter(([href])=>!focusPrimary.includes(href));
  const desktopManageActive=desktopManage.some(([href])=>path===href);
  const mobilePrimary=allowed.filter(([href])=>primaryMobile.includes(href)).sort((a,b)=>primaryMobile.indexOf(a[0])-primaryMobile.indexOf(b[0]));
  const mobileMore=allowed.filter(([href])=>!primaryMobile.includes(href)).sort((a,b)=>{
    const ai=mobileMorePriority.indexOf(a[0]),bi=mobileMorePriority.indexOf(b[0]);
    return (ai<0?mobileMorePriority.length:ai)-(bi<0?mobileMorePriority.length:bi);
  });
  const moreActive=mobileMore.some(([href])=>path===href);

  return <div className="field-app-root h-dvh w-full bg-[#e9edf2] p-1.5 pb-[70px] text-[#1d1d1f] sm:p-2 sm:pb-[76px] md:p-4 md:pb-4">
    <NetworkStatus/>
    <div className="flex h-full gap-2 sm:gap-3 md:gap-4">
      <aside className="glass card hidden w-[92px] shrink-0 flex-col items-center py-5 md:flex xl:w-[220px]">
        <div className="mb-5 flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-full border border-[#d4af37]/45 bg-[#d4af37]/10"><Sparkles size={19} className="gold"/></div><div className="hidden xl:block"><b className="tracking-[.3em]">FIELD</b><small className="block text-[10px] text-slate-500">CAFE POS</small></div></div>
        <div className="hidden w-full px-5 pb-2 text-[9px] font-bold uppercase tracking-[.18em] text-slate-400 xl:block">งานประจำวัน</div>
        <nav aria-label="งานประจำวัน" className="soft-scroll w-full space-y-1 overflow-y-auto px-3">
          {desktopPrimary.map(([href,key,Icon])=><Link key={href} href={href} aria-current={path===href?"page":undefined} className={"flex min-h-11 items-center gap-3 rounded-full px-4 py-2.5 text-sm transition "+(path===href?"bg-[#d4af37]/16 font-semibold text-[#6f5510] shadow-sm":"text-slate-600 hover:bg-slate-100 hover:text-slate-950")}><Icon size={18}/><span className="hidden xl:block">{t[key]}</span></Link>)}
          {desktopManage.length>0&&<div className="pt-2">
            <button type="button" aria-expanded={manageOpen} aria-controls="field-desktop-manage" aria-label="จัดการร้านและตั้งค่า" onClick={()=>setManageOpen(v=>!v)} className={"flex min-h-11 w-full items-center gap-3 rounded-full px-4 py-2.5 text-sm transition "+(desktopManageActive||manageOpen?"bg-slate-100 font-semibold text-slate-800":"text-slate-500 hover:bg-slate-100 hover:text-slate-950")}><MoreHorizontal size={18}/><span className="hidden xl:block">จัดการร้าน</span></button>
            {manageOpen&&<div id="field-desktop-manage" className="mt-1 space-y-1 border-t border-slate-200/80 pt-2">
              {desktopManage.map(([href,key,Icon])=><Link key={href} href={href} aria-current={path===href?"page":undefined} className={"flex min-h-11 items-center gap-3 rounded-full px-4 py-2.5 text-sm transition "+(path===href?"bg-[#d4af37]/16 font-semibold text-[#6f5510] shadow-sm":"text-slate-600 hover:bg-slate-100 hover:text-slate-950")}><Icon size={18}/><span className="hidden xl:block">{t[key]}</span></Link>)}
            </div>}
          </div>}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-hidden rounded-[20px] border border-slate-300/80 bg-[#f3f5f7] shadow-[0_10px_30px_rgba(15,23,42,.08)] sm:rounded-[24px] md:rounded-[32px]">{children}</main>
    </div>

    <AiSupervisor session={session}/>

    {mobileMore.length>0&&moreOpen&&<div className="fixed inset-0 z-[48] bg-black/20 md:hidden" onClick={()=>setMoreOpen(false)}>
      <div className="frosted absolute bottom-[calc(70px+env(safe-area-inset-bottom))] left-2 right-2 rounded-[20px] p-2 shadow-2xl" onClick={e=>e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between px-2"><div><b className="text-sm">เพิ่มเติม</b><p className="mt-0.5 text-[10px] text-slate-500">ประวัติ สต็อก รายจ่าย ปิดวัน และการตั้งค่าร้าน</p></div><button onClick={()=>setMoreOpen(false)} className="grid h-11 w-11 place-items-center rounded-xl" aria-label="ปิดเมนูเพิ่มเติม"><X size={17}/></button></div>
        <div className="grid gap-1">{mobileMore.map(([href,key,Icon])=><Link key={href} href={href} className={"flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm "+(path===href?"bg-[#d4af37]/18 font-bold text-[#6f5510]":"text-slate-700")}><Icon size={18}/><span>{t[key]}</span></Link>)}</div>
      </div>
    </div>}

    {(mobilePrimary.length>0||mobileMore.length>0)&&<nav className="frosted fixed bottom-[max(.35rem,env(safe-area-inset-bottom))] left-1.5 right-1.5 z-50 flex items-stretch gap-0.5 overflow-hidden rounded-[20px] p-1 md:hidden">
      {mobilePrimary.map(([href,key,Icon])=><Link key={href} href={href} className={"flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[16px] px-1 py-1 text-[9px] "+(path===href?"bg-[#d4af37]/18 font-bold text-[#6f5510]":"text-slate-600")}><Icon size={17}/><span className="truncate">{t[key]}</span></Link>)}
      {mobileMore.length>0&&<button type="button" aria-expanded={moreOpen} onClick={()=>setMoreOpen(v=>!v)} className={"flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[16px] px-1 py-1 text-[9px] "+(moreActive||moreOpen?"bg-[#d4af37]/18 font-bold text-[#6f5510]":"text-slate-600")}><MoreHorizontal size={18}/><span>เพิ่มเติม</span></button>}
    </nav>}
  </div>
}
