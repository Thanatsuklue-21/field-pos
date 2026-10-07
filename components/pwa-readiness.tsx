"use client";
import {useCallback,useEffect,useState} from "react";
import {Download,HardDrive,RefreshCw,Smartphone,Wifi,WifiOff} from "lucide-react";
import {PWA_INSTALL_REQUEST_EVENT,PWA_PERSIST_STORAGE_REQUEST_EVENT,PWA_REFRESH_EVENT,PWA_STATUS_EVENT,PWA_UPDATE_REQUEST_EVENT,type PwaSnapshot} from "@/lib/pwa-meta";

const badge=(ok:boolean)=>ok?"text-emerald-700":"text-amber-700";
type BuildInfo={buildSha:string|null;environment:string|null};

export default function PwaReadiness({serverRevision,promptPayReady}:{serverRevision?:number;promptPayReady?:boolean}){
  const [state,setState]=useState<PwaSnapshot|null>(null);
  const [build,setBuild]=useState<BuildInfo>({buildSha:null,environment:null});

  const refresh=useCallback(()=>{
    window.dispatchEvent(new Event(PWA_REFRESH_EVENT));
    fetch("/api/build",{credentials:"same-origin",cache:"no-store"})
      .then(async res=>res.ok?await res.json():null)
      .then(data=>{if(data)setBuild({buildSha:typeof data.buildSha==="string"?data.buildSha:null,environment:typeof data.environment==="string"?data.environment:null})})
      .catch(()=>{});
  },[]);

  useEffect(()=>{
    const onStatus=(event:Event)=>setState((event as CustomEvent<PwaSnapshot>).detail);
    window.addEventListener(PWA_STATUS_EVENT,onStatus);
    refresh();
    return()=>window.removeEventListener(PWA_STATUS_EVENT,onStatus);
  },[refresh]);

  const shortSha=build.buildSha?build.buildSha.slice(0,10):"—";
  return <div className="glass card p-4 sm:p-6">
    <div className="flex items-start justify-between gap-3">
      <div><h2 className="text-sm tracking-widest">PWA / DEVICE READINESS</h2><p className="mt-1 text-xs text-slate-500">สถานะเครื่องหน้าร้าน · App Shell / Offline / Update</p></div>
      <button onClick={refresh} className="grid h-11 w-11 place-items-center rounded-full border border-slate-200" aria-label="รีเฟรชสถานะเครื่อง"><RefreshCw size={16}/></button>
    </div>

    <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">{[
      ["Mode",state?.installed?"INSTALLED / STANDALONE":"BROWSER",state?.installed===true],
      ["Service Worker",state?.serviceWorkerActive?"ACTIVE":"NOT ACTIVE",state?.serviceWorkerActive===true],
      ["App Cache",state?.cacheReady?"READY":"EMPTY",state?.cacheReady===true],
      ["IndexedDB",state?.indexedDbReady?"READY":"UNAVAILABLE",state?.indexedDbReady===true],
      ["Offline Outbox",(state?.outboxPending||0)+" pending"+(Number(state?.outboxNeedsReview||0)>0?" · "+state?.outboxNeedsReview+" review":""),Number(state?.outboxPending||0)===0],
      ["Storage",state?.storagePersisted===true?"PERSISTENT":state?.storagePersistenceSupported?"BEST EFFORT":"UNSUPPORTED",state?.storagePersisted===true],
      ["App Version",state?.appVersion||"—",true],
      ["Build SHA",shortSha,Boolean(build.buildSha)],
      ["Environment",build.environment||"—",Boolean(build.environment)],
      ["Server Revision",String(serverRevision||0),true],
      ["PromptPay",promptPayReady?"READY":"NOT READY",promptPayReady===true]
    ].map(([label,value,ok])=><div key={String(label)} className="rounded-2xl bg-slate-50 p-3" title={label==="Build SHA"&&build.buildSha?build.buildSha:undefined}><small className="text-slate-500">{label}</small><div className={"mt-1 break-all font-semibold "+badge(Boolean(ok))}>{value}</div></div>)}
      <div className="rounded-2xl bg-slate-50 p-3"><small className="text-slate-500">Network</small><div className={"mt-1 flex items-center gap-1.5 font-semibold "+badge(state?.online===true)}>{state?.online?<Wifi size={14}/>:<WifiOff size={14}/>} {state?.online?"ONLINE":"OFFLINE"}</div></div>
    </div>

    <div className="mt-4 flex flex-wrap gap-2">
      {!state?.installed&&state?.installable&&<button onClick={()=>window.dispatchEvent(new Event(PWA_INSTALL_REQUEST_EVENT))} className="flex min-h-11 items-center gap-2 rounded-full bg-[#1F4D3A] px-4 text-xs font-bold text-white"><Download size={15}/>ติดตั้ง FIELD POS บนเครื่องนี้</button>}
      {!state?.installed&&!state?.installable&&<div className="flex min-h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-xs text-slate-600"><Smartphone size={15}/>Android Chrome: Browser menu → Add to Home screen / Install app</div>}
      {state?.storagePersistenceSupported&&state?.storagePersisted===false&&<button onClick={()=>window.dispatchEvent(new Event(PWA_PERSIST_STORAGE_REQUEST_EVENT))} className="flex min-h-11 items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-4 text-xs font-bold text-amber-800"><HardDrive size={15}/>ขอเก็บข้อมูล Offline แบบถาวร</button>}
      {state?.updateAvailable&&<button onClick={()=>window.dispatchEvent(new Event(PWA_UPDATE_REQUEST_EVENT))} className="min-h-11 rounded-full border border-amber-300 bg-amber-50 px-4 text-xs font-bold text-amber-800">อัปเดตเวอร์ชันเมื่อปลอดภัย</button>}
    </div>
    {state?.storageQuota&&<p className="mt-2 text-[11px] text-slate-500">Browser storage ใช้ประมาณ {(Number(state.storageUsage||0)/1048576).toFixed(1)} MB จาก quota {(Number(state.storageQuota)/1048576).toFixed(0)} MB · Persistent ช่วยลดความเสี่ยงที่ข้อมูล Offline ถูกล้างอัตโนมัติเมื่อพื้นที่เครื่องตึง</p>}
  </div>
}
