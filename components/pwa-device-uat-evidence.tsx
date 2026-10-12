"use client";

import {useEffect,useMemo,useState} from "react";
import {CheckCircle2,Circle,RotateCcw} from "lucide-react";
import {
  DEVICE_UAT_CHECK_IDS,clearDeviceUatEvidence,deviceUatProgress,
  readDeviceUatEvidence,writeDeviceUatCheck,type DeviceUatCheckId,type DeviceUatEvidence,type DeviceUatTargetClass
} from "@/lib/device-uat-evidence";

const labels:Record<DeviceUatCheckId,string>={
  layout_no_overlap:"Layout ไม่มีปุ่ม/ข้อความซ้อน และกดปุ่มสำคัญได้",
  keyboard_checkout:"เปิดคีย์บอร์ดแล้วช่องรับเงิน เงินทอน และปุ่มยืนยันยังเข้าถึงได้",
  offline_cold_start:"ปิด App แล้วเปิดใหม่ขณะ Offline ยังกลับเข้า POS Cash-safe ได้",
  reconnect_sync:"กลับ Online แล้ว Outbox sync สำเร็จครั้งเดียว ไม่มีขาย/ตัด Stock ซ้ำ",
  safe_update:"มี App update ระหว่างงานแล้วระบบรอจบ transaction ก่อน reload"
};

export default function PwaDeviceUatEvidence({buildSha,targetClass,installed}:{buildSha:string|null;targetClass:DeviceUatTargetClass;installed:boolean}){
  const [evidence,setEvidence]=useState<DeviceUatEvidence|null>(null);
  useEffect(()=>setEvidence(readDeviceUatEvidence(buildSha||"",targetClass)),[buildSha,targetClass]);
  const progress=useMemo(()=>deviceUatProgress(evidence),[evidence]);
  const matrixTarget=targetClass==="phone"||targetClass==="tablet";
  const localComplete=Boolean(buildSha)&&installed&&matrixTarget&&progress.complete;

  const toggle=(id:DeviceUatCheckId)=>{
    if(!buildSha)return;
    const next=writeDeviceUatCheck(buildSha,targetClass,id,evidence?.checks?.[id]!==true);
    if(next)setEvidence(next);
  };
  const reset=()=>{clearDeviceUatEvidence();setEvidence(readDeviceUatEvidence(buildSha||"",targetClass))};

  return <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 className="text-xs font-black tracking-widest text-slate-700">DEVICE UAT · LOCAL EVIDENCE</h3>
        <p className="mt-1 text-[11px] text-slate-500">ผูกกับ Build {buildSha?buildSha.slice(0,10):"—"} · {targetClass.toUpperCase()} · เก็บเฉพาะเครื่องนี้</p>
      </div>
      <button onClick={reset} disabled={!evidence} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-500 disabled:opacity-40" aria-label="ล้างผล Device UAT เครื่องนี้"><RotateCcw size={16}/></button>
    </div>

    <div className="mt-3 grid gap-2">
      {DEVICE_UAT_CHECK_IDS.map(id=>{
        const checked=evidence?.checks?.[id]===true;
        return <button key={id} type="button" disabled={!evidence} onClick={()=>toggle(id)} className={"flex min-h-11 items-start gap-3 rounded-xl border px-3 py-2 text-left text-xs disabled:opacity-50 "+(checked?"border-emerald-300 bg-emerald-50 text-emerald-900":"border-slate-200 bg-slate-50 text-slate-700")}>
          {checked?<CheckCircle2 size={18} className="mt-0.5 shrink-0"/>:<Circle size={18} className="mt-0.5 shrink-0"/>}
          <span>{labels[id]}</span>
        </button>
      })}
    </div>

    <div className={"mt-3 rounded-xl px-3 py-2 text-xs font-semibold "+(localComplete?"bg-emerald-50 text-emerald-800":"bg-amber-50 text-amber-800")}>
      {localComplete?"LOCAL EVIDENCE COMPLETE · "+progress.passed+"/"+progress.total:"LOCAL EVIDENCE "+progress.passed+"/"+progress.total+(installed?"":" · ต้องเปิดจาก Home Screen แบบ Standalone")+(matrixTarget?"":" · viewport นี้อยู่นอก Phone/Tablet UAT matrix")}
    </div>
    <p className="mt-2 text-[10px] leading-relaxed text-slate-500">รายการนี้เป็นการยืนยันโดยผู้ทดสอบบนเครื่องจริง และใช้ไม่ได้กับ Build SHA อื่น · ไม่ถือว่า Production-ready จน exact Preview smoke, UAT database, transaction regression และ release gate ผ่านครบ</p>
  </div>;
}
