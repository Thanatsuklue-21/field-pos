"use client";
import {useCallback,useEffect,useState} from "react";
import {Download,HardDrive,RefreshCw,Smartphone,Wifi,WifiOff} from "lucide-react";
import {PWA_INSTALL_REQUEST_EVENT,PWA_PERSIST_STORAGE_REQUEST_EVENT,PWA_REFRESH_EVENT,PWA_STATUS_EVENT,PWA_UPDATE_REQUEST_EVENT,type PwaSnapshot} from "@/lib/pwa-meta";

const badge=(ok:boolean)=>ok?"text-emerald-700":"text-amber-700";
type BuildInfo={buildSha:string|null;environment:string|null;databaseScope:string|null};
type BackendInfo={ready:boolean|null;status:number|null;error:string|null};

export default function PwaReadiness({serverRevision,promptPayReady}:{serverRevision?:number;promptPayReady?:boolean}){
  const [state,setState]=useState<PwaSnapshot|null>(null);
  const [build,setBuild]=useState<BuildInfo>({buildSha:null,environment:null,databaseScope:null});
  const [backend,setBackend]=useState<BackendInfo>({ready:null,status:null,error:null});

  const refresh=useCallback(()=>{
    window.dispatchEvent(new Event(PWA_REFRESH_EVENT));
    fetch("/api/build",{credentials:"same-origin",cache:"no-store"})
      .then(async res=>res.ok?await res.json():null)
      .then(data=>{if(data)setBuild({buildSha:typeof data.buildSha==="string"?data.buildSha:null,environment:typeof data.environment==="string"?data.environment:null,databaseScope:typeof data.databaseScope==="string"?data.databaseScope:null})})
      .catch(()=>{});
    fetch("/api/health",{credentials:"same-origin",cache:"no-store"})
      .then(async res=>{
        const data=await res.json().catch(()=>null);
        setBackend({ready:res.ok&&data?.ok===true,status:res.status,error:typeof data?.error==="string"?data.error:null});
      })
      .catch(()=>setBackend({ready:false,status:0,error:"network_unavailable"}));
  },[]);

  useEffect(()=>{
    const onStatus=(event:Event)=>setState((event as CustomEvent<PwaSnapshot>).detail);
    window.addEventListener(PWA_STATUS_EVENT,onStatus);
    refresh();
    return()=>window.removeEventListener(PWA_STATUS_EVENT,onStatus);
  },[refresh]);

  const shortSha=build.buildSha?build.buildSha.slice(0,10):"—";
  const viewportLabel=state?.viewportWidth&&state?.viewportHeight?state.viewportWidth+"×"+state.viewportHeight:"—";
  const visualViewportLabel=state?.visualViewportSupported?(state.visualViewportWidth&&state.visualViewportHeight?state.visualViewportWidth+"×"+state.visualViewportHeight:"SUPPORTED"):"UNSUPPORTED";
  const targetLabel=state?.targetClass==="phone"?"PHONE MATRIX":state?.targetClass==="tablet"?"TABLET MATRIX":"OTHER";
  const uatReady=build.environment==="preview"&&build.databaseScope==="uat"&&backend.ready===true;
  const uatLabel=build.environment==="preview"?(uatReady?"UAT READY":"UAT BLOCKED"):"N/A";
  const recoveryParts=[
    Number(state?.recoveryCartItems||0)>0?"Cart "+state?.recoveryCartItems:null,
    Number(state?.recoveryHeldBills||0)>0?"Held "+state?.recoveryHeldBills:null,
    state?.recoveryPromptPay?"PromptPay":null,
    state?.recoveryCash?"Cash":null,
    state?.recoveryCloseDay?"Close Day":null,
    state?.recoverySplit?"Split":null,
    state?.recoveryEditCash?"Edit":null
  ].filter(Boolean);
  const recoveryLabel=recoveryParts.length?recoveryParts.join(" · "):"CLEAR";
  return <div className="glass card p-4 sm:p-6">
    <div className="flex items-start justify-between gap-3">
      <div><h2 className="text-sm tracking-widest">PWA / DEVICE READINESS</h2><p className="mt-1 text-xs text-slate-500">สถานะเครื่องหน้าร้าน · App Shell / Offline / Update</p></div>
      <button onClick={refresh} className="grid h-11 w-11 place-items-center rounded-full border border-slate-200" aria-label="รีเฟรชสถานะเครื่อง"><RefreshCw size={16}/></button>
    </div>

    <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">{[
      ["Mode",state?.installed?"INSTALLED / STANDALONE":"BROWSER",state?.installed===true],
      ["Viewport",viewportLabel,Boolean(state?.viewportWidth&&state?.viewportHeight)],
      ["VisualViewport",visualViewportLabel,state?.visualViewportSupported===true],
      ["Touch",state?.touchCapable?"YES":"NO",state?.touchCapable===true],
      ["Orientation",state?.orientation||"—",Boolean(state?.orientation)],
      ["UAT Target",targetLabel,state?.targetClass==="phone"||state?.targetClass==="tablet"],
      ["PWA Installable",state?.installed?"INSTALLED":state?.installable?"READY":"NOT AVAILABLE",state?.installed===true||state?.installable===true],
      ["Service Worker",state?.serviceWorkerActive?"ACTIVE":"NOT ACTIVE",state?.serviceWorkerActive===true],
      ["App Update",state?.updateAvailable?"AVAILABLE":"CURRENT",state?.updateAvailable!==true],
      ["App Cache",state?.cacheReady?"READY":"EMPTY",state?.cacheReady===true],
      ["IndexedDB",state?.indexedDbReady?"READY":"UNAVAILABLE",state?.indexedDbReady===true],
      ["Offline Outbox",(state?.outboxPending||0)+" pending"+(Number(state?.outboxNeedsReview||0)>0?" · "+state?.outboxNeedsReview+" review":""),Number(state?.outboxPending||0)===0],
      ["Recovery",recoveryLabel,recoveryParts.length===0],
      ["Storage",state?.storagePersisted===true?"PERSISTENT":state?.storagePersistenceSupported?"BEST EFFORT":"UNSUPPORTED",state?.storagePersisted===true],
      ["App Version",state?.appVersion||"—",true],
      ["Build SHA",shortSha,Boolean(build.buildSha)],
      ["Environment",build.environment||"—",Boolean(build.environment)],
      ["Database Scope",build.databaseScope||"—",build.environment==="preview"?build.databaseScope==="uat":build.environment==="production"?build.databaseScope!=="uat":Boolean(build.databaseScope)],
      ["Transaction UAT",uatLabel,build.environment!=="preview"||uatReady],
      ["Backend / Turso",backend.ready===true?"READY":backend.ready===false?(build.environment==="preview"?"UAT BLOCKED":"NOT READY"):"CHECKING",backend.ready===true],
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
    {backend.ready===false&&<p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">{build.environment==="preview"&&backend.error==="turso_not_configured"?"Preview ยังไม่มี Turso UAT แยก · ห้ามใช้ Production DB กับ Preview · Transaction UAT ต้องรอ Preview/UAT database":build.environment==="preview"&&backend.error==="database_scope_invalid"?"Preview มี Database credential แล้ว แต่ยังไม่ยืนยันว่าเป็น UAT · ตั้ง FIELD_DB_SCOPE=uat ก่อนทดสอบ Transaction · ห้ามใช้ Production DB":backend.error==="database_scope_invalid"?"Database scope safety check ไม่ผ่าน · ตรวจ FIELD_DB_SCOPE ก่อนใช้งาน":backend.status===0?"ติดต่อ Backend ไม่ได้ · ตรวจ Network ก่อนทดสอบ Transaction":"Backend ยังไม่พร้อม · "+String(backend.error||("HTTP "+backend.status))}</p>}
    <p className="mt-2 text-[11px] text-slate-500">Device diagnostics ใช้เฉพาะขนาด viewport / touch / orientation เพื่อช่วย UAT และไม่เก็บ device model, user agent หรือ hardware fingerprint · ค่าเหล่านี้เป็นหลักฐานประกอบ ไม่ถือว่า Android acceptance ผ่านอัตโนมัติ</p>
    {state?.storageQuota&&<p className="mt-2 text-[11px] text-slate-500">Browser storage ใช้ประมาณ {(Number(state.storageUsage||0)/1048576).toFixed(1)} MB จาก quota {(Number(state.storageQuota)/1048576).toFixed(0)} MB · Persistent ช่วยลดความเสี่ยงที่ข้อมูล Offline ถูกล้างอัตโนมัติเมื่อพื้นที่เครื่องตึง</p>}
  </div>
}
