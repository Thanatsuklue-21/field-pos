"use client";
import {useEffect,useState} from "react";
import AuthGate from "@/components/auth-gate";
import {api} from "@/lib/api-client";
import {ResponsiveContainer,BarChart,Bar,XAxis,YAxis,Tooltip} from "recharts";

type Summary={today:string;todayRevenue:number;totalRevenue:number;grossProfit:number;grossMargin:number;profitEstimated:boolean;costQuality:{status:string};cups:number;daily:{date:string;revenue:number}[]};

export default function Reports(){return <AuthGate>{()=><ReportsView/>}</AuthGate>}

function ReportsView(){
  const [d,setD]=useState<Summary|null>(null);
  useEffect(()=>{api<Summary>("/api/reports/summary").then(setD).catch(()=>{})},[]);
  const k=[["ยอดขายวันนี้",d?.todayRevenue||0,"฿"],["ยอดขายรวม",d?.totalRevenue||0,"฿"],["กำไรขั้นต้น",d?.grossProfit||0,"฿"],["Gross Margin",d?.grossMargin||0,"%"]];
  return <section className="soft-scroll h-full overflow-auto p-5 md:p-7">
    <p className="gold m-0 text-[10px] font-bold tracking-[.3em]">PERFORMANCE</p><h1 className="mt-1 text-2xl font-semibold">REPORTS</h1>
    {d?.profitEstimated&&<div className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-400/[.08] p-4 text-sm text-amber-200"><b>ESTIMATED PROFIT</b><p className="mt-1 text-xs text-amber-100/70">กำไรและ Margin มีรายการต้นทุนที่ยังไม่ยืนยัน ({d.costQuality.status}) โปรดใช้ประกอบการตัดสินใจชั่วคราว</p></div>}
    <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">{k.map(([label,value,unit])=><div key={String(label)} className="glass card p-5"><small className="text-xs text-slate-500">{label}</small><strong className="mt-3 block text-2xl">{unit==="฿"?"฿":""}{Number(value).toLocaleString(undefined,{maximumFractionDigits:unit==="%"?1:0})}{unit==="%"?"%":""}</strong></div>)}</div>
    <div className="mt-4 grid gap-4 xl:grid-cols-[2fr_1fr]"><div className="glass card p-5"><div className="mb-5"><p className="m-0 text-[10px] tracking-[.25em] text-slate-500">LAST 7 SALES DAYS</p><h2 className="mt-1 text-base">DAILY REVENUE</h2></div><div className="h-[310px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={d?.daily||[]}><XAxis dataKey="date" tick={{fill:"#8b8b8b",fontSize:11}} axisLine={false} tickLine={false}/><YAxis tick={{fill:"#8b8b8b",fontSize:11}} axisLine={false} tickLine={false}/><Tooltip contentStyle={{background:"#ffffff",color:"#1d1d1f",border:"1px solid rgba(60,60,67,.14)",borderRadius:16,boxShadow:"0 12px 32px rgba(15,23,42,.10)"}}/><Bar dataKey="revenue" fill="#d4af37" radius={[10,10,0,0]}/></BarChart></ResponsiveContainer></div></div><div className="glass card p-6"><p className="text-[10px] tracking-[.25em] text-slate-500">OPERATIONS</p><div className="mt-8"><small className="text-slate-500">Cups sold</small><div className="mt-2 text-4xl font-semibold gold">{d?.cups||0}</div></div><div className="mt-8 border-t border-slate-100 pt-6"><small className="text-slate-500">Data source</small><p className="mt-2 text-sm">Turso · FIELD server state</p></div></div></div>
  </section>
}
