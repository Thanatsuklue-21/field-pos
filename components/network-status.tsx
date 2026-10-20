"use client";
import {useEffect,useState} from "react";
import {Cloud,CloudOff,Database} from "lucide-react";
type Status="online"|"offline"|"cached";
export default function NetworkStatus(){
  const [status,setStatus]=useState<Status>("online");
  useEffect(()=>{
    const sync=()=>setStatus(navigator.onLine?"online":"offline");
    const custom=(e:Event)=>setStatus((e as CustomEvent).detail?.status||"online");
    sync();window.addEventListener("online",sync);window.addEventListener("offline",sync);window.addEventListener("field:network",custom);
    return()=>{window.removeEventListener("online",sync);window.removeEventListener("offline",sync);window.removeEventListener("field:network",custom)};
  },[]);
  const Icon=status==="online"?Cloud:status==="cached"?Database:CloudOff;
  return <span aria-label="สถานะการเชื่อมต่อ" aria-live="polite" className={"pointer-events-none mt-0.5 inline-flex items-center gap-1 text-[10px] "+(status==="online"?"text-emerald-800":"font-semibold text-amber-900")}><Icon size={12} className="shrink-0"/><span>{status==="online"?"ออนไลน์":status==="cached"?"ออฟไลน์ · เมนูในเครื่อง":"ออฟไลน์ · ตรวจบิลรอส่ง"}</span></span>;
}
