"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {AlertTriangle,Boxes,ClipboardList,ExternalLink,ListOrdered,ReceiptText,RefreshCw,X} from "lucide-react";
import {api,type Bootstrap,type Session} from "@/lib/api-client";
import {formatMoney} from "@/lib/money-format.mjs";
import {shouldRetainExpensePending} from "@/lib/expense-recovery.mjs";
import {currentBusinessDate,expenseErrorText,readPendingExpense,sendExpenseDurably,type ExpenseBody,type PendingExpense} from "@/lib/expense-client";

type Tab="queue"|"orders"|"stock"|"expense";
type QueueItem={name?:string;qty?:number;readyQty?:number;calledQty?:number};
type QueueOrder={id:string;queueNo?:string;pagerNo?:number;status?:string;time?:number;items?:QueueItem[]};
type Sale={id:string;billNo?:string;queueNo?:string;time?:number;total?:number;payment?:string;status?:string;itemCount?:number;orderStatus?:string|null};
type ExpenseRow={id:string;category?:string;description?:string;amount?:number;paymentMethod?:string};

export default function PosQuickOps({session,bootstrap,open,onClose,writeBlocked=false}:{session:Session;bootstrap:Bootstrap|null;open:boolean;onClose:()=>void;writeBlocked?:boolean}){
  const router=useRouter();
  const canQueue=session.user.role==="admin"||session.user.permissions?.queue===true;
  const canOrder=session.user.role==="admin"||session.user.permissions?.order===true;
  const canStock=session.user.role==="admin"||session.user.permissions?.stock===true;
  const canExpense=session.user.role==="admin"||session.user.permissions?.report===true;
  const availableTabs=useMemo(()=>[
    canQueue&&"queue",canOrder&&"orders",canStock&&"stock",canExpense&&"expense"
  ].filter(Boolean) as Tab[],[canQueue,canOrder,canStock,canExpense]);
  const [tab,setTab]=useState<Tab>(availableTabs[0]||"orders");
  const [queue,setQueue]=useState<QueueOrder[]>([]);
  const [sales,setSales]=useState<Sale[]>([]);
  const [expenses,setExpenses]=useState<ExpenseRow[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [expenseBusy,setExpenseBusy]=useState(false);
  const [amount,setAmount]=useState("");
  const [category,setCategory]=useState("OTHER");
  const [description,setDescription]=useState("");
  const [paymentMethod,setPaymentMethod]=useState("cash");
  const expenseRecoveryRef=useRef(false);

  useEffect(()=>{if(!availableTabs.includes(tab)&&availableTabs[0])setTab(availableTabs[0])},[availableTabs.join("|"),tab]);

  async function refresh(){
    if(session.offline)return;
    setLoading(true);setError("");
    try{
      const tasks:{name:"queue"|"orders"|"expenses";promise:Promise<any>}[]=[];
      if(canQueue)tasks.push({name:"queue",promise:api<any>("/api/pos/queue")});
      if(canOrder)tasks.push({name:"orders",promise:api<any>("/api/pos/history")});
      if(canExpense)tasks.push({name:"expenses",promise:api<any>("/api/expenses")});
      const settled=await Promise.allSettled(tasks.map(x=>x.promise));
      settled.forEach((result,index)=>{
        if(result.status!=="fulfilled")return;
        const name=tasks[index].name,value=result.value;
        if(name==="queue")setQueue(Array.isArray(value?.orders)?value.orders:[]);
        if(name==="orders")setSales(Array.isArray(value?.sales)?value.sales.slice(0,8):[]);
        if(name==="expenses")setExpenses(Array.isArray(value?.expenses)?value.expenses.slice(0,5):[]);
      });
      if(settled.some(x=>x.status==="rejected"))setError("บางข้อมูลยังโหลดไม่ได้ · หน้าขายยังใช้งานต่อได้ตามปกติ");
    }finally{setLoading(false)}
  }

  async function recoverExpense(){
    if(!canExpense||session.offline||expenseRecoveryRef.current)return;
    let pending:PendingExpense|null=null;
    try{pending=readPendingExpense()}catch(e:any){setError(expenseErrorText(e.message));return}
    if(!pending)return;
    expenseRecoveryRef.current=true;setExpenseBusy(true);setError("");setNotice("");
    try{
      const r=await sendExpenseDurably(session.csrf,pending.body);
      if(r?.expense)setExpenses(prev=>[r.expense,...prev.filter(x=>x.id!==r.expense.id)].slice(0,5));
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
  },[open,session.offline,session.csrf,canQueue,canOrder,canExpense]);

  async function saveExpense(){
    if(!canExpense||writeBlocked||session.offline||expenseBusy||!(Number(amount)>0))return;
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
      const r=await sendExpenseDurably(session.csrf,body);
      if(r?.expense)setExpenses(prev=>[r.expense,...prev.filter(x=>x.id!==r.expense.id)].slice(0,5));
      setAmount("");setDescription("");setPaymentMethod("cash");
      setNotice("บันทึกรายจ่ายแล้ว · อยู่หน้า POS ต่อได้เลย");
    }catch(e:any){setError(expenseErrorText(e.message))}
    finally{setExpenseBusy(false)}
  }

  const stockRows=useMemo(()=>{
    const rows:{key:string;name:string;variant:string;level:"out"|"low";detail:string}[]=[];
    for(const menu of bootstrap?.menu||[])for(const variant of menu.variants||[]){
      if(!variant.available){
        const missing=(variant.missingIngredients||[]).map(x=>x.name).join(", ");
        rows.push({key:menu.id+"|"+variant.label,name:menu.name,variant:variant.label,level:"out",detail:missing||variant.reason||"ทำไม่ได้"});
      }else if(variant.lowStock){
        rows.push({key:menu.id+"|"+variant.label,name:menu.name,variant:variant.label,level:"low",detail:"ทำได้ประมาณ "+Number(variant.maxServings||0)+" แก้ว"});
      }
    }
    return rows.slice(0,12);
  },[bootstrap?.revision]);
  const stockOut=stockRows.filter(x=>x.level==="out").length,stockLow=stockRows.filter(x=>x.level==="low").length;
  const activeQueue=queue.filter(x=>!["returned","void","refunded","cancelled"].includes(String(x.status||"")));

  if(!open)return null;
  const go=(path:string)=>{onClose();router.push(path)};
  const tabs:{id:Tab;label:string;Icon:any;allowed:boolean;count?:number}[]=[
    {id:"queue",label:"คิว",Icon:ListOrdered,allowed:canQueue,count:activeQueue.length},
    {id:"orders",label:"ออเดอร์",Icon:ClipboardList,allowed:canOrder,count:sales.length},
    {id:"stock",label:"สต็อก",Icon:Boxes,allowed:canStock,count:stockOut+stockLow},
    {id:"expense",label:"รายจ่าย",Icon:ReceiptText,allowed:canExpense}
  ];

  return <div className="fixed inset-0 z-[90] bg-black/35 sm:flex sm:justify-end" onClick={onClose}>
    <aside role="dialog" aria-modal="true" aria-label="งานร้านด่วน" className="absolute inset-x-0 bottom-0 max-h-[88dvh] rounded-t-[28px] bg-[#f7f8fa] shadow-2xl sm:static sm:h-full sm:max-h-none sm:w-[480px] sm:rounded-none sm:border-l sm:border-slate-200" onClick={e=>e.stopPropagation()}>
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div><p className="m-0 text-[10px] font-black tracking-[.22em] text-[#765b08]">FIELD QUICK OPS</p><h2 className="mt-0.5 text-lg font-black">งานร้านโดยไม่ออกจาก POS</h2><p className="mt-1 text-[11px] text-slate-500">เช็กสถานะและทำงานสั้น ๆ แล้วกลับขายต่อทันที</p></div>
        <div className="flex gap-1"><button disabled={loading||session.offline} aria-label="รีเฟรชงานร้าน" onClick={()=>refresh()} className="grid h-11 w-11 place-items-center rounded-xl border bg-white disabled:opacity-40"><RefreshCw size={16}/></button><button aria-label="ปิดงานร้านด่วน" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-xl bg-white"><X size={18}/></button></div>
      </div>

      <div className="grid grid-cols-4 gap-1 border-b border-slate-200 bg-white p-2">
        {tabs.filter(x=>x.allowed).map(({id,label,Icon,count})=><button key={id} onClick={()=>setTab(id)} className={"relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[10px] font-bold "+(tab===id?"bg-[#d4af37]/20 text-[#6f5510]":"text-slate-600")}><Icon size={16}/><span>{label}</span>{Number(count)>0&&<span className="absolute right-1.5 top-1 rounded-full bg-slate-900 px-1.5 text-[9px] text-white">{count}</span>}</button>)}
      </div>

      {(error||notice||session.offline)&&<div className="space-y-2 px-3 pt-3">
        {session.offline&&<div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><AlertTriangle size={16} className="shrink-0"/>Offline: สต็อกแสดงจากข้อมูลล่าสุดที่ cache ไว้ ส่วนคิว/ออเดอร์/รายจ่ายจะไม่เขียนหรือดึง Cloud จนกว่าจะออนไลน์</div>}
        {error&&<div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
        {notice&&<div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{notice}</div>}
      </div>}

      <div className="soft-scroll h-[calc(88dvh-140px)] overflow-y-auto p-3 sm:h-[calc(100dvh-140px)]">
        {tab==="queue"&&canQueue&&<div>
          <div className="mb-3"><b className="text-sm">คิวที่ยังไม่ส่งมอบ</b><p className="mt-0.5 text-[11px] text-slate-500">{activeQueue.length} คิว · เช็ก progress ได้โดยไม่เปลี่ยนหน้า</p></div>
          <div className="space-y-2">{activeQueue.length===0?<Empty text={session.offline?"ออฟไลน์ · ยังไม่ดึงคิวจาก Server":"ไม่มีคิวค้าง"}/>:activeQueue.slice(0,6).map(order=>{
            const items=order.items||[];
            const cups=items.reduce((s,x)=>s+Number(x.qty||0),0);
            const ready=items.reduce((s,x)=>s+Math.min(Number(x.qty||0),Number(x.readyQty||0)),0);
            const called=items.reduce((s,x)=>s+Math.min(Number(x.qty||0),Number(x.calledQty||0)),0);
            return <div key={order.id} className="rounded-2xl border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-3"><div><b>{order.queueNo||"—"}</b><span className="ml-2 text-xs text-slate-500">Pager {order.pagerNo||"—"}</span></div><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase">{order.status||"waiting"}</span></div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px]"><Metric label="ทั้งหมด" value={cups}/><Metric label="ทำแล้ว" value={ready}/><Metric label="เรียกแล้ว" value={called}/></div>
              <p className="mt-2 text-[11px] text-slate-500">{items.slice(0,3).map(x=>(x.name||"เมนู")+" ×"+Number(x.qty||0)).join(" · ")}{items.length>3?" …":""}</p>
            </div>
          })}</div>
          <FullButton onClick={()=>go("/queue")} label="จัดการคิวเต็ม"/>
        </div>}

        {tab==="orders"&&canOrder&&<div>
          <div className="mb-3"><b className="text-sm">ออเดอร์ล่าสุด</b><p className="mt-0.5 text-[11px] text-slate-500">ดูยอด/คิวล่าสุดโดยไม่ออกจากหน้าขาย</p></div>
          <div className="space-y-2">{sales.length===0?<Empty text={session.offline?"ออฟไลน์ · ยังไม่ดึง Orders จาก Server":"ยังไม่มีออเดอร์ล่าสุด"}/>:sales.slice(0,8).map(s=><div key={s.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3">
            <div className="min-w-0"><div className="flex items-center gap-2"><b>{s.queueNo||s.billNo||"—"}</b><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] uppercase text-slate-600">{s.status||"paid"}</span></div><p className="mt-1 truncate text-[11px] text-slate-500">{s.billNo||"—"} · {s.itemCount||0} รายการ · {String(s.payment||"").toUpperCase()}{s.orderStatus?" · "+s.orderStatus:""}</p></div>
            <b className="shrink-0 text-[#765b08]">฿{formatMoney(Number(s.total)||0)}</b>
          </div>)}</div>
          <FullButton onClick={()=>go("/orders")} label="เปิด Orders เต็ม"/>
        </div>}

        {tab==="stock"&&canStock&&<div>
          <div className="mb-3"><b className="text-sm">สถานะขายจาก Stock ปัจจุบัน</b><p className="mt-0.5 text-[11px] text-slate-500">อ่านจาก availability ที่ POS ใช้รับออเดอร์ ไม่สร้าง mutation เพิ่ม</p></div>
          <div className="mb-3 grid grid-cols-2 gap-2"><MetricCard label="พักขาย / ทำไม่ได้" value={stockOut} tone="danger"/><MetricCard label="ใกล้หมด" value={stockLow} tone="warn"/></div>
          <div className="space-y-2">{stockRows.length===0?<Empty text="เมนูที่ขายอยู่ยังไม่พบสัญญาณ Stock ต่ำ"/>:stockRows.map(row=><div key={row.key} className={"rounded-2xl border p-3 "+(row.level==="out"?"border-red-200 bg-red-50":"border-amber-200 bg-amber-50")}>
            <div className="flex items-start justify-between gap-2"><div><b className="text-sm">{row.name}</b><p className="mt-0.5 text-[11px] text-slate-500">{row.variant}</p></div><span className={"rounded-full px-2 py-1 text-[9px] font-black "+(row.level==="out"?"bg-red-100 text-red-700":"bg-amber-100 text-amber-800")}>{row.level==="out"?"พักขาย":"LOW"}</span></div>
            <p className="mt-2 text-xs text-slate-700">{row.detail}</p>
          </div>)}</div>
          <FullButton onClick={()=>go("/stock")} label="เปิด Stock เต็ม / รับเข้า / นับจริง"/>
        </div>}

        {tab==="expense"&&canExpense&&<div>
          <div className="mb-3"><b className="text-sm">บันทึกรายจ่ายด่วน</b><p className="mt-0.5 text-[11px] text-slate-500">เช่น ค่าจอดรถ / น้ำแข็งฉุกเฉิน / ค่าส่ง · บันทึกแล้วกลับขายต่อทันที</p></div>
          <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3">
            <div className="grid grid-cols-2 gap-2"><select value={category} onChange={e=>setCategory(e.target.value)} className="min-h-12 rounded-xl border border-slate-200 bg-white px-3 text-xs"><option value="OTHER">อื่น ๆ</option><option value="UTILITY">ค่าน้ำ/ไฟ</option><option value="MAINTENANCE">ซ่อมบำรุง</option><option value="PACKAGING">บรรจุภัณฑ์ฉุกเฉิน</option><option value="MARKETING">การตลาด</option><option value="TRANSPORT">เดินทาง/ขนส่ง</option></select><select value={paymentMethod} onChange={e=>setPaymentMethod(e.target.value)} className="min-h-12 rounded-xl border border-slate-200 bg-white px-3 text-xs"><option value="cash">เงินสดจากลิ้นชัก</option><option value="bank">โอน/ธนาคาร</option><option value="other">ช่องทางอื่น</option></select></div>
            <input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="จำนวนเงิน (บาท)" className="min-h-12 rounded-xl border border-slate-200 bg-slate-50 px-3 text-base"/>
            <input value={description} onChange={e=>setDescription(e.target.value)} placeholder="รายละเอียด" className="min-h-12 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm"/>
            {writeBlocked&&<p className="rounded-xl bg-amber-50 p-2 text-[11px] text-amber-800">กำลังทำรายการขายอยู่ · ปิดขั้นตอนขายก่อนจึงบันทึกรายจ่ายได้</p>}
            <button disabled={session.offline||writeBlocked||expenseBusy||!(Number(amount)>0)} onClick={saveExpense} className="min-h-12 rounded-xl bg-[#1F4D3A] px-4 text-sm font-black text-white disabled:opacity-40">{expenseBusy?"กำลังตรวจ/บันทึก…":"บันทึกรายจ่าย · อยู่หน้า POS ต่อ"}</button>
            {paymentMethod==="cash"&&<p className="text-[10px] text-amber-700">เงินสดรายการนี้จะถูกหักออกจาก Expected Cash ใน Close Day</p>}
          </div>
          <div className="mt-3"><p className="mb-2 text-[10px] font-black tracking-[.14em] text-slate-500">รายจ่ายล่าสุด</p><div className="space-y-2">{expenses.length===0?<Empty text={session.offline?"ออฟไลน์ · ยังไม่ดึงรายจ่ายจาก Server":"ยังไม่มีรายจ่ายล่าสุด"}/>:expenses.map(x=><div key={x.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-xs"><div className="min-w-0"><b>{x.category||"OTHER"}</b><p className="mt-0.5 truncate text-slate-500">{x.description||x.paymentMethod||"—"}</p></div><b className="shrink-0 text-red-700">฿{formatMoney(Number(x.amount)||0)}</b></div>)}</div></div>
          <FullButton onClick={()=>go("/expenses")} label="ดูรายจ่ายทั้งหมด"/>
        </div>}
      </div>
    </aside>
  </div>;
}

function Empty({text}:{text:string}){return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-center text-xs text-slate-500">{text}</div>}
function Metric({label,value}:{label:string;value:number}){return <div className="rounded-xl bg-slate-50 p-2"><b className="block text-sm">{value}</b><span className="text-[10px] text-slate-500">{label}</span></div>}
function MetricCard({label,value,tone}:{label:string;value:number;tone:"danger"|"warn"}){return <div className={"rounded-2xl border p-3 "+(tone==="danger"?"border-red-200 bg-red-50":"border-amber-200 bg-amber-50")}><b className="text-2xl">{value}</b><p className="mt-1 text-xs text-slate-600">{label}</p></div>}
function FullButton({onClick,label}:{onClick:()=>void;label:string}){return <button onClick={onClick} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700">{label} <ExternalLink size={15}/></button>}
