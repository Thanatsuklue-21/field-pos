"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {Download,Landmark} from "lucide-react";
import AuthGate from "@/components/auth-gate";
import {api} from "@/lib/api-client";
import {ResponsiveContainer,BarChart,Bar,XAxis,YAxis,Tooltip} from "recharts";

type Summary={today:string;todayRevenue:number;totalRevenue:number;grossProfit:number;grossMargin:number;profitEstimated:boolean;costQuality:{status:string};cups:number;daily:{date:string;revenue:number}[];inventoryValue:number;inventoryItems:number;inventoryValueEstimated:boolean;delivery:{gross:number;gpFees:number;netSettlement:number;orders:number};paymentSummary:{cash:number;promptpay:number;bank:number;card:number;other:number}};
type ExportData={exportedAt:number;sales:Record<string,unknown>[];expenses:Record<string,unknown>[];stock:Record<string,unknown>[];cashMovements:Record<string,unknown>[];inventorySummary:{value:number;items:number;isEstimated:boolean}};

export default function Reports(){return <AuthGate>{()=><ReportsView/>}</AuthGate>}

function escapeCsv(v:unknown){const s=String(v??"");return /[",\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s}
function toCsv(rows:Record<string,unknown>[]){
  if(!rows.length)return "";
  const headers=[...new Set(rows.flatMap(r=>Object.keys(r)))];
  return [headers.join(","),...rows.map(r=>headers.map(h=>escapeCsv(r[h])).join(","))].join("\n");
}
function downloadCsv(name:string,rows:Record<string,unknown>[]){
  const csv="\ufeff"+toCsv(rows),url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"})),a=document.createElement("a");
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function ReportsView(){
  const [d,setD]=useState<Summary|null>(null),[busy,setBusy]=useState(false),[msg,setMsg]=useState("");
  useEffect(()=>{api<Summary>("/api/reports/summary").then(setD).catch(()=>{})},[]);
  const k=[["ยอดขายวันนี้",d?.todayRevenue||0,"฿"],["ยอดขายรวม",d?.totalRevenue||0,"฿"],["กำไรขั้นต้น",d?.grossProfit||0,"฿"],["Gross Margin",d?.grossMargin||0,"%"],["มูลค่า Stock คงเหลือ",d?.inventoryValue||0,"฿"]];
  async function exportKind(kind:"sales"|"expenses"|"stock"|"cashMovements"){
    setBusy(true);setMsg("");
    try{
      const x=await api<ExportData>("/api/reports/accounting-export");
      downloadCsv("FIELD_"+kind+"_"+new Date().toISOString().slice(0,10)+".csv",x[kind]||[]);
      setMsg("Export "+kind+" สำเร็จ");
    }catch(e:any){setMsg(e.message||"export_failed")}finally{setBusy(false)}
  }
  return <section className="soft-scroll h-full overflow-auto p-3 sm:p-5 md:p-7">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="gold m-0 text-[10px] font-bold tracking-[.3em]">PERFORMANCE</p><h1 className="mt-1 text-xl font-semibold sm:text-2xl">REPORTS</h1><p className="mt-1 text-xs text-slate-500">ยอดขาย · กำไร · มูลค่าสต็อก · Export สำหรับบัญชี</p></div><div className="flex flex-wrap gap-2"><Link href="/settlements" className="flex min-h-10 items-center gap-1.5 rounded-full bg-[#d4af37] px-3 text-xs font-bold text-black"><Landmark size={14}/>Settlement</Link>{(["sales","expenses","stock","cashMovements"] as const).map(x=><button key={x} disabled={busy} onClick={()=>exportKind(x)} className="flex min-h-10 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 text-xs font-semibold disabled:opacity-40"><Download size={14}/>{x==="sales"?"Sales CSV":x==="expenses"?"Expenses CSV":x==="stock"?"Stock CSV":"Cash Drawer CSV"}</button>)}</div></div>
    {msg&&<p className="mt-3 rounded-xl bg-white px-3 py-2 text-sm">{msg}</p>}
    {d?.profitEstimated&&<div className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-50 p-4 text-sm text-amber-800"><b>ESTIMATED PROFIT</b><p className="mt-1 text-xs">กำไรและ Margin มีรายการต้นทุนที่ยังไม่ยืนยัน ({d.costQuality.status})</p></div>}
    {d?.inventoryValueEstimated&&<div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">มูลค่า Stock ยังเป็นค่าประมาณ เพราะมีวัตถุดิบบางรายการที่ต้นทุนยังไม่ยืนยัน</div>}
    <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-5">{k.map(([label,value,unit])=><div key={String(label)} className="glass card p-4 sm:p-5"><small className="text-xs text-slate-500">{label}</small><strong className="mt-3 block text-xl sm:text-2xl">{unit==="฿"?"฿":""}{Number(value).toLocaleString(undefined,{maximumFractionDigits:unit==="%"?1:2})}{unit==="%"?"%":""}</strong>{label==="มูลค่า Stock คงเหลือ"&&<small className="mt-1 block text-slate-500">{d?.inventoryItems||0} รายการที่มีของคงเหลือ</small>}</div>)}</div>
    {d?.paymentSummary&&<div className="mt-4 rounded-[24px] border border-slate-200 bg-white p-4"><p className="text-[10px] font-bold tracking-[.22em] text-slate-500">PAYMENT CHANNELS</p><h2 className="mt-1 text-base font-semibold">ยอดรับแยกตามช่องทาง</h2><div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-5">{[["เงินสด",d.paymentSummary.cash],["PromptPay",d.paymentSummary.promptpay],["โอนธนาคาร",d.paymentSummary.bank],["บัตร",d.paymentSummary.card],["อื่น ๆ",d.paymentSummary.other]].map(([label,value])=><div key={String(label)} className="rounded-2xl bg-slate-50 p-3"><small className="text-slate-500">{label}</small><b className="mt-1 block text-lg">฿{Number(value).toLocaleString()}</b></div>)}</div></div>}
    {d?.delivery&&d.delivery.orders>0&&<div className="mt-4 rounded-[24px] border border-slate-200 bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold tracking-[.22em] text-slate-500">DELIVERY SETTLEMENT</p><h2 className="mt-1 text-base font-semibold">ยอดรับจริงหลังหัก GP</h2></div><span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold">{d.delivery.orders} orders</span></div><div className="mt-3 grid grid-cols-3 gap-2 text-center"><div className="rounded-2xl bg-slate-50 p-3"><small className="text-slate-500">ยอดขายเต็ม</small><b className="mt-1 block text-lg">฿{d.delivery.gross.toLocaleString()}</b></div><div className="rounded-2xl bg-red-50 p-3"><small className="text-red-600">GP Fees</small><b className="mt-1 block text-lg text-red-700">−฿{d.delivery.gpFees.toLocaleString()}</b></div><div className="rounded-2xl bg-emerald-50 p-3"><small className="text-emerald-700">รับสุทธิ</small><b className="mt-1 block text-lg text-emerald-800">฿{d.delivery.netSettlement.toLocaleString()}</b></div></div></div>}
    <div className="mt-4 grid gap-4 xl:grid-cols-[2fr_1fr]"><div className="glass card p-5"><div className="mb-5"><p className="m-0 text-[10px] tracking-[.25em] text-slate-500">LAST 7 SALES DAYS</p><h2 className="mt-1 text-base">DAILY REVENUE</h2></div><div className="h-[310px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={d?.daily||[]}><XAxis dataKey="date" tick={{fill:"#8b8b8b",fontSize:11}} axisLine={false} tickLine={false}/><YAxis tick={{fill:"#8b8b8b",fontSize:11}} axisLine={false} tickLine={false}/><Tooltip contentStyle={{background:"#ffffff",color:"#1d1d1f",border:"1px solid rgba(60,60,67,.14)",borderRadius:16,boxShadow:"0 12px 32px rgba(15,23,42,.10)"}}/><Bar dataKey="revenue" fill="#d4af37" radius={[10,10,0,0]}/></BarChart></ResponsiveContainer></div></div><div className="glass card p-6"><p className="text-[10px] tracking-[.25em] text-slate-500">OPERATIONS</p><div className="mt-8"><small className="text-slate-500">Cups sold</small><div className="mt-2 text-4xl font-semibold gold">{d?.cups||0}</div></div><div className="mt-8 border-t border-slate-100 pt-6"><small className="text-slate-500">Accounting export</small><p className="mt-2 text-sm text-slate-600">CSV เป็น Non‑VAT: Sales, Expenses และ Stock valuation พร้อมส่งต่อคนทำบัญชีได้</p></div></div></div>
  </section>
}
