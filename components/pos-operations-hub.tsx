"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import Link from "next/link";
import {BellRing,Boxes,CalendarCheck2,CheckCircle2,ClipboardList,ListOrdered,Plus,ReceiptText,RefreshCw,RotateCcw,X} from "lucide-react";
import {api,type Bootstrap,type Session} from "@/lib/api-client";
import {formatMoney} from "@/lib/money-format.mjs";
import {shouldRetainExpensePending} from "@/lib/expense-recovery.mjs";
import {currentBusinessDate,expenseErrorText,readPendingExpense,sendExpenseDurably,type ExpenseBody,type PendingExpense} from "@/lib/expense-client";
import {queueActionErrorText,readPendingQueueAction,sendQueueActionDurably,type QueueActionBody,type PendingQueueAction} from "@/lib/queue-client";
import {shouldRetainQueuePending} from "@/lib/queue-action-recovery.mjs";

export type HubTab="today"|"queue"|"orders"|"stock"|"expenses";
type QueueRecipeUse={id:string;name:string;perCup:number;unit:string};
type QueuePrepItem={id:string;name:string;variant?:string;qty:number;pendingQty?:number;recipeUsage?:QueueRecipeUse[]};
type QueuePrepGroup={id:string;label:string;batchMode?:string;items?:QueuePrepItem[]};
type QueueOrder={id:string;queueNo:string;pagerNo:number;status:string;time:number;items:{id?:string;name:string;variant?:string;qty:number;readyQty?:number;calledQty?:number}[];prepGroups?:QueuePrepGroup[]};
type Sale={id:string;billNo:string;date:string;time:number;total:number;payment:string;status:string;queueNo:string;itemCount:number;orderStatus?:string|null};
type ExpenseRow={id:string;date:string;time:number;category:string;description:string;amount:number;paymentMethod?:string;sourceType?:string};
type TodaySummary={today:string;todayRevenue:number;todayOrders:number;grossMargin:number;lowStock?:{name:string}[];recommendations?:{level:string;title:string;detail:string}[]};
type CloseStatus={businessDate:string;shift:any;paymentBlockers:any[];orderBlockers:any[];closeBlockedByPayments:boolean;closeBlockedByOrders:boolean;closes:any[]};
type AdminReadiness={
  businessDate?:string;
  readyForCashSales:boolean;
  readyForPromptPay:boolean;
  readyForFullOperations:boolean;
  accounting?:{ok:boolean;level:string;blocking?:any[];totals?:Record<string,any>};
  accountingCauses?:{code:string;confidence:string;severity:string;title:string;explanation:string;nextAction:string}[];
  warnings?:{code:string;message:string}[];
};
const n=(v:any)=>Number(v)||0;
const paymentLabel=(v?:string)=>v==="cash"?"เงินสด":v==="bank"?"โอน/ธนาคาร":v==="other"?"อื่น ๆ":String(v||"—").toUpperCase();

export default function PosOperationsHub({session,bootstrap,open,onClose,onRefreshStock,networkOnline,initialTab}:{session:Session;bootstrap:Bootstrap|null;open:boolean;onClose:()=>void;onRefreshStock?:()=>Promise<unknown>;networkOnline:boolean;initialTab?:HubTab}){
  const canQueue=session.user.role==="admin"||session.user.permissions?.queue===true;
  const canOrder=session.user.role==="admin"||session.user.permissions?.order===true;
  const canStock=session.user.role==="admin"||session.user.permissions?.stock===true;
  const canExpense=session.user.role==="admin"||session.user.permissions?.report===true;
  const canReport=canExpense;
  const canReadiness=session.user.role==="admin";
  const cloudAvailable=networkOnline&&!session.offline;
  const availableTabs=useMemo(()=>[
    canReport&&"today",canQueue&&"queue",canOrder&&"orders",canStock&&"stock",canExpense&&"expenses"
  ].filter(Boolean) as HubTab[],[canReport,canQueue,canOrder,canStock,canExpense]);
  const [tab,setTab]=useState<HubTab>(availableTabs[0]||"orders");
  const [queue,setQueue]=useState<QueueOrder[]>([]);
  const [sales,setSales]=useState<Sale[]>([]);
  const [expenses,setExpenses]=useState<ExpenseRow[]>([]);
  const [todaySummary,setTodaySummary]=useState<TodaySummary|null>(null);
  const [closeStatus,setCloseStatus]=useState<CloseStatus|null>(null);
  const [readiness,setReadiness]=useState<AdminReadiness|null>(null);
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState("");
  const [expenseBusy,setExpenseBusy]=useState(false);
  const [queueBusy,setQueueBusy]=useState(false);
  const [expenseAmount,setExpenseAmount]=useState("");
  const [expenseCategory,setExpenseCategory]=useState("OTHER");
  const [expenseDescription,setExpenseDescription]=useState("");
  const [expensePayment,setExpensePayment]=useState("cash");
  const expenseRecoveryRef=useRef(false);
  const queueRecoveryRef=useRef(false);
  const activeTabRef=useRef<HubTab>(tab);
  const dialogRef=useRef<HTMLElement|null>(null);
  const previousFocusRef=useRef<HTMLElement|null>(null);
  const tabRefs=useRef<Partial<Record<HubTab,HTMLButtonElement|null>>>({});
  const onCloseRef=useRef(onClose);

  useEffect(()=>{onCloseRef.current=onClose},[onClose]);

  useEffect(()=>{if(!availableTabs.includes(tab)&&availableTabs[0])setTab(availableTabs[0])},[availableTabs.join("|"),tab]);
  useEffect(()=>{
    if(!open)return;
    const requested=initialTab&&availableTabs.includes(initialTab)?initialTab:availableTabs[0];
    if(requested)setTab(requested);
  },[open,initialTab,availableTabs.join("|")]);
  useEffect(()=>{
    const changed=activeTabRef.current!==tab;
    activeTabRef.current=tab;
    if(changed&&open&&cloudAvailable)refresh(tab,true).catch(()=>{});
  },[tab,open,cloudAvailable]);
  useEffect(()=>{
    if(!open)return;
    previousFocusRef.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    const focusableSelector='button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const frame=window.requestAnimationFrame(()=>{
      const first=dialogRef.current?.querySelector<HTMLElement>(focusableSelector);
      (first||dialogRef.current)?.focus();
    });
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){event.preventDefault();onCloseRef.current();return}
      if(event.key!=="Tab"||!dialogRef.current)return;
      const focusable=Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)).filter(el=>el.offsetParent!==null);
      if(focusable.length===0){event.preventDefault();dialogRef.current.focus();return}
      const first=focusable[0],last=focusable[focusable.length-1],active=document.activeElement;
      if(event.shiftKey&&active===first){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&active===last){event.preventDefault();first.focus()}
    };
    window.addEventListener("keydown",onKey);
    return()=>{
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown",onKey);
      document.body.style.overflow=previousOverflow;
      previousFocusRef.current?.focus();
      previousFocusRef.current=null;
    };
  },[open]);

  async function refresh(scope:HubTab|"all"="all",quiet=false){
    if(!cloudAvailable){if(!quiet)setMessage("OFFLINE · ดูสถานะจากข้อมูลเมนู/สต็อกที่ cache ไว้ได้ แต่คิว ออเดอร์ และรายจ่ายต้องรอเชื่อมต่อ");return}
    if(!quiet){setLoading(true);setMessage("")}
    try{
      const tasks:Promise<any>[]=[];
      const names:("todaySummary"|"closeStatus"|"readiness"|"queue"|"orders"|"expenses"|"stock")[]=[];
      if(canReport&&(scope==="all"||scope==="today")){tasks.push(api<any>("/api/management/dashboard"));names.push("todaySummary");tasks.push(api<any>("/api/close-day"));names.push("closeStatus")}
      if(canReadiness&&(scope==="all"||scope==="today")){tasks.push(api<any>("/api/admin/readiness"));names.push("readiness")}
      if(canQueue&&(scope==="all"||scope==="queue")){tasks.push(api<any>("/api/pos/queue"));names.push("queue")}
      if(canOrder&&(scope==="all"||scope==="orders")){tasks.push(api<any>("/api/pos/history"));names.push("orders")}
      if(canExpense&&(scope==="all"||scope==="expenses")){tasks.push(api<any>("/api/expenses"));names.push("expenses")}
      if(canStock&&(scope==="all"||scope==="stock")&&onRefreshStock){tasks.push(onRefreshStock());names.push("stock")}
      if(!tasks.length)return;
      const settled=await Promise.allSettled(tasks);
      settled.forEach((result,index)=>{
        if(result.status!=="fulfilled")return;
        const name=names[index],value=result.value;
        if(name==="todaySummary")setTodaySummary(value as TodaySummary);
        if(name==="closeStatus")setCloseStatus(value as CloseStatus);
        if(name==="readiness")setReadiness(value as AdminReadiness);
        if(name==="queue")setQueue(Array.isArray(value.orders)?value.orders:[]);
        if(name==="orders")setSales(Array.isArray(value.sales)?value.sales:[]);
        if(name==="expenses")setExpenses(Array.isArray(value.expenses)?value.expenses:[]);
        // Stock freshness is applied by the parent POS bootstrap loader via onRefreshStock.
      });
      if(settled.some(x=>x.status==="rejected"))setMessage("บางข้อมูลยังโหลดไม่ได้ · หน้าขายยังใช้งานต่อได้ตามปกติ");
    }finally{if(!quiet)setLoading(false)}
  }

  async function recoverExpense(){
    if(!canExpense||!cloudAvailable||expenseRecoveryRef.current)return;
    let pending:PendingExpense|null=null;
    try{pending=readPendingExpense()}catch(e:any){setMessage(expenseErrorText(e.message));return}
    if(!pending)return;
    expenseRecoveryRef.current=true;setExpenseBusy(true);
    try{
      await sendExpenseDurably(session.csrf,pending.body);
      setMessage("กู้คืนค่าใช้จ่ายเดิมสำเร็จ · ไม่บันทึกซ้ำ");
      await refresh("expenses",true);
    }catch(e:any){
      setMessage(shouldRetainExpensePending(e)?"ค่าใช้จ่ายรายการก่อนหน้ายังตรวจสอบไม่เสร็จ · ระบบเก็บข้อมูลเดิมไว้และจะตรวจอีกครั้ง":expenseErrorText(e.message));
    }finally{expenseRecoveryRef.current=false;setExpenseBusy(false)}
  }
  async function recoverQueueAction(){
    if(!canQueue||!cloudAvailable||queueRecoveryRef.current)return;
    let pending:PendingQueueAction|null=null;
    try{pending=readPendingQueueAction()}catch(e:any){setMessage(queueActionErrorText(e.message));return}
    if(!pending)return;
    queueRecoveryRef.current=true;setQueueBusy(true);
    try{
      const result=await sendQueueActionDurably(session.csrf,pending.body);
      if(Array.isArray(result?.orders))setQueue(result.orders);
      setMessage("ตรวจสอบการกดคิวก่อนหน้าสำเร็จ · ระบบไม่ทำรายการซ้ำ");
    }catch(e:any){
      setMessage(shouldRetainQueuePending(e)
        ?"การกดคิวก่อนหน้ายังตรวจสอบไม่เสร็จ · ระบบเก็บข้อมูลเดิมไว้และจะตรวจอีกครั้ง"
        :queueActionErrorText(e.message));
      await refresh("queue",true).catch(()=>{});
    }finally{queueRecoveryRef.current=false;setQueueBusy(false)}
  }

  async function runQuickQueueAction(order:QueueOrder){
    if(queueBusy||!cloudAvailable)return;
    try{
      if(readPendingQueueAction()){await recoverQueueAction();return}
    }catch(e:any){setMessage(queueActionErrorText(e.message));return}
    const itemIndex=(order.items||[]).findIndex(item=>n(item.readyQty)<n(item.qty));
    let body:QueueActionBody;
    let successText="";
    if(itemIndex>=0){
      const item=order.items[itemIndex];
      body={requestKey:crypto.randomUUID(),orderId:order.id,action:"complete_item",itemIndex,expectedReadyQty:n(item.readyQty)};
      successText="ทำ "+item.name+" ครบแล้ว · ไปขั้นตอนถัดไปในคิวเดิม";
    }else if((order.items||[]).some(item=>n(item.calledQty)<n(item.qty))){
      body={requestKey:crypto.randomUUID(),orderId:order.id,action:"call"};
      successText="เรียกลูกค้า "+order.queueNo+" แล้ว";
    }else{
      body={requestKey:crypto.randomUUID(),orderId:order.id,action:"return"};
      successText="ส่งมอบ "+order.queueNo+" แล้ว · คิวถัดไปพร้อมทำต่อ";
    }
    setQueueBusy(true);setMessage("");
    try{
      const result=await sendQueueActionDurably(session.csrf,body);
      if(Array.isArray(result?.orders))setQueue(result.orders);
      else await refresh("queue",true);
      setMessage(successText);
    }catch(e:any){
      setMessage(shouldRetainQueuePending(e)
        ?"ผลการกดคิวครั้งก่อนยังไม่ชัดเจน · ระบบเก็บข้อมูลเดิมไว้ ห้ามกดซ้ำจนกว่าจะตรวจสำเร็จ"
        :queueActionErrorText(e.message));
      await refresh("queue",true).catch(()=>{});
    }finally{setQueueBusy(false)}
  }

  async function runQuickWasteRemake(order:QueueOrder,itemIndex:number){
    if(queueBusy||!cloudAvailable)return;
    const item=order.items?.[itemIndex];
    if(!item)return;
    try{
      if(readPendingQueueAction()){await recoverQueueAction();return}
    }catch(e:any){setMessage(queueActionErrorText(e.message));return}
    if(!window.confirm("บันทึก “ชงเสีย / ทำใหม่” "+item.name+" 1 แก้ว?\nระบบจะหักวัตถุดิบเพิ่มตามสูตรที่ใช้ตอนขาย และลงค่าใช้จ่าย WASTE อัตโนมัติ"))return;
    setQueueBusy(true);setMessage("");
    try{
      const result=await sendQueueActionDurably(session.csrf,{
        requestKey:crypto.randomUUID(),
        orderId:order.id,
        itemIndex,
        action:"waste_remake",
        reason:"ชงเสีย / ทำใหม่"
      });
      if(Array.isArray(result?.orders))setQueue(result.orders);
      else await refresh("queue",true);
      setMessage("บันทึก WASTE "+item.name+" 1 แก้วแล้ว · หัก Stock เพิ่มตามสูตร"+(Number(result?.wasteCost)>0?" · ต้นทุนของเสีย ฿"+formatMoney(Number(result.wasteCost)):"")+" · ทำใหม่ต่อในคิวเดิม");
    }catch(e:any){
      setMessage(shouldRetainQueuePending(e)
        ?"ผล WASTE ยังไม่ชัดเจน · ระบบเก็บ request เดิมไว้ ห้ามกดซ้ำจนกว่าจะตรวจสำเร็จ"
        :queueActionErrorText(e.message));
      await refresh("queue",true).catch(()=>{});
    }finally{setQueueBusy(false)}
  }

  function quickQueueStep(order:QueueOrder){
    const itemIndex=(order.items||[]).findIndex(item=>n(item.readyQty)<n(item.qty));
    if(itemIndex>=0){
      const item=order.items[itemIndex],remaining=Math.max(0,n(item.qty)-n(item.readyQty));
      return {label:"ทำ "+item.name+" ครบ"+(remaining>1?" · อีก "+remaining+" แก้ว":""),icon:CheckCircle2};
    }
    if((order.items||[]).some(item=>n(item.calledQty)<n(item.qty)))return {label:"เรียกลูกค้า "+order.queueNo,icon:BellRing};
    return {label:"ส่งมอบ "+order.queueNo,icon:CheckCircle2};
  }


  useEffect(()=>{
    if(!open)return;
    const sync=(quiet=true)=>{
      refresh("all",quiet).catch(()=>setMessage("โหลดข้อมูลร้านไม่สำเร็จ · หน้าขายยังใช้งานต่อได้"));
      recoverExpense().catch(()=>{});
      recoverQueueAction().catch(()=>{});
    };
    const onOnline=()=>sync(true);
    const onFocus=()=>sync(true);
    const onVisible=()=>{if(document.visibilityState==="visible")sync(true)};
    sync(false);
    if(!cloudAvailable)return;
    const timer=window.setInterval(()=>{
      if(document.visibilityState!=="hidden")refresh(activeTabRef.current,true).catch(()=>{});
    },5000);
    window.addEventListener("online",onOnline);
    window.addEventListener("focus",onFocus);
    document.addEventListener("visibilitychange",onVisible);
    return()=>{
      window.clearInterval(timer);
      window.removeEventListener("online",onOnline);
      window.removeEventListener("focus",onFocus);
      document.removeEventListener("visibilitychange",onVisible);
    };
  },[open,session.csrf,cloudAvailable,canQueue,canOrder,canStock,canExpense,canReadiness]);

  async function saveExpense(){
    if(!(Number(expenseAmount)>0)||expenseBusy||!cloudAvailable)return;
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

  const queueSorted=queue.slice().sort((a,b)=>n(a.time)-n(b.time));
  const queueRows=queueSorted.slice(0,6);
  const productionHead=queueSorted.find(order=>(order.items||[]).some(item=>n(item.calledQty)<n(item.qty)))||null;
  const latestSales=sales.slice(0,7);
  const latestExpenses=expenses.slice(0,5);
  const stockHealth=useMemo(()=>{
    const rows:{key:string;name:string;variant:string;level:"out"|"low";detail:string}[]=[];
    for(const menu of (bootstrap?.menu||[]).filter(x=>x.enabled))for(const variant of menu.variants||[]){
      if(!variant.available){
        const missing=(variant.missingIngredients||[]).map(x=>x.name).join(", ");
        rows.push({key:menu.id+"|"+variant.label,name:menu.name,variant:variant.label,level:"out",detail:missing||variant.reason||"ทำไม่ได้"});
      }else if(variant.lowStock)rows.push({key:menu.id+"|"+variant.label,name:menu.name,variant:variant.label,level:"low",detail:"ทำได้ประมาณ "+variant.maxServings+" แก้ว"});
    }
    return rows;
  },[bootstrap?.menu]);
  const stockRows=stockHealth.slice(0,12);
  const outCount=stockHealth.filter(x=>x.level==="out").length,lowCount=stockHealth.filter(x=>x.level==="low").length;

  if(!open)return null;
  const todayBlockers=n(closeStatus?.paymentBlockers?.length)+n(closeStatus?.orderBlockers?.length)+(readiness?.accounting?.ok===false?1:0);
  const tabMeta:{key:HubTab;label:string;icon:any;count?:number;allowed:boolean}[]=[
    {key:"today",label:"วันนี้",icon:CalendarCheck2,count:todayBlockers,allowed:canReport},
    {key:"queue",label:"คิว",icon:ListOrdered,count:queue.length,allowed:canQueue},
    {key:"orders",label:"ออเดอร์",icon:ClipboardList,count:sales.length,allowed:canOrder},
    {key:"stock",label:"สต็อก",icon:Boxes,count:outCount+lowCount,allowed:canStock},
    {key:"expenses",label:"รายจ่าย",icon:ReceiptText,allowed:canExpense}
  ];

  const visibleTabs=tabMeta.filter(x=>x.allowed);
  function onTabKeyDown(event:import("react").KeyboardEvent<HTMLButtonElement>,key:HubTab){
    const index=visibleTabs.findIndex(x=>x.key===key);
    if(index<0)return;
    let nextIndex:number|undefined;
    if(event.key==="ArrowRight"||event.key==="ArrowDown")nextIndex=(index+1)%visibleTabs.length;
    else if(event.key==="ArrowLeft"||event.key==="ArrowUp")nextIndex=(index-1+visibleTabs.length)%visibleTabs.length;
    else if(event.key==="Home")nextIndex=0;
    else if(event.key==="End")nextIndex=visibleTabs.length-1;
    if(nextIndex===undefined)return;
    event.preventDefault();
    const next=visibleTabs[nextIndex]?.key;
    if(!next)return;
    setTab(next);
    window.requestAnimationFrame(()=>tabRefs.current[next]?.focus());
  }
  return <div className="fixed inset-0 z-[90] flex items-end bg-black/30 backdrop-blur-[2px] sm:items-stretch sm:justify-end" onClick={onClose}>
    <aside ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="field-operations-title" onClick={e=>e.stopPropagation()} className="flex max-h-[88dvh] w-full flex-col rounded-t-[28px] bg-[#f6f7f8] shadow-2xl outline-none sm:h-full sm:max-h-none sm:w-[520px] sm:rounded-none sm:border-l sm:border-slate-300">
      <div className="mx-auto mt-2 h-1 w-12 rounded-full bg-slate-300 sm:hidden"/>
      <header className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-4 sm:px-5">
        <div><p className="m-0 text-[10px] font-black tracking-[.22em] text-[#765b08]">งานร้าน FIELD</p><h2 id="field-operations-title" className="mt-1 text-xl font-black text-slate-900">งานร้าน</h2><p className="mt-1 text-xs text-slate-500">ดูงานหลักและบันทึกรายจ่ายด่วนโดยไม่ออกจากหน้า POS</p></div>
        <div className="flex gap-1"><button disabled={loading} onClick={()=>refresh(tab)} aria-label="รีเฟรชแท็บงานร้าน" className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white disabled:opacity-40"><RefreshCw size={17}/></button><button onClick={onClose} aria-label="ปิดงานร้าน" className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white"><X size={18}/></button></div>
      </header>

      <div role="tablist" aria-label="งานร้าน" aria-orientation="horizontal" className="grid gap-1 border-b border-slate-200 bg-white p-2" style={{gridTemplateColumns:`repeat(${Math.max(1,visibleTabs.length)},minmax(0,1fr))`}}>
        {visibleTabs.map(({key,label,icon:Icon,count})=><button key={key} ref={node=>{tabRefs.current[key]=node}} id={"field-operations-tab-"+key} role="tab" aria-selected={tab===key} aria-controls={"field-operations-panel-"+key} tabIndex={tab===key?0:-1} onClick={()=>setTab(key)} onKeyDown={event=>onTabKeyDown(event,key)} className={"relative flex min-h-12 flex-col items-center justify-center rounded-xl px-1 text-[10px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F4D3A] "+(tab===key?"bg-[#d4af37]/20 text-[#6f5510]":"text-slate-600 hover:bg-slate-100")}><Icon size={17}/><span className="mt-0.5">{label}</span>{Number(count)>0&&<span className="absolute right-2 top-1 rounded-full bg-slate-900 px-1.5 text-[9px] text-white">{count}</span>}</button>)}
      </div>

      {message&&<div className="mx-3 mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">{message}</div>}

      <div role="tabpanel" id={"field-operations-panel-"+tab} aria-labelledby={"field-operations-tab-"+tab} className="soft-scroll min-h-0 flex-1 overflow-auto p-3 sm:p-4">
        {tab==="today"&&canReport&&<div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-[10px] font-bold text-slate-500">ยอดขายวันนี้</p><b className="mt-1 block text-2xl text-[#765b08]">฿{formatMoney(n(todaySummary?.todayRevenue))}</b></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-[10px] font-bold text-slate-500">ออเดอร์วันนี้</p><b className="mt-1 block text-2xl">{n(todaySummary?.todayOrders)}</b></div>
          </div>
          <div className={"rounded-2xl border p-4 "+(todayBlockers>0?"border-amber-300 bg-amber-50":"border-emerald-200 bg-emerald-50")}>
            <div className="flex items-start justify-between gap-3"><div><b>{todayBlockers>0?"ยังปิดวันไม่ได้":"พร้อมตรวจปิดวัน"}</b><p className="mt-1 text-xs text-slate-600">{todayBlockers>0?"ต้องเคลียร์คิวหรือรายการชำระที่ค้างก่อน เพื่อไม่ให้ยอดและ Stock คลาดเคลื่อน":"ไม่พบคิวหรือ payment blocker จากข้อมูลล่าสุด"}</p></div><span className={"rounded-full px-2 py-1 text-[10px] font-black "+(todayBlockers>0?"bg-amber-200 text-amber-900":"bg-emerald-200 text-emerald-900")}>{todayBlockers>0?todayBlockers+" ค้าง":"OK"}</span></div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-center"><Metric label="คิวค้าง" value={n(closeStatus?.orderBlockers?.length)}/><Metric label="ชำระค้าง" value={n(closeStatus?.paymentBlockers?.length)}/></div>
          </div>
          {canReadiness&&readiness&&<div className={"rounded-2xl border p-4 "+(readiness.readyForFullOperations?"border-emerald-200 bg-emerald-50":readiness.accounting?.ok===false?"border-red-200 bg-red-50":"border-amber-200 bg-amber-50")}>
            <div className="flex items-start justify-between gap-3">
              <div><b>ความพร้อมระบบ</b><p className="mt-1 text-xs text-slate-600">{readiness.accounting?.ok===false?"บัญชีมี Critical mismatch · ระบบบล็อก Close Day อัตโนมัติ":readiness.readyForFullOperations?"ขาย/สต็อก/ต้นทุน/Payment ผ่านเงื่อนไขหลัก":"ยังมี Warning ที่ควรตรวจ แต่ระบบไม่เดาหรือแก้ยอดเอง"}</p></div>
              <span className={"rounded-full px-2 py-1 text-[10px] font-black "+(readiness.readyForFullOperations?"bg-emerald-200 text-emerald-900":readiness.accounting?.ok===false?"bg-red-200 text-red-800":"bg-amber-200 text-amber-900")}>{readiness.readyForFullOperations?"READY":readiness.accounting?.ok===false?"BLOCK":"CHECK"}</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center"><Metric label="ขายเงินสด" value={readiness.readyForCashSales?1:0}/><Metric label="PromptPay" value={readiness.readyForPromptPay?1:0}/><Metric label="บัญชี" value={readiness.accounting?.ok===false?0:1}/></div>
            {readiness.accounting?.ok===false&&<div className="mt-3 rounded-xl bg-white p-3 text-xs text-red-800">
              <b>พบ {n(readiness.accounting?.blocking?.length)} จุด Critical · ระบบไม่ปิดวันให้จนกว่าจะตรง</b>
              {readiness.accountingCauses?.[0]&&<div className="mt-2 border-t border-red-100 pt-2"><b>{readiness.accountingCauses[0].title}</b><p className="mt-1 text-red-700">{readiness.accountingCauses[0].explanation}</p></div>}
              {canOrder&&<button type="button" onClick={()=>setTab("orders")} className="mt-3 min-h-11 w-full rounded-xl border border-red-200 bg-red-50 px-3 font-bold text-red-800">ตรวจออเดอร์ในงานร้าน</button>}
            </div>}
          </div>}
          {!!todaySummary?.lowStock?.length&&<div className="rounded-2xl border border-amber-200 bg-white p-4"><b className="text-sm">สต็อกที่ควรดูวันนี้</b><p className="mt-2 text-xs text-slate-600">{todaySummary.lowStock.slice(0,4).map(x=>x.name).join(" · ")}</p><button onClick={()=>setTab("stock")} className="mt-3 min-h-11 w-full rounded-xl border border-slate-300 bg-white text-xs font-bold">ดูสต็อกในหน้านี้</button></div>}
          {!!todaySummary?.recommendations?.length&&<div className="rounded-2xl border border-slate-200 bg-white p-4"><b className="text-sm">ระบบแนะนำ</b><p className="mt-2 text-xs font-semibold text-slate-800">{todaySummary.recommendations[0].title}</p><p className="mt-1 text-xs text-slate-500">{todaySummary.recommendations[0].detail}</p></div>}
          <div className="grid grid-cols-2 gap-2"><FullLink href="/dashboard" label="ดูสรุปทั้งหมด"/><FullLink href="/close" label="ตรวจและปิดวัน"/></div>
          <p className="rounded-xl bg-blue-50 px-3 py-2 text-[10px] text-blue-800">แท็บ “วันนี้” เป็นข้อมูลอ่านอย่างเดียว · การปิดวันยังทำในหน้าปิดวันเพื่อให้ตรวจเงินสดและรายการค้างครบก่อนยืนยัน</p>
        </div>}

        {tab==="queue"&&canQueue&&<div className="space-y-2">
          {queueRows.length===0?<Empty text={!cloudAvailable?"ออฟไลน์ · ยังดึงคิวล่าสุดไม่ได้":"ไม่มีคิวที่กำลังทำ"}/>:queueRows.map(order=>{
            const total=(order.items||[]).reduce((s,x)=>s+n(x.qty),0),ready=(order.items||[]).reduce((s,x)=>s+Math.min(n(x.qty),n(x.readyQty)),0),called=(order.items||[]).reduce((s,x)=>s+Math.min(n(x.qty),n(x.calledQty)),0);
            const allCalled=total>0&&called>=total,isProduction=productionHead?.id===order.id;
            const nextIndex=isProduction?(order.items||[]).findIndex(item=>n(item.readyQty)<n(item.qty)):-1;
            const nextItem=nextIndex>=0?order.items[nextIndex]:null;
            const prepMatch=nextItem?(order.prepGroups||[]).flatMap(group=>(group.items||[]).map(item=>({group,item}))).find(x=>String(x.item.id||"")===String(nextItem.id||"")&&String(x.item.variant||"")===String(nextItem.variant||"")):null;
            const quick=(isProduction||allCalled)?quickQueueStep(order):null,QuickIcon=quick?.icon;
            return <div key={order.id} className={"rounded-2xl border bg-white p-3 "+(isProduction?"border-[#d4af37] shadow-sm":allCalled?"border-emerald-200":"border-slate-200")}>
              <div className="flex items-center justify-between gap-3"><div><b className="text-base">{order.queueNo}</b><span className="ml-2 text-xs text-slate-500">บัตร {order.pagerNo||"—"}</span>{isProduction&&<span className="ml-2 rounded-full bg-[#fff3bf] px-2 py-1 text-[9px] font-black text-[#765b08]">ทำตอนนี้</span>}{allCalled&&<span className="ml-2 rounded-full bg-emerald-100 px-2 py-1 text-[9px] font-black text-emerald-800">รอลูกค้ารับ</span>}</div><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase">{order.status}</span></div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs"><Metric label="ทั้งหมด" value={total}/><Metric label="ทำแล้ว" value={ready}/><Metric label="เรียกแล้ว" value={called}/></div>
              <p className="mt-2 line-clamp-2 text-xs text-slate-500">{(order.items||[]).map(x=>x.name+" ×"+x.qty).join(" · ")}</p>
              {isProduction&&nextItem&&<div className="mt-2 rounded-xl border border-[#ead58d] bg-[#fffaf0] p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-1"><b className="text-[11px] text-slate-800">ทำตอนนี้ · {nextItem.name}</b>{nextItem.variant&&nextItem.variant!=="Standard"&&<span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-bold text-[#765b08]">{nextItem.variant}</span>}</div>
                {prepMatch?.group?.label&&<p className="mt-1 text-[9px] font-semibold text-[#765b08]">หมวดเบส: {prepMatch.group.label}</p>}
                {prepMatch?.item?.recipeUsage?.length?<p className="mt-1.5 text-[10px] leading-5 text-slate-600"><span className="font-bold text-slate-700">สูตรต่อแก้ว:</span> {prepMatch.item.recipeUsage.map(row=>row.name+" "+row.perCup+" "+row.unit).join(" · ")}</p>:<p className="mt-1.5 text-[10px] text-slate-500">สูตรละเอียดดูได้ในหน้าคิวเต็ม</p>}
              </div>}
              {quick&&QuickIcon&&<div className={"mt-3 grid gap-2 "+(isProduction&&nextItem?"grid-cols-[auto_1fr]":"grid-cols-1")}>
                {isProduction&&nextItem&&<button disabled={queueBusy||!cloudAvailable} onClick={()=>runQuickWasteRemake(order,nextIndex)} className="flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 text-[11px] font-black text-red-700 disabled:opacity-40"><RotateCcw size={15}/>ชงเสีย / ทำใหม่</button>}
                <button disabled={queueBusy||!cloudAvailable} onClick={()=>runQuickQueueAction(order)} className={"flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-sm font-black disabled:opacity-40 "+(allCalled?"bg-emerald-600 text-white":"bg-[#1F4D3A] text-white")}><QuickIcon size={17}/>{queueBusy?"กำลังยืนยันคิวเดิม…":quick.label}</button>
              </div>}
              {!isProduction&&!allCalled&&<p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-[10px] font-semibold text-slate-500">รอคิวก่อนหน้า · ระบบไม่อนุญาตให้ข้ามคิว</p>}
            </div>
          })}
          <p className="rounded-xl bg-blue-50 px-3 py-2 text-[10px] text-blue-800">ปุ่มด่วนรองรับ flow ปกติ: ทำเมนูถัดไป → เรียกคิว → ส่งมอบ · ชงเสีย/ทำใหม่/เรียกแยกหมวด/ดูเบสละเอียด ให้เปิดหน้าคิวเต็ม</p>
          <FullLink href="/queue" label="เปิดหน้าคิวเต็ม / งานผลิตละเอียด"/>
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
              <button disabled={expenseBusy||!cloudAvailable||!(Number(expenseAmount)>0)} onClick={saveExpense} className="min-h-12 rounded-xl bg-[#1F4D3A] px-4 text-sm font-bold text-white disabled:opacity-40">{expenseBusy?"กำลังตรวจรายการเดิม…":"บันทึก · อยู่หน้า POS ต่อ"}</button>
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
