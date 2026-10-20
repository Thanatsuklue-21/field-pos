"use client";
import Link from "next/link";
export type CatalogReadiness={status:"REVIEW"|"READY";activeMenus:number;availableMenus:number;issues:Array<{code:string;title:string;href:string;action:string;count:number;items:Array<{name:string;detail:string}>}>};
export default function CatalogReadinessCard({data}:{data?:CatalogReadiness}){
 if(!data)return null;
 return <section aria-label="ความพร้อมข้อมูลก่อนขาย" className="glass card mt-4 min-w-0 border border-slate-200 bg-white p-4 sm:p-5">
  <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="text-base font-bold">ข้อมูลพร้อมขายหรือยัง?</h2><p className="mt-1 text-xs text-slate-600">ขายได้ {data.availableMenus} จาก {data.activeMenus} เมนูที่เปิดไว้ · ตรวจข้อมูลปัจจุบันแบบไม่แก้ยอด</p></div><span className={"rounded-full px-3 py-1 text-xs font-bold "+(data.status==="READY"?"bg-emerald-50 text-emerald-800":"bg-amber-50 text-amber-900")}>{data.status==="READY"?"ตรวจข้อมูลหลักแล้ว":"มีข้อมูลต้องตรวจ"}</span></div>
  <p className="mt-2 text-xs text-slate-600">ผลตรวจระบบปกติไม่ได้ยืนยันว่าทุกเมนูมีของพร้อมขาย · ยืนยันของจริงและสูตรก่อนเปิดขาย</p>
  {data.issues.length?<div className="mt-3 space-y-2">{data.issues.map(issue=><details key={issue.code} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3"><summary className="min-h-11 cursor-pointer text-sm font-bold text-slate-800">{issue.title} · {issue.count} รายการ</summary><ul className="mt-2 space-y-2 text-xs text-slate-700">{issue.items.map((item,index)=><li key={index} className="break-words"><b>{item.name}</b><p className="mt-0.5">{item.detail}</p></li>)}</ul>{issue.count>issue.items.length&&<p className="mt-2 text-xs text-slate-600">แสดง {issue.items.length} จาก {issue.count} รายการ · เปิดหน้าตรวจเพื่อดูทั้งหมด</p>}<Link href={issue.href} className="mt-3 flex min-h-11 items-center justify-center rounded-xl border border-[#d4af37] bg-[#fff8dc] px-3 text-sm font-bold text-[#6f5510]">{issue.action}</Link></details>)}</div>:<p className="mt-3 text-sm text-emerald-800">ไม่พบปัญหาหลักด้านเมนู ราคา สูตร สต็อก และต้นทุนจากข้อมูลที่ตรวจ</p>}
 </section>;
}
