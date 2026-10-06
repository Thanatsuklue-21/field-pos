"use client";

// FIELD guided single-task production flow: recommend → acknowledge → complete → call → handoff.

import {useEffect,useMemo,useRef,useState} from "react";
import {BellRing,CheckCircle2,RotateCcw,X} from "lucide-react";
import AuthGate from "@/components/auth-gate";
import {api,type RevisionUnchanged,type Session} from "@/lib/api-client";
import {readQueueSnapshotCache,writeQueueSnapshotCache} from "@/lib/queue-cache";

type PrepUsage={id:string;name:string;qty:number;unit:string};
type BatchMode="NONE"|"SEQUENTIAL"|"COMBINED";
type PrepGroup={id:string;compatibilityKeys:string[];label:string;batchMode:BatchMode;qty:number;pendingQty?:number;items:{id:string;name:string;variant:string;qty:number;pendingQty?:number;compatibilityKey:string;baseUsage:{id:string;name:string;perCup:number;qty:number;pendingQty?:number;unit:string}[];recipeUsage:{id:string;name:string;perCup:number;unit:string}[]}[];baseUsage:(PrepUsage&{pendingQty?:number})[]};
type QItem={id:string;name:string;variant:string;qty:number;price:number|null;readyQty?:number;calledQty?:number;prepSelected?:boolean;wasteCount?:number;prepGroup?:{id:string;compatibilityKey:string;label:string;batchMode:BatchMode};saleIds?:string[]};
type QOrder={id:string;queueNo:string;pagerNo:number;status:string;time:number;total:number;billNo?:string|null;saleId?:string|null;saleIds?:string[];items:QItem[];prepGroups?:PrepGroup[]};
type QueueSnapshot={revision:number;unchanged?:false;orders:QOrder[]};

const n=(v:any)=>Number(v)||0;
const itemDone=(item:QItem)=>n(item.readyQty)>=n(item.qty);
const itemCalled=(item:QItem)=>n(item.calledQty)>=n(item.qty);
const orderReady=(order:QOrder)=>(order.items||[]).length>0&&(order.items||[]).every(itemDone);
const orderCalled=(order:QOrder)=>(order.items||[]).length>0&&(order.items||[]).every(itemCalled);

function nextTask(orders:QOrder[]){
  const first=orders.find(order=>!orderCalled(order));
  if(!first)return null;
  for(let index=0;index<(first.items||[]).length;index++){
    const item=first.items[index];
    if(item.prepSelected&&!itemDone(item))return {order:first,item,index,selected:true};
  }
  for(let index=0;index<(first.items||[]).length;index++){
    const item=first.items[index];
    if(!itemDone(item))return {order:first,item,index,selected:false};
  }
  return null;
}

type FlowBase={key:string;qty:number;pendingQty:number;items:PrepGroup["items"]};
type FlowCategory={id:string;label:string;qty:number;pendingQty:number;baseGroups:FlowBase[];items:QItem[]};

function categoryName(id:string,label?:string){
  const clean=String(id||label||"OTHER").replaceAll("_"," ").trim();
  return clean||"OTHER";
}
function buildCategoryFlow(order:QOrder):FlowCategory[]{
  const itemGroups=new Map<string,QItem[]>();
  for(const item of order.items||[]){
    const id=String(item.prepGroup?.id||"OTHER");
    const list=itemGroups.get(id)||[];list.push(item);itemGroups.set(id,list);
  }
  return (order.prepGroups||[]).map(group=>{
    const bases=new Map<string,FlowBase>();
    for(const item of group.items||[]){
      const key=String(item.compatibilityKey||group.id);
      let base=bases.get(key);if(!base){base={key,qty:0,pendingQty:0,items:[]};bases.set(key,base)}
      base.qty+=n(item.qty);base.pendingQty+=n(item.pendingQty);base.items.push(item);
    }
    return {id:group.id,label:categoryName(group.id,group.label),qty:n(group.qty),pendingQty:n(group.pendingQty),baseGroups:[...bases.values()],items:itemGroups.get(group.id)||[]};
  });
}
function baseTitle(base:FlowBase,index:number,total:number){
  if(base.items.length>1)return "เบสเดียวกัน "+base.qty+" แก้ว";
  if(total>1)return "เบสชุด "+(index+1)+" · "+base.qty+" แก้ว";
  return "เบสของหมวดนี้ · "+base.qty+" แก้ว";
}

export default function Queue(){return <AuthGate>{session=><QueueView session={session}/>}</AuthGate>}

function QueueView({session}:{session:Session}){
  const [data,setData]=useState<QueueSnapshot|null>(null);
  const [syncing,setSyncing]=useState(true);
  const [busy,setBusy]=useState("");
  const [msg,setMsg]=useState("");
  const [notice,setNotice]=useState("");
  const [toast,setToast]=useState("");
  const busyRef=useRef(false);
  const revisionRef=useRef<number|null>(null);
  busyRef.current=busy!=="";
  useEffect(()=>{if(!toast)return;const timer=window.setTimeout(()=>setToast(""),2600);return()=>window.clearTimeout(timer)},[toast]);
  const pulse=(message:string)=>{setToast(message);try{navigator.vibrate?.(35)}catch{}};
  const optimistic=(mutate:(orders:QOrder[])=>QOrder[])=>setData(prev=>prev?{...prev,orders:mutate(prev.orders)}:prev);

  const acceptSnapshot=(next:QueueSnapshot|RevisionUnchanged)=>{
    if(next?.unchanged===true){setSyncing(false);return false}
    if(next.revision<(revisionRef.current??0))return false;
    revisionRef.current=Number(next.revision)||0;
    setData(prev=>!prev||next.revision>=prev.revision?next:prev);
    writeQueueSnapshotCache(next as QueueSnapshot);
    setSyncing(false);
    return true;
  };
  const load=()=>api<QueueSnapshot|RevisionUnchanged>("/api/pos/queue",revisionRef.current===null?{}:{headers:{"X-Field-Revision":String(revisionRef.current)}}).then(acceptSnapshot);
  useEffect(()=>{
    const cached=readQueueSnapshotCache<QueueSnapshot>();
    if(cached){revisionRef.current=cached.revision;setData(cached)}
    let disposed=false,inFlight=false;
    const refresh=async()=>{
      if(disposed||inFlight||busyRef.current||document.visibilityState==="hidden")return;
      inFlight=true;
      try{
        const next=await api<QueueSnapshot|RevisionUnchanged>("/api/pos/queue",revisionRef.current===null?{}:{headers:{"X-Field-Revision":String(revisionRef.current)}});
        if(!disposed&&!busyRef.current)acceptSnapshot(next);
      }catch(e:any){if(!disposed)setMsg(e.message==="network_unavailable"?"ขาดการเชื่อมต่อ · ตรวจคิวล่าสุดก่อนทำต่อ":e.message)}
      finally{inFlight=false;if(!disposed)setSyncing(false)}
    };
    refresh();
    const timer=window.setInterval(refresh,5000);
    window.addEventListener("focus",refresh);
    document.addEventListener("visibilitychange",refresh);
    return()=>{disposed=true;window.clearInterval(timer);window.removeEventListener("focus",refresh);document.removeEventListener("visibilitychange",refresh)};
  },[]);

  const applyState=(r:any)=>{
    const orders=Array.isArray(r?.orders)?r.orders:null;
    if(!orders)return false;
    const revision=Number(r.revision)||0;
    revisionRef.current=Math.max(revisionRef.current||0,revision);
    setData(prev=>{
      const next=prev&&revision>=prev.revision?{...prev,revision,orders}:prev;
      if(next)writeQueueSnapshotCache(next as QueueSnapshot);
      return next;
    });
    return true;
  };

  const orders=useMemo(()=>((data?.orders||[]) as QOrder[]).slice().sort((a,b)=>n(a.time)-n(b.time)),[data]);
  const task=useMemo(()=>nextTask(orders),[orders]);
  const selectedTask=task?.selected?task:null;
  const recommendedTask=task&&!task.selected?task:null;



  function errorText(code:string){
    return code==="fifo_violation"?"ต้องทำคิวแรกให้เสร็จก่อน ระบบไม่อนุญาตให้ข้ามไปทำคิวถัดไป":
      code==="order_not_ready"?"ยังทำเครื่องดื่มไม่ครบ":
      code==="item_not_ready_for_call"?"เมนูนี้ยังไม่มีแก้วที่พร้อมเรียก":
      code==="pager_already_called"?"บัตรคิวนี้ถูกบันทึกว่าเรียกแล้ว":
      code==="waste_after_call_not_supported"?"เรียกลูกค้ารับเมนูนี้ครบแล้ว จึงไม่ย้อนเป็นชงเสียอัตโนมัติ":
      code==="recipe_unavailable"?"ไม่พบสูตรที่ใช้ตอนขาย จึงบันทึกชงเสียอัตโนมัติไม่ได้":
      code.startsWith("stock_shortage:")?"วัตถุดิบไม่พอสำหรับทำใหม่ 1 แก้ว · กรุณาตรวจ Stock":
      code.startsWith("ingredient_missing:")?"สูตรอ้างวัตถุดิบที่ไม่มีใน Stock Master":
      code==="queue_state_changed"?"สถานะคิวเปลี่ยนแล้ว ระบบกำลังอัปเดต":code;
  }

  async function completeNext(order:QOrder,item:QItem,itemIndex:number){
    if(busyRef.current)return;
    const expectedReadyQty=n(item.readyQty),snapshot=data,key="done:"+order.id+":"+itemIndex;
    busyRef.current=true;setBusy(key);setMsg("");
    optimistic(list=>list.map(o=>o.id!==order.id?o:{...o,status:"making",items:o.items.map((x,index)=>index===itemIndex?{...x,readyQty:x.qty,prepSelected:false}:x)}));
    pulse("บันทึกว่าทำ "+item.name+" ครบแล้ว");
    try{
      const r=await api<any>("/api/pos/queue",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({requestKey:crypto.randomUUID(),orderId:order.id,itemIndex,action:"complete_item",expectedReadyQty})});
      if(!applyState(r))load().catch(()=>{});
      const updated=(r?.orders||[]).find((x:any)=>x.id===order.id);
      const updatedItem=updated?.items?.[itemIndex];
      if(updatedItem&&n(updatedItem.readyQty)>=n(updatedItem.qty)){
        const nextRecommended=nextTask((r.orders||[]) as QOrder[]);
        const fromCategory=String(item.prepGroup?.id||"");
        const toCategory=String(nextRecommended?.item.prepGroup?.id||"");
        setNotice(nextRecommended?`เสร็จแล้ว · ทำ ${nextRecommended.item.name} ต่อ`:`เสร็จครบแล้ว · กดเรียกคิว`);
      }
    }catch(e:any){if(snapshot)setData(snapshot);setMsg(errorText(e.message));await load().catch(()=>{})}finally{busyRef.current=false;setBusy("")}
  }

  async function wasteRemake(order:QOrder,item:QItem,itemIndex:number){
    if(busyRef.current)return;
    if(!window.confirm("บันทึก “ชงเสีย / ทำใหม่” "+item.name+" 1 แก้ว?\nระบบจะหักวัตถุดิบเพิ่มตามสูตรที่ใช้ตอนขาย และลงค่าใช้จ่าย WASTE อัตโนมัติ"))return;
    const snapshot=data,key="waste:"+order.id+":"+itemIndex;busyRef.current=true;setBusy(key);setMsg("");
    optimistic(list=>list.map(o=>o.id!==order.id?o:{...o,status:"making",items:o.items.map((x,index)=>index===itemIndex?{...x,readyQty:n(x.readyQty)>n(x.calledQty)?n(x.readyQty)-1:n(x.readyQty),prepSelected:true,wasteCount:n(x.wasteCount)+1}:x)}));
    pulse("บันทึกชงเสีย · เตรียมทำใหม่ 1 แก้ว");
    try{
      const r=await api<any>("/api/pos/queue",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({requestKey:crypto.randomUUID(),orderId:order.id,itemIndex,action:"waste_remake",reason:"ชงเสีย / ทำใหม่"})});
      if(!applyState(r))load().catch(()=>{});
      setNotice("บันทึก WASTE "+item.name+" 1 แก้วแล้ว · หัก Stock เพิ่มตามสูตร"+(Number(r?.wasteCost)>0?" · ต้นทุนของเสีย ฿"+Number(r.wasteCost).toFixed(2):"")+" · ทำใหม่ต่อในคิวเดิม");
    }catch(e:any){if(snapshot)setData(snapshot);setMsg(errorText(e.message));await load().catch(()=>{})}finally{busyRef.current=false;setBusy("")}
  }

  async function callOrder(order:QOrder){
    if(busyRef.current)return;
    const snapshot=data,key="call:"+order.id;busyRef.current=true;setBusy(key);setMsg("");
    optimistic(list=>list.map(o=>o.id!==order.id?o:{...o,status:"ready",items:o.items.map(x=>({...x,calledQty:x.qty,prepSelected:false}))}));
    setToast("");setNotice("");
    try{
      const r=await api<any>("/api/pos/queue",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({requestKey:crypto.randomUUID(),orderId:order.id,action:"call"})});
      if(!applyState(r))load().catch(()=>{});

    }catch(e:any){if(snapshot)setData(snapshot);setMsg(errorText(e.message));await load().catch(()=>{})}finally{busyRef.current=false;setBusy("")}
  }

  async function deliver(orderId:string){
    if(busyRef.current)return;
    const snapshot=data,order=orders.find(x=>x.id===orderId),key="return:"+orderId;busyRef.current=true;setBusy(key);setMsg("");
    optimistic(list=>list.filter(o=>o.id!==orderId));
    pulse("กำลังส่งมอบ "+(order?.queueNo||"คิว")+"…");
    try{
      const r=await api<any>("/api/pos/queue",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({requestKey:crypto.randomUUID(),orderId,action:"return"})});
      if(!applyState(r))load().catch(()=>{});
      setNotice("ลูกค้ารับสินค้าแล้ว");
      pulse("✓ ส่งมอบ "+(order?.queueNo||"คิว")+" เรียบร้อยแล้ว");
    }catch(e:any){if(snapshot)setData(snapshot);setMsg(errorText(e.message));pulse("ส่งมอบไม่สำเร็จ · ระบบคืนคิวกลับแล้ว");await load().catch(()=>{})}finally{busyRef.current=false;setBusy("")}
  }

  const first=orders.find(order=>!orderCalled(order));
  const firstReady=first?orderReady(first):false;
  const firstCalled=first?orderCalled(first):false;
  const firstCupCount=first?(first.items||[]).reduce((sum,item)=>sum+n(item.qty),0):0;
  const firstRemaining=first?(first.items||[]).reduce((sum,item)=>sum+Math.max(0,n(item.qty)-n(item.readyQty)),0):0;
  const categoryFlow=first?buildCategoryFlow(first):[];
  const activeCategoryId=String(task?.item.prepGroup?.id||categoryFlow.find(x=>x.pendingQty>0)?.id||"");
  const activeCategoryIndex=Math.max(0,categoryFlow.findIndex(x=>x.id===activeCategoryId));
  const activeCategory=categoryFlow.find(x=>x.id===activeCategoryId)||null;
  const activeBaseKey=String(task?.item.prepGroup?.compatibilityKey||activeCategory?.baseGroups.find(x=>x.pendingQty>0)?.key||"");
  const activeBase=activeCategory?.baseGroups.find(x=>x.key===activeBaseKey)||activeCategory?.baseGroups.find(x=>x.pendingQty>0)||null;
  const upcoming=orders.filter(order=>!orderCalled(order)&&order.id!==first?.id).slice(0,3);
  const extraUpcoming=Math.max(0,orders.filter(order=>!orderCalled(order)).length-1-upcoming.length);
  const waitingPickup=orders.filter(orderCalled);

  return <section className="soft-scroll h-full overflow-y-auto overscroll-contain p-2.5 pb-28 sm:p-4 sm:pb-24 md:p-6 md:pb-8">
    <div className="mx-auto w-full max-w-4xl space-y-3">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 rounded-2xl bg-[#f3f5f7] py-2">
        <div><p className="gold m-0 text-[9px] font-bold tracking-[.26em]">PRODUCTION RUN</p><h1 className="mt-0.5 text-lg font-semibold sm:text-xl">ทำออเดอร์ / รันบัตร</h1></div>
        <div className="flex items-center gap-2">{syncing&&<span className="text-[10px] text-slate-400">กำลังซิงก์…</span>}<span className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[10px] font-semibold text-slate-600">กำลังทำ {orders.filter(o=>!orderCalled(o)).length}</span></div>
      </header>

      {msg&&<div className="rounded-2xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">{msg}</div>}
      {notice&&<div className="flex items-start justify-between gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><span>{notice}</span><button onClick={()=>setNotice("")}><X size={15}/></button></div>}

      {orders.length===0&&<div className="grid min-h-[55vh] place-items-center rounded-[24px] border border-dashed border-slate-300 bg-white/70 p-6 text-center">
        <div><CheckCircle2 size={34} className="mx-auto text-emerald-600"/><h2 className="mt-3 text-lg font-bold">ไม่มีบัตรที่ต้องทำ</h2><p className="mt-1 text-sm text-slate-500">เมื่อมีออเดอร์ใหม่ บัตรผลิตจะแสดงตรงนี้อัตโนมัติ</p></div>
      </div>}

      {first&&<section className="rounded-[24px] border-2 border-[#d4af37]/60 bg-white p-3 shadow-sm sm:p-4">
        <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-start">
          <div className="rounded-[20px] bg-[#fff3bf] px-4 py-3 text-center">
            <small className="block text-[9px] font-bold tracking-[.18em] text-[#765b08]">บัตรเรียกคิว</small>
            <div className="mt-1 text-4xl font-black leading-none text-[#6f5510]">{first.pagerNo||"—"}</div>
            <div className="mt-2 text-[10px] font-semibold text-[#765b08]">ลำดับ {first.queueNo}</div>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-[9px] font-bold tracking-[.18em] text-slate-400">บัตรผลิตปัจจุบัน</p><h2 className="mt-0.5 text-base font-black">{firstCupCount} แก้ว · เหลือทำ {firstRemaining}</h2></div>{activeCategory&&<span className="rounded-full bg-[#fff8dc] px-2.5 py-1 text-[10px] font-bold text-[#765b08]">หมวด {activeCategoryIndex+1}/{categoryFlow.length} · {activeCategory.label}</span>}</div>

            <div className="mt-3">
              <p className="text-[10px] font-bold tracking-[.14em] text-slate-500">รายการรวมในบัตรนี้</p>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">{first.items.map((item,index)=>{
                const done=itemDone(item),current=index===task?.index;
                return <div key={item.id+"|"+item.variant+"|"+index} className={"rounded-xl border px-2.5 py-2 "+(current?"border-[#d4af37] bg-[#fffaf0]":done?"border-emerald-200 bg-emerald-50":"border-slate-200 bg-slate-50")}>
                  <div className="flex items-center justify-between gap-2"><div className="min-w-0"><b className="block truncate text-[12px]">{item.name}</b><span className="text-[10px] text-slate-500">{item.variant&&item.variant!=="Standard"?item.variant+" · ":""}×{item.qty}</span></div><span className={"shrink-0 rounded-full px-2 py-1 text-[9px] font-bold "+(current?"bg-[#d4af37] text-black":done?"bg-emerald-100 text-emerald-700":"bg-white text-slate-500")}>{current?"ทำตอนนี้":done?"ครบแล้ว":"รอ"}</span></div>
                </div>;
              })}</div>
            </div>
          </div>
        </div>

        {categoryFlow.length>0&&<div className="mt-3 border-t border-slate-200 pt-3">
          <div className="flex items-center justify-between gap-2"><div><p className="text-[10px] font-bold tracking-[.14em] text-slate-500">หมวดงาน / Base เดียวกัน</p><p className="mt-0.5 text-[10px] text-slate-400">รวมเมนูที่เตรียม Base ร่วมกันไว้ในบัตรเดียว</p></div><span className="text-[10px] font-semibold text-slate-500">{categoryFlow.length} หมวด</span></div>
          <div className="mt-2 space-y-2">{categoryFlow.map((category,categoryIndex)=><div key={category.id} className={"rounded-2xl border p-2.5 "+(category.id===activeCategoryId?"border-[#d4af37] bg-[#fffaf0]":category.pendingQty<=0?"border-emerald-200 bg-emerald-50":"border-slate-200 bg-slate-50")}>
            <div className="flex items-center justify-between gap-2"><b className="text-[11px]">{categoryIndex+1}. {category.label} · {category.qty} แก้ว</b><span className="text-[9px] font-bold text-slate-500">{category.pendingQty>0?"เหลือ "+category.pendingQty:"ครบแล้ว"}</span></div>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">{category.baseGroups.map((base,baseIndex)=><div key={base.key} className={"rounded-xl border bg-white px-2.5 py-2 "+(base.key===activeBase?.key&&category.id===activeCategoryId?"border-[#d4af37]":"border-slate-200")}>
              <div className="flex items-center justify-between gap-2"><b className="text-[10px] text-[#765b08]">{baseTitle(base,baseIndex,category.baseGroups.length)}</b><span className="text-[9px] text-slate-400">{base.pendingQty>0?"เหลือ "+base.pendingQty:"ครบ"}</span></div>
              <div className="mt-1 flex flex-wrap gap-1">{base.items.map(x=><span key={x.id+"|"+x.variant} className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-semibold text-slate-600">{x.name} ×{x.qty}</span>)}</div>
            </div>)}</div>
          </div>)}</div>
        </div>}

        {task&&activeCategory&&activeBase&&<div className="mt-3 rounded-[20px] border-2 border-[#d4af37] bg-[#fffaf0] p-3">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-[9px] font-bold tracking-[.16em] text-[#9a7a16]">ขั้นตอนปัจจุบัน</p><h3 className="mt-1 text-base font-black">{task.item.name}</h3><p className="mt-1 text-[11px] text-slate-500">{task.item.variant&&task.item.variant!=="Standard"?task.item.variant+" · ":""}ทำอีก {Math.max(0,n(task.item.qty)-n(task.item.readyQty))} แก้ว · {activeCategory.label}</p></div><span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-[#765b08]">{baseTitle(activeBase,Math.max(0,activeCategory.baseGroups.findIndex(x=>x.key===activeBase.key)),activeCategory.baseGroups.length)}</span></div>
          <div className="mt-3 grid grid-cols-[auto_1fr] gap-2"><button disabled={busy!==""||itemCalled(task.item)} onClick={()=>wasteRemake(task.order,task.item,task.index)} className="min-h-12 rounded-2xl border border-red-200 bg-white px-3 text-[10px] font-bold text-red-600 disabled:opacity-40"><RotateCcw size={12} className="mr-1 inline"/>ชงเสีย / ทำใหม่</button><button disabled={busy!==""} onClick={()=>completeNext(task.order,task.item,task.index)} className="min-h-12 rounded-2xl bg-[#d4af37] px-4 text-sm font-black text-black disabled:opacity-40">ทำ {task.item.name} ครบ</button></div>
        </div>}

        {!task&&firstReady&&!firstCalled&&<div className="mt-3 grid gap-3 rounded-[20px] border border-emerald-300 bg-emerald-50 p-3 sm:grid-cols-[1fr_auto] sm:items-center"><div><span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700">ทำครบทั้งบัตรแล้ว</span><div className="mt-2 text-sm font-bold">พร้อมเรียกลูกค้ารับบัตร {first.pagerNo}</div></div><button disabled={busy!==""} onClick={()=>callOrder(first)} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#d4af37] px-5 text-sm font-black text-black"><BellRing size={17}/>เรียกบัตร {first.pagerNo}</button></div>}
      </section>}

      {first&&<section className="rounded-[18px] border border-slate-200 bg-white px-3 py-2">
        <div className="flex items-center gap-2"><b className="shrink-0 text-[10px] text-slate-500">บัตรถัดไป</b><div className="grid min-w-0 flex-1 grid-cols-3 gap-1.5">{upcoming.map(order=><div key={order.id} className="min-w-0 rounded-xl bg-slate-50 px-2 py-1.5 text-center"><div className="truncate text-[12px] font-black text-slate-700">บัตร {order.pagerNo}</div><div className="truncate text-[9px] text-slate-500">{(order.items||[]).reduce((sum,item)=>sum+n(item.qty),0)} แก้ว</div></div>)}{upcoming.length===0&&<div className="col-span-3 py-1 text-center text-[10px] text-slate-400">ไม่มีบัตรถัดไป</div>}</div>{extraUpcoming>0&&<span className="shrink-0 text-[9px] font-bold text-slate-500">+{extraUpcoming}</span>}</div>
      </section>}

      {waitingPickup.length>0&&<section className="rounded-[20px] border border-emerald-200 bg-white p-3">
        <div className="flex items-center justify-between"><h2 className="text-sm font-bold">รอลูกค้ารับ · {waitingPickup.length} บัตร</h2><span className="text-[10px] text-slate-400">ส่งมอบแล้วกดออกจากคิว</span></div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{waitingPickup.map(order=><div key={order.id} className="rounded-2xl border-2 border-emerald-400 bg-emerald-50 p-3 text-center">
          <small className="block text-[9px] font-bold text-emerald-700">บัตร</small><div className="mt-1 text-3xl font-black text-emerald-800">{order.pagerNo}</div><div className="mt-1 text-[10px] text-slate-500">{(order.items||[]).reduce((sum,item)=>sum+n(item.qty),0)} แก้ว</div>
          <button disabled={busy!==""} onClick={()=>deliver(order.id)} className="mt-2 min-h-12 w-full rounded-xl bg-emerald-600 px-2 text-sm font-bold text-white disabled:opacity-50">ลูกค้ารับแล้ว</button>
        </div>)}</div>
      </section>}
    </div>

    {toast&&<div className="fixed bottom-[76px] left-4 right-4 z-[95] mx-auto max-w-xl rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-center text-sm font-semibold text-emerald-800 shadow-xl sm:bottom-[92px]">{toast}</div>}
  </section>;
}
