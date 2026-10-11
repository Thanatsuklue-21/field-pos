"use client";

import {useEffect,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {AlertTriangle,ClipboardList,ExternalLink,ListOrdered,ReceiptText,RefreshCw,X} from "lucide-react";
import {api,type Session} from "@/lib/api-client";
import {formatMoney} from "@/lib/money-format.mjs";
import {shouldRetainExpensePending} from "@/lib/expense-recovery.mjs";
import {currentBusinessDate,expenseErrorText,readPendingExpense,sendExpenseDurably,type ExpenseBody,type PendingExpense} from "@/lib/expense-client";

type Tab="queue"|"orders"|"expense";
type QueueItem={name?:string;qty?:number;readyQty?:number;calledQty?:number};
type QueueOrder={id:string;queueNo?:string;pagerNo?:number;status?:string;time?:number;items?:QueueItem[]};
type Sale={id:string;billNo?:string;queueNo?:string;time?:number;total?:number;payment?:string;status?:string;itemCount?:number};

const tabs:{id:Tab;label:string;Icon:any}[]=[
  {id:"queue",label:"คิวตอนนี้",Icon:ListOrdered},
  {id:"orders",label:"ออเดอร์ล่าสุด",Icon:ClipboardList},
  {id:"expense",label:"รายจ่ายด่วน",Icon:ReceiptText}
];

export default function PosQuickOps({session,open,onClose,writeBlocked=false}:{session:Session;open:boolean;onClose:()=>void;writeBlocked?:boolean}){
  const router=useRouter();
  const [tab,setTab]=useState<Tab>("queue");
  const [queue,setQueue]=useState<QueueOrder[]>([]);
  const [sales,setSales]=useState<Sale[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [expenseBusy,setExpenseBusy]=useState(false);
  const [amount,setAmount]=useState("");
  const [category,setCategory]=useState("OTHER");
  const [description,setDescription]=useState("");
  const [paymentMethod,setPaymentMethod]=useState("cash");
  const expenseRecoveryRef=useRef(false);

  async function refresh(){
    if(session.offline)return;
    setLoading(true);setError("");
    try{
      const [q,h]=await Promise.all([
        api<any>("/api/pos/queue"),
        api<any>("/api/pos/history")
      ]);
      setQueue(Array.isArray(q?.orders)?q.orders:[]);
      setSales(Array.isArray(h?.sales)?h.sales.slice(0,8):[]);
    }catch(e:any){
      setError(e.message==="network_unavailable"?"ขาดการเชื่อมต่อ · ยังแสดงข้อมูลล่าสุดที่โหลดไว้":e.message);
    }finally{setLoading(false)}
  }

  async function recoverExpense(){
    if(session.offline||expenseRecoveryRef.current)return;
    let pending:PendingExpense|null=null;
    try{pending=readPendingExpense()}catch(e:any){setError(expenseErrorText(e.message));return}
    if(!pending)return;
    expenseRecoveryRef.current=true;setExpenseBusy(true);setError("");setNotice("");
    try{
      await sendExpenseDurably(session.csrf,pending.body);
      setNotice("กู้คืนรายจ่ายเดิมสำเร็จ · ไม่บันทึกซ้ำ");
      setAmount("");setDescription("");setPaymentMethod("cash");
    }catch(e:any){
      setError(shouldRetainExpensePending(e)?"รายจ่ายเดิมยังไม่ทราบผล · ระบบเก็บ request เดิมและจะตรวจซ้ำเมื่อเชื่อมต่อ":expenseErrorText(e.message));
    }finally{
      expenseRecoveryRef.current=false;setExpenseBusy(false);
    }
  }

  useEffect(()=>{
    if(!open)return;
    refresh().catch(()=>{});
    recoverExpense().catch(()=>{});
    if(session.offline)return;
    const timer=window.setInterval(()=>refresh().catch(()=>{}),5000);
    const online=()=>{refresh().catch(()=>{});recoverExpense().catch(()=>{})};
    const focus=()=>{refresh().catch(()=>{});recoverExpense().catch(()=>{})};
    const visible=()=>{if(document.visibilityState==="visible")focus()};
    window.addEventListener("online",online);
    window.addEventListener("focus",focus);
    document.addEventListener("visibilitychange",visible);
    return()=>{window.clearInterval(timer);window.removeEventListener("online",online);window.removeEventListener("focus",focus);document.removeEventListener("visibilitychange",visible)};
  },[open,session.offline,session.csrf]);

  async function saveExpense(){
    if(writeBlocked||session.offline||expenseBusy||!(Number(amount)>0))return;
    setExpenseBusy(true);setError("");setNotice("");
    const body:ExpenseBody={
      requestKey:crypto.randomUUID(),
      date:currentBusinessDate(),
      amount:Number(amount),
      category:category.trim().slice(0,60),
      description:description.trim().slice(0,240),
      paymentMethod:paymentMethod.trim().toLowerCase()
    };
    try{
      await sendExpenseDurably(session.csrf,body);
      setAmount("");setDescription("");setPaymentMethod("cash");
      setNotice("บันทึกรายจ่ายแล้ว · อยู่หน้า POS ต่อได้เลย");
    }catch(e:any){setError(expenseErrorText(e.message))}
    finally{setExpenseBusy(false)}
  }

  if(!open)return null;
  const go=(path:string)=>{onClose();router.push(path)};
  const activeQueue=queue.filter(x=>!["returned","void","refunded","cancelled"].includes(String(x.status||"")));
  return <div className="fixed inset-0 z-[90] bg-black/35 sm:flex sm:justify-end" onClick={onClose}>
    <aside aria-label="งานร้านด่วน" className="absolute inset-x-0 bottom-0 max-h-[88dvh] rounded-t-[28px] bg-[#f7f8fa] shadow-2xl sm:static sm:h-full sm:max-h-none sm:w-[430px] sm:rounded-none sm:border-l sm:border-slate-200" onClick={e=>e.stopPropagation()}>
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div><p className="m-0 text-[10px] font-black tracking-[.22em] text-[#765b08]">QUICK OPS</p><h2 className="mt-0.5 text-lg font-black">งานร้านโดยไม่ออกจาก POS</h2></div>
        <button aria-label="ปิดงานร้านด่วน" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-xl bg-white"><X size={18}/></button>
      </div>

      <div className="grid grid-cols-3 gap-1 border-b border-slate-200 bg-white p-2">
        {tabs.map(({id,label,Icon})=><button key={id} onClick={()=>setTab(id)} className={"flex min-h-12 items-center justify-center gap-1 rounded-xl px-2 text-[11px] font-bold "+(tab===id?"bg-[#d4af37]/20 text-[#6f5510]":"text-slate-600")}><Icon size={15}/><span>{label}</span></button>)}
      </div>

      {(error||notice||session.offline)&&<div className="space-y-2 px-3 pt-3">
        {session.offline&&<div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><AlertTriangle size={16} className="shrink-0"/>Quick Ops ใช้ข้อมูล Cloud จึงเป็นแบบดูไม่ได้/บันทึกไม่ได้ระหว่าง Offline · การขายเงินสดหน้า POS ยังทำงานตามปกติ</div>}
        {error&&<div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
        {notice&&<div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{notice}</div>}
      </div>}

      <div className="soft-scroll h-[calc(88dvh-128px)] overflow-y-auto p-3 sm:h-[calc(100dvh-128px)]">
        {tab==="queue"&&<div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div><b className="text-sm">คิวที่ยังไม่ส่งมอบ</b><p className="mt-0.5 text-[11px] text-slate-500">{activeQueue.length} คิว · เช็กสถานะได้โดยไม่เปลี่ยนหน้า</p></div>
            <button disabled={loading||session.offline} onClick={()=>refresh()} className="grid h-11 w-11 place-items-center rounded-xl border bg-white disabled:opacity-40"><RefreshCw size={16}/></button>
          </div>
          <div className="space-y-2">{activeQueue.length===0?<div className="rounded-2xl border border-dashed p-5 text-center text-xs text-slate-500">ไม่มีคิวค้าง</div>:activeQueue.slice(0,6).map(order=>{
            const items=order.items||[];
            const cups=items.reduce((s,x)=>s+Number(x.qty||0),0);
            const ready=items.reduce((s,x)=>s+Math.min(Number(x.qty||0),Number(x.readyQty||0)),0);
            const called=items.reduce((s,x)=>s+Math.min(Number(x.qty||0),Number(x.calledQty||0)),0);
            return <div key={order.id} className="rounded-2xl border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-3"><div><b>{order.queueNo||"—"}</b><span className="ml-2 text-xs text-slate-500">Pager {order.pagerNo||"—"}</span></div><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase">{order.status||"waiting"}</span></div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px]"><div className="rounded-xl bg-slate-50 p-2">ทั้งหมด<b className="block text-sm">{cups}</b></div><div className="rounded-xl bg-emerald-50 p-2 text-emerald-800">ทำแล้ว<b className="block text-sm">{ready}</b></div><div className="rounded-xl bg-blue-50 p-2 text-blue-800">เรียกแล้ว<b className="block text-sm">{called}</b></div></div>
              <p className="mt-2 text-[11px] text-slate-500">{items.slice(0,3).map(x=>(x.name||"เมนู")+" ×"+Number(x.qty||0)).join(" · ")}{items.length>3?" …":""}</p>
            </div>
          })}</div>
          <button onClick={()=>go("/queue")} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white">จัดการคิวเต็ม <ExternalLink size={15}/></button>
        </div>}

        {tab==="orders"&&<div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div><b className="text-sm">ออเดอร์ล่าสุด</b><p className="mt-0.5 text-[11px] text-slate-500">ดูยอด/คิวล่าสุดโดยไม่ออกจากหน้าขาย</p></div>
            <button disabled={loading||session.offline} onClick={()=>refresh()} className="grid h-11 w-11 place-items-center rounded-xl border bg-white disabled:opacity-40"><RefreshCw size={16}/></button>
          </div>
          <div className="space-y-2">{sales.length===0?<div className="rounded-2xl border border-dashed p-5 text-center text-xs text-slate-500">ยังไม่มีออเดอร์ล่าสุด</div>:sales.slice(0,8).map(s=><div key={s.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3">
            <div className="min-w-0"><div className="flex items-center gap-2"><b>{s.queueNo||s.billNo||"—"}</b><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] uppercase text-slate-600">{s.status||"paid"}</span></div><p className="mt-1 truncate text-[11px] text-slate-500">{s.billNo||"—"} · {s.itemCount||0} รายการ · {String(s.payment||"").toUpperCase()}</p></div>
            <b className="shrink-0 text-[#765b08]">฿{formatMoney(Number(s.total)||0)}</b>
          </div>)}</div>
          <button onClick={()=>go("/orders")} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white">เปิด Orders เต็ม <ExternalLink size={15}/></button>
        </div>}

        {tab==="expense"&&<div>
          <div className="mb-3"><b className="text-sm">บันทึกรายจ่ายด่วน</b><p className="mt-0.5 text-[11px] text-slate-500">เช่น ค่าจอดรถ / น้ำแข็งฉุกเฉิน / ค่าส่ง · บันทึกแล้วกลับขายต่อทันที</p></div>
          <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3">
            <select value={category} onChange={e=>setCategory(e.target.value)} className="min-h-12 rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="OTHER">อื่น ๆ</option><option value="UTILITY">ค่าน้ำ/ไฟ</option><option value="MAINTENANCE">ซ่อมบำรุง</option><option value="PACKAGING">บรรจุภัณฑ์ฉุกเฉิน</option><option value="MARKETING">การตลาด</option><option value="TRANSPORT">เดินทาง/ขนส่ง</option></select>
            <select value={paymentMethod} onChange={e=>setPaymentMethod(e.target.value)} className="min-h-12 rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="cash">เงินสดจากลิ้นชัก</option><option value="bank">โอน/ธนาคาร</option><option value="other">ช่องทางอื่น</option></select>
            <input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="จำนวนเงิน (บาท)" className="min-h-12 rounded-xl border border-slate-200 bg-slate-50 px-3 text-base"/>
            <input value={description} onChange={e=>setDescription(e.target.value)} placeholder="รายละเอียด" className="min-h-12 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm"/>
            {writeBlocked&&<p className="rounded-xl bg-amber-50 p-2 text-[11px] text-amber-800">กำลังทำรายการขายอยู่ · ปิดขั้นตอนขายก่อนจึงบันทึกรายจ่ายได้</p>}
            <button disabled={session.offline||writeBlocked||expenseBusy||!(Number(amount)>0)} onClick={saveExpense} className="min-h-12 rounded-xl bg-[#1F4D3A] px-4 text-sm font-black text-white disabled:opacity-40">{expenseBusy?"กำลังตรวจ/บันทึก…":"บันทึกรายจ่าย"}</button>
          </div>
          <button onClick={()=>go("/expenses")} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700">ดูรายจ่ายทั้งหมด <ExternalLink size={15}/></button>
        </div>}
      </div>
    </aside>
  </div>;
}
