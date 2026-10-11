"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import Link from "next/link";
import {Boxes,ClipboardList,ListOrdered,Plus,ReceiptText,RefreshCw,X} from "lucide-react";
import {api,type Bootstrap,type Session} from "@/lib/api-client";
import {formatMoney} from "@/lib/money-format.mjs";
import {shouldRetainExpensePending} from "@/lib/expense-recovery.mjs";
import {currentBusinessDate,expenseErrorText,readPendingExpense,sendExpenseDurably,type ExpenseBody,type PendingExpense} from "@/lib/expense-client";

type HubTab="queue"|"orders"|"stock"|"expenses";
type QueueOrder={id:string;queueNo:string;pagerNo:number;status:string;time:number;items:{name:string;qty:number;readyQty?:number;calledQty?:number}[]};
type Sale={id:string;billNo:string;date:string;time:number;total:number;payment:string;status:string;queueNo:string;itemCount:number;orderStatus?:string|null};
type ExpenseRow={id:string;date:string;time:number;category:string;description:string;amount:number;paymentMethod?:string;sourceType?:string};
const n=(v:any)=>Number(v)||0;
const paymentLabel=(v?:string)=>v==="cash"?"เงินสด":v==="bank"?"โอน/ธนาคาร":v==="other"?"อื่น ๆ":String(v||"—").toUpperCase();

export default function PosOperationsHub({session,bootstrap,open,onClose}:{session:Session;bootstrap:Bootstrap|null;open:boolean;onClose:()=>void}){
  const canQueue=session.user.role==="admin"||session.user.permissions?.queue===true;
  const canOrder=session.user.role==="admin"||session.user.permissions?.order===true;
  const canStock=session.user.role==="admin"||session.user.permissions?.stock===true;
  const canExpense=session.user.role==="admin"||session.user.permissions?.report===true;
  const availableTabs=useMemo(()=>[
    canQueue&&"queue",canOrder&&"orders",canStock&&"stock",canExpense&&"expenses"
  ].filter(Boolean) as HubTab[],[canQueue,canOrder,canStock,canExpense]);
  const [tab,setTab]=useState<HubTab>(availableTabs[0]||"orders");
  const [queue,setQueue]=useState<QueueOrder[]>([]);
  const [sales,setSales]=useState<Sale[]>([]);
  const [expenses,setExpenses]=useState<ExpenseRow[]>([]);
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState("");
  const [expenseBusy,setExpenseBusy]=useState(false);
  const [expenseAmount,setExpenseAmount]=useState("");
  const [expenseCategory,setExpenseCategory]=useState("OTHER");
  const [expenseDescription,setExpenseDescription]=useState("");
  const [expensePayment,setExpensePayment]=useState("cash");
  const expenseRecoveryRef=useRef(false);

  useEffect(()=>{if(!availableTabs.includes(tab)&&availableTabs[0])setTab(availableTabs[0])},[availableTabs.join("|"),tab]);

  async function refresh(){
    if(session.offline){setMessage("OFFLINE · ดูสถานะจากข้อมูลเมนู/สต็อกที่ cache ไว้ได้ แต่คิว ออเดอร์ และรายจ่ายต้องรอเชื่อมต่อ");return}
    setLoading(true);setMessage("");
    try{
      const tasks:Promise<any>[]=[];
      const names:string[]=[];
      if(canQueue){tasks.push(api<any>("/api/pos/queue"));names.push("queue")}
      if(canOrder){tasks.push(api<any>("/api/pos/history"));names.push("orders")}
      if(canExpense){tasks.push(api<any>("/api/expenses"));names.push("expenses")}
      const settled=await Promise.allSettled(tasks);
      settled.forEach((result,index)=>{
        if(result.status!=="fulfilled")return;
        const name=names[index],value=result.value;
        if(name==="queue")setQueue(Array.isArray(value.orders)?value.orders:[]);
        if(name==="orders")setSales(Array.isArray(value.sales)?value.sales:[]);
        if(name==="expenses")setExpenses(Array.isArray(value.expenses)?value.expenses:[]);
      });
      if(settled.some(x=>x.status==="rejected"))setMessage("บางข้อมูลยังโหลดไม่ได้ · หน้าขายยังใช้งานต่อได้ตามปกติ");
    }finally{setLoading(false)}
  }

  async function recoverExpense(){
    if(!canExpense||session.offline||expenseRecoveryRef.current)return;
    let pending:PendingExpense|null=null;
    try{pending=readPendingExpense()}catch(e:any){setMessage(expenseErrorText(e.message));return}
    if(!pending)return;
    expenseRecoveryRef.current=true;setExpenseBusy(true);
    try{
      await sendExpenseDurably(session.csrf,pending.body);
      setMessage("กู้คืนค่าใช้จ่ายเดิมสำเร็จ · ไม่บันทึกซ้ำ");
      await refresh();
    }catch(e:any){
      setMessage(shouldRetainExpensePending(e)?"ค่าใช้จ่ายเดิมยังไม่ทราบผล · ระบบเก็บ request เดิมไว้และจะตรวจซ้ำ":expenseErrorText(e.message));
    }finally{expenseRecoveryRef.current=false;setExpenseBusy(false)}
  }

  useEffect(()=>{
    if(!open)return;
    const sync=()=>{refresh().catch(()=>setMessage("โหลดข้อมูลร้านไม่สำเร็จ · หน้าขายยังใช้งานต่อได้"));recoverExpense().catch(()=>{})};
    const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape")onClose()};
    const onOnline=()=>sync();
    const onFocus=()=>sync();
    const onVisible=()=>{if(document.visibilityState==="visible")sync()};
    sync();
    window.addEventListener("keydown",onKey);
    if(session.offline)return()=>window.removeEventListener("keydown",onKey);
    const timer=window.setInterval(()=>refresh().catch(()=>{}),5000);
    window.addEventListener("online",onOnline);
    window.addEventListener("focus",onFocus);
    document.addEventListener("visibilitychange",onVisible);
    return()=>{
      window.clearInterval(timer);
      window.removeEventListener("keydown",onKey);
      window.removeEventListener("online",onOnline);
      window.removeEventListener("focus",onFocus);
      document.removeEventListener("visibilitychange",onVisible);
    };
  },[open,session.csrf,session.offline,canQueue,canOrder,canExpense]);

  async function saveExpense(){
    if(!(Number(expenseAmount)>0)||expenseBusy||session.offline)return;
    setExpenseBusy(true);setMessage("");
    const body:ExpenseBody={
      requestKey:crypto.randomUUID(),date:currentBusinessDate(),amount:Number(expenseAmount),
      category:expenseCategory.trim().slice(0,60),description:expenseDescription.trim().slice(0,240),
      paymentMethod:expensePayment.trim().toLowerCase()
    };
    try{
      const r=await sendExpenseDurably(session.csrf,body);
      setExpenseAmount("");setExpenseDescription("");setExpensePayment("cash");
      setExpenses(prev=>[r.expense,...prev.filter(x=>x.id!==r.expense.id)]);
      setMessage("บันทึกค่าใช้จ่ายแล้ว · อยู่หน้า POS ต่อได้เลย");
    }catch(e:any){setMessage(expenseErrorText(e.message))}
    finally{setExpenseBusy(false)}
  }

  const queueRows=queue.slice().sort((a,b)=>n(a.time)-n(b.time)).slice(0,6);
  const latestSales=sales.slice(0,7);
  const latestExpenses=expenses.slice(0,5);
  const stockRows=useMemo(()=>{
    const rows:{key:string;name:string;variant:string;level:"out"|"low";detail:string}[]=[];
    for(const menu of bootstrap?.menu||[])for(const variant of menu.variants||[]){
      if(!variant.available){
        const missing=(variant.missingIngredients||[]).map(x=>x.name).join(", ");
        rows.push({key:menu.id+"|"+variant.label,name:menu.name,variant:variant.label,level:"out",detail:missing||variant.reason||"ทำไม่ได้"});
      }else if(variant.lowStock)rows.push({key:menu.id+"|"+variant.label,name:menu.name,variant:variant.label,level:"low",detail:"ทำได้ประมาณ "+variant.maxServings+" แก้ว"});
    }
    return rows.slice(0,12);
  },[bootstrap?.revision]);
  const outCount=stockRows.filter(x=>x.level==="out").length,lowCount=stockRows.filter(x=>x.level==="low").length;

  if(!open)return null;
  const tabMeta:{key:HubTab;label:string;icon:any;count?:number;allowed:boolean}[]=[
    {key:"queue",label:"คิว",icon:ListOrdered,count:queue.length,allowed:canQueue},
    {key:"orders",label:"ออเดอร์",icon:ClipboardList,count:sales.length,allowed:canOrder},
    {key:"stock",label:"สต็อก",icon:Boxes,count:outCount+lowCount,allowed:canStock},
    {key:"expenses",label:"รายจ่าย",icon:ReceiptText,allowed:canExpense}
  ];

  return <div className="fixed inset-0 z-[90] bg-black/35" onClick={onClose}>
    <aside role="dialog" aria-modal="true" aria-label="ศูนย์งานร้าน FIELD" onClick={e=>e.stopPropagation()} className="absolute inset-x-0 bottom-0 flex h-[88dvh] w-full flex-col rounded-t-[28px] bg-[#f6f7f8] shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:w-[520px] sm:rounded-none sm:border-l sm:border-slate-300">
      <header className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-4 sm:px-5">
        <div><p className="m-0 text-[10px] font-black tracking-[.22em] text-[#765b08]">FIELD OPERATIONS</p><h2 className="mt-1 text-xl font-black text-slate-900">งานร้าน</h2><p className="mt-1 text-xs text-slate-500">ดูงานหลักและบันทึกรายจ่ายด่วนโดยไม่ออกจากหน้า POS</p></div>
        <div className="flex gap-1"><button disabled={loading} onClick={()=>refresh()} aria-label="รีเฟรชงานร้าน" className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white disabled:opacity-40"><RefreshCw size={17}/></button><button onClick={onClose} aria-label="ปิดงานร้าน" className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white"><X size={18}/></button></div>
      </header>

      <div className="grid grid-cols-4 gap-1 border-b border-slate-200 bg-white p-2">
        {tabMeta.filter(x=>x.allowed).map(({key,label,icon:Icon,count})=><button key={key} onClick={()=>setTab(key)} className={"relative flex min-h-12 flex-col items-center justify-center rounded-xl px-1 text-[10px] font-bold "+(tab===key?"bg-[#d4af37]/20 text-[#6f5510]":"text-slate-600 hover:bg-slate-100")}><Icon size={17}/><span className="mt-0.5">{label}</span>{Number(count)>0&&<span className="absolute right-2 top-1 rounded-full bg-slate-900 px-1.5 text-[9px] text-white">{count}</span>}</button>)}
      </div>

      {message&&<div className="mx-3 mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">{message}</div>}

      <div className="soft-scroll min-h-0 flex-1 overflow-auto overscroll-contain p-3 sm:p-4">
        {tab==="queue"&&canQueue&&<div className="space-y-2">
          {queueRows.length===0?<Empty text={session.offline?"ออฟไลน์ · ยังไม่ดึงคิวจาก Server":"ไม่มีคิวที่กำลังทำ"}/>:queueRows.map(order=>{
            const total=(order.items||[]).reduce((s,x)=>s+n(x.qty),0),ready=(order.items||[]).reduce((s,x)=>s+Math.min(n(x.qty),n(x.readyQty)),0),called=(order.items||[]).reduce((s,x)=>s+Math.min(n(x.qty),n(x.calledQty)),0);
            return <div key={order.id} className="rounded-2xl border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-3"><div><b className="text-base">{order.queueNo}</b><span className="ml-2 text-xs text-slate-500">บัตร {order.pagerNo||"—"}</span></div><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase">{order.status}</span></div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs"><Metric label="ทั้งหมด" value={total}/><Metric label="ทำแล้ว" value={ready}/><Metric label="เรียกแล้ว" value={called}/></div>
              <p className="mt-2 line-clamp-2 text-xs text-slate-500">{(order.items||[]).map(x=>x.name+" ×"+x.qty).join(" · ")}</p>
            </div>
          })}
          <FullLink href="/queue" label="เปิดหน้าคิวเต็ม / ทำเครื่องดื่ม"/>
        </div>}

        {tab==="orders"&&canOrder&&<div className="space-y-2">
          {latestSales.length===0?<Empty text="ยังไม่มีออเดอร์ล่าสุด"/>:latestSales.map(s=><div key={s.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3">
            <div className="min-w-0"><div><b>{s.queueNo||s.billNo}</b><span className="ml-2 text-[10px] uppercase text-slate-500">{s.payment}</span></div><p className="mt-1 truncate text-xs text-slate-500">{s.itemCount} รายการ · {s.status}{s.orderStatus?" · "+s.orderStatus:""}</p></div><b className="shrink-0 text-[#765b08]">฿{formatMoney(s.total)}</b>
          </div>)}
          <FullLink href="/orders" label="เปิดประวัติออเดอร์เต็ม"/>
        </div>}

        {tab==="stock"&&canStock&&<div className="space-y-2">
          <div className="grid grid-cols-2 gap-2"><MetricCard label="ทำไม่ได้" value={outCount} tone="danger"/><MetricCard label="ใกล้หมด" value={lowCount} tone="warn"/></div>
          {stockRows.length===0?<Empty text="เมนูที่ขายอยู่ยังไม่พบสัญญาณสต็อกต่ำ"/>:stockRows.map(row=><div key={row.key} className={"rounded-2xl border p-3 "+(row.level==="out"?"border-red-200 bg-red-50":"border-amber-200 bg-amber-50")}>
            <div className="flex items-start justify-between gap-2"><div><b className="text-sm">{row.name}</b><p className="mt-0.5 text-[11px] text-slate-500">{row.variant}</p></div><span className={"rounded-full px-2 py-1 text-[9px] font-black "+(row.level==="out"?"bg-red-100 text-red-700":"bg-amber-100 text-amber-800")}>{row.level==="out"?"พักขาย":"LOW"}</span></div>
            <p className="mt-2 text-xs text-slate-700">{row.detail}</p>
          </div>)}
          <FullLink href="/stock" label="เปิด Stock เต็ม / รับเข้า / นับจริง"/>
        </div>}

        {tab==="expenses"&&canExpense&&<div className="space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2"><Plus size={16}/><b>เพิ่มค่าใช้จ่ายด่วน</b></div>
            <div className="mt-3 grid gap-2">
              <div className="grid grid-cols-2 gap-2"><select value={expenseCategory} onChange={e=>setExpenseCategory(e.target.value)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-xs"><option value="OTHER">อื่น ๆ</option><option value="UTILITY">ค่าน้ำ/ไฟ</option><option value="MAINTENANCE">ซ่อมบำรุง</option><option value="PACKAGING">บรรจุภัณฑ์ฉุกเฉิน</option><option value="MARKETING">การตลาด</option><option value="TRANSPORT">ขนส่ง</option></select><select value={expensePayment} onChange={e=>setExpensePayment(e.target.value)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-xs"><option value="cash">เงินสด</option><option value="bank">โอน</option><option value="other">อื่น ๆ</option></select></div>
              <input inputMode="decimal" value={expenseAmount} onChange={e=>setExpenseAmount(e.target.value)} placeholder="จำนวนเงิน" className="min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none"/>
              <input value={expenseDescription} onChange={e=>setExpenseDescription(e.target.value)} placeholder="รายละเอียด เช่น ค่าน้ำแข็งฉุกเฉิน" className="min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none"/>
              <button disabled={expenseBusy||session.offline||!(Number(expenseAmount)>0)} onClick={saveExpense} className="min-h-12 rounded-xl bg-[#1F4D3A] px-4 text-sm font-bold text-white disabled:opacity-40">{expenseBusy?"กำลังตรวจรายการเดิม…":"บันทึก · อยู่หน้า POS ต่อ"}</button>
              {expensePayment==="cash"&&<p className="text-[10px] text-amber-700">เงินสดจะถูกนับเป็นเงินออกจากลิ้นชักใน Close Day</p>}
            </div>
          </div>
          <div><p className="mb-2 text-[10px] font-black tracking-[.16em] text-slate-500">ล่าสุด</p>{latestExpenses.length===0?<Empty text="ยังไม่มีค่าใช้จ่ายล่าสุด"/>:<div className="space-y-2">{latestExpenses.map(x=><div key={x.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-xs"><div className="min-w-0"><b>{x.category}</b><p className="mt-0.5 truncate text-slate-500">{x.description||paymentLabel(x.paymentMethod)}</p></div><b className="shrink-0 text-red-700">฿{formatMoney(x.amount)}</b></div>)}</div>}</div>
          <FullLink href="/expenses" label="เปิดรายจ่ายทั้งหมด"/>
        </div>}
      </div>
    </aside>
  </div>;
}

function Empty({text}:{text:string}){return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-center text-xs text-slate-500">{text}</div>}
function Metric({label,value}:{label:string;value:number}){return <div className="rounded-xl bg-slate-50 p-2"><b className="block text-base">{value}</b><span className="text-[10px] text-slate-500">{label}</span></div>}
function MetricCard({label,value,tone}:{label:string;value:number;tone:"danger"|"warn"}){return <div className={"rounded-2xl border p-3 "+(tone==="danger"?"border-red-200 bg-red-50":"border-amber-200 bg-amber-50")}><b className="text-2xl">{value}</b><p className="mt-1 text-xs text-slate-600">{label}</p></div>}
function FullLink({href,label}:{href:string;label:string}){return <Link href={href} className="flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700">{label}</Link>}
