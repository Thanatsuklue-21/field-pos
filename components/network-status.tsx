"use client";
import {useEffect,useState} from "react";import {Cloud,CloudOff,Database,RefreshCw,TriangleAlert} from "lucide-react";
type Status="online"|"offline"|"cached"|"syncing"|"sync_error";
export default function NetworkStatus(){
  const [status,setStatus]=useState<Status>("online");
  useEffect(()=>{
    let syncState:Status|null=null;
    const sync=()=>setStatus(navigator.onLine?(syncState||"online"):"offline");
    const network=(event:Event)=>{
      const next=String((event as CustomEvent).detail?.status||"") as Status;
      if(["online","offline","cached"].includes(next))setStatus(next==="offline"?next:(syncState||next));
    };
    const outbox=(event:Event)=>{
      const next=String((event as CustomEvent).detail?.status||"") as Status;
      if(!["online","syncing","sync_error"].includes(next))return;
      syncState=next==="online"?null:next;
      setStatus(navigator.onLine?next:"offline");
    };
    sync();window.addEventListener("online",sync);window.addEventListener("offline",sync);
    window.addEventListener("field:network",network);window.addEventListener("field:sync",outbox);
    return()=>{window.removeEventListener("online",sync);window.removeEventListener("offline",sync);window.removeEventListener("field:network",network);window.removeEventListener("field:sync",outbox)};
  },[]);
if(status==="online")return <div className="fixed right-5 top-[max(1.25rem,env(safe-area-inset-top))] z-40 hidden items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-50/90 px-3 py-2 text-[10px] text-emerald-700 lg:flex"><Cloud size={13}/>ONLINE</div>;
const cfg=status==="syncing"?{Icon:RefreshCw,label:"SYNCING · กำลังส่งข้อมูล Offline",cls:"border-sky-300 bg-sky-50/95 text-sky-800"}:status==="sync_error"?{Icon:TriangleAlert,label:"SYNC ERROR · รายการยังถูกเก็บไว้",cls:"border-red-300 bg-red-50/95 text-red-700"}:status==="cached"?{Icon:Database,label:"OFFLINE · VIEWING CACHED MENU",cls:"border-amber-300 bg-amber-50/95 text-amber-800"}:{Icon:CloudOff,label:"OFFLINE · CASH SAFE MODE",cls:"border-amber-300 bg-amber-50/95 text-amber-800"};const Icon=cfg.Icon;return <div className={"fixed left-1/2 top-[max(.6rem,env(safe-area-inset-top))] z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full border px-4 py-2 text-xs shadow-[0_10px_28px_rgba(15,23,42,.10)] backdrop-blur "+cfg.cls}><Icon size={14} className={status==="syncing"?"animate-spin":""}/>{cfg.label}</div>}
