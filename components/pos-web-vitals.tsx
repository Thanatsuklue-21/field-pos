"use client";

import {usePathname} from "next/navigation";
import {useReportWebVitals} from "next/web-vitals";
import type {Session} from "@/lib/api-client";

const TRACKED=new Set(["LCP","INP","CLS","TTFB"]);

export default function PosWebVitals({session}:{session:Session|null}){
  const path=usePathname();
  useReportWebVitals(metric=>{
    if(path!=="/pos"||!session||!TRACKED.has(metric.name))return;
    const connection=(navigator as Navigator&{connection?:{effectiveType?:string;saveData?:boolean}}).connection;
    const body={
      name:String(metric.name||"").slice(0,12),
      value:Number(metric.value),
      path,
      effectiveType:String(connection?.effectiveType||"unknown").slice(0,24),
      saveData:!!connection?.saveData
    };
    if(!Number.isFinite(body.value)||body.value<0)return;
    fetch("/api/telemetry/web-vitals",{
      method:"POST",
      headers:{"Content-Type":"application/json","X-CSRF-Token":session.csrf},
      credentials:"same-origin",
      cache:"no-store",
      keepalive:true,
      body:JSON.stringify(body)
    }).catch(()=>{});
  });
  return null;
}
