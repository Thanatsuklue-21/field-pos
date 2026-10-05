"use client";

// FIELD guided single-task production flow: recommend → acknowledge → complete → call → handoff.

import {useEffect,useMemo,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {BellRing,CheckCircle2,ChevronRight,Layers3,ReceiptText,Sparkles,X} from "lucide-react";
import AuthGate from "@/components/auth-gate";
import {api,type RevisionUnchanged,type Session} from "@/lib/api-client";

type PrepUsage={id:string;name:string;qty:number;unit:string};
type BatchMode="NONE"|"SEQUENTIAL"|"COMBINED";
type PrepGroup={id:string;compatibilityKeys:string[];label:string;batchMode:BatchMode;qty:number;items:{id:string;name:string;variant:string;qty:number;compatibilityKey:string;baseUsage:{id:string;name:string;perCup:number;qty:number;unit:string}[]}[];baseUsage:PrepUsage[]};
type QItem={id:string;name:string;variant:string;qty:number;price:number|null;readyQty?:number;calledQty?:number;prepSelected?:boolean;prepGroup?:{id:string;compatibilityKey:string;label:string;batchMode:BatchMode};saleIds?:string[]};
type QOrder={id:string;queueNo:string;pagerNo:number;status:string;time:number;total:number;billNo?:string|null;saleId?:string|null;saleIds?:string[];items:QItem[];prepGroups?:PrepGroup[]};
type QueueSnapshot={revision:number;unchanged?:false;orders:QOrder[]};

const n=(v:any)=>Number(v)||0;
const itemDone=(item:QItem)=>n(item.readyQty)>=n(item.qty);
const itemCalled=(item:QItem)=>n(item.calledQty)>=n(item.qty);
const orderReady=(order:QOrder)=>(order.items||[]).length>0&&(order.items||[]).every(itemDone);
const orderCalled=(order:QOrder)=>(order.items||[]).length>0&&(order.items||[]).every(itemCalled);

function nextTask(orders:QOrder[]){
  const first=orders[0];
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

export default function Queue(){return <AuthGate>{session=><QueueView session={session}/>}</AuthGate>}

function QueueView({session}:{session:Session}){
  const router=useRouter();
  const [data,setData]=useState<QueueSnapshot|null>(null);
  const [busy,setBusy]=useState("");
  const [msg,setMsg]=useState("");
  const [notice,setNotice]=useState("");
  const [toast,setToast]=useState("");
  const busyRef=useRef(false);
  const revisionRef=useRef<number|null>(null);
  busyRef.current=busy!=="";
  const [callPrompt,setCallPrompt]=useState<{queueNo:string;pagerNo:number;scope:string}|null>(null);
  const [prepOpen,setPrepOpen]=useState(false);

  useEffect(()=>{if(!toast)return;const timer=window.setTimeout(()=>setToast(""),2600);return()=>window.clearTimeout(timer)},[toast]);
  const pulse=(message:string)=>{setToast(message);try{navigator.vibrate?.(35)}catch{}};
  const optimistic=(mutate:(orders:QOrder[])=>QOrder[])=>setData(prev=>prev?{...prev,orders:mutate(prev.orders)}:prev);

  const acceptSnapshot=(next:QueueSnapshot|RevisionUnchanged)=>{
    if(next?.unchanged===true)return false;
    revisionRef.current=Number(next.revision)||0;
    setData(prev=>!prev||next.revision>=prev.revision?next:prev);
    return true;
  };
  const load=()=>api<QueueSnapshot|RevisionUnchanged>("/api/pos/queue",revisionRef.current===null?{}:{headers:{"X-Field-Revision":String(revisionRef.current)}}).then(acceptSnapshot);
  useEffect(()=>{
    let disposed=false,inFlight=false;
    const refresh=async()=>{
      if(disposed||inFlight||busyRef.current||document.visibilityState==="hidden")return;
      inFlight=true;
      try{
        const next=await api<QueueSnapshot|RevisionUnchanged>("/api/pos/queue",revisionRef.current===null?{}:{headers:{"X-Field-Revision":String(revisionRef.current)}});
        if(!disposed)acceptSnapshot(next);
      }catch(e:any){if(!disposed)setMsg(e.message==="network_unavailable"?"ขาดการเชื่อมต่อ · ตรวจคิวล่าสุดก่อนทำต่อ":e.message)}
      finally{inFlight=false}
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
    setData(prev=>prev&&revision>=prev.revision?{...prev,revision,orders}:prev);
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
      code==="queue_state_changed"?"สถานะคิวเปลี่ยนแล้ว ระบบกำลังอัปเดต":code;
  }

  async function selectTask(orderId:string,itemIndex:number){
    const snapshot=data;const key="select:"+orderId+":"+itemIndex;setBusy(key);setMsg("");
    optimistic(list=>list.map(order=>({...order,items:(order.items||[]).map((item,index)=>({...item,prepSelected:order.id===orderId&&index===itemIndex}))})));
    pulse("รับงานแล้ว · กำลังบันทึก");
    try{
      const r=await api<any>("/api/pos/queue",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({requestKey:crypto.randomUUID(),orderId,itemIndex,action:"select",selected:true})});
      if(!applyState(r))load().catch(()=>{});
      setNotice("รับงานแล้ว · ระบบจะแสดงเมนูนี้เป็น “กำลังทำ” จนกว่าจะทำครบ");
    }catch(e:any){if(snapshot)setData(snapshot);setMsg(errorText(e.message));await load().catch(()=>{})}finally{setBusy("")}
  }

  async function completeNext(order:QOrder,item:QItem,itemIndex:number){
    const expectedReadyQty=n(item.readyQty),snapshot=data,key="done:"+order.id+":"+itemIndex;
    setBusy(key);setMsg("");
    optimistic(list=>list.map(o=>o.id!==order.id?o:{...o,status:"making",items:o.items.map((x,index)=>index===itemIndex?{...x,readyQty:x.qty,prepSelected:false}:x)}));
    pulse("บันทึกว่าทำ "+item.name+" ครบแล้ว");
    try{
      const r=await api<any>("/api/pos/queue",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({requestKey:crypto.randomUUID(),orderId:order.id,itemIndex,action:"complete_item",expectedReadyQty})});
      if(!applyState(r))load().catch(()=>{});
      const updated=(r?.orders||[]).find((x:any)=>x.id===order.id);
      const updatedItem=updated?.items?.[itemIndex];
      if(updatedItem&&n(updatedItem.readyQty)>=n(updatedItem.qty)){
        const nextRecommended=nextTask((r.orders||[]) as QOrder[]);
        setNotice(nextRecommended?`ทำ ${item.name} ครบแล้ว · ถัดไป ${nextRecommended.item.name}`:`ทำ ${item.name} ครบแล้ว · ตรวจปุ่มเรียกบัตรด้านล่าง`);
      }
    }catch(e:any){if(snapshot)setData(snapshot);setMsg(errorText(e.message));await load().catch(()=>{})}finally{setBusy("")}
  }

  async function callReadyItem(order:QOrder,item:QItem,itemIndex:number){
    const snapshot=data,key="callitem:"+order.id+":"+itemIndex;setBusy(key);setMsg("");
    optimistic(list=>list.map(o=>o.id!==order.id?o:{...o,items:o.items.map((x,index)=>index===itemIndex?{...x,calledQty:x.readyQty}:x)}));
    pulse("บันทึกการเรียกบัตร "+order.pagerNo);
    try{
      const r=await api<any>("/api/pos/queue",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({requestKey:crypto.randomUUID(),orderId:order.id,itemIndex,action:"call_item"})});
      if(!applyState(r))load().catch(()=>{});
      setCallPrompt({queueNo:order.queueNo,pagerNo:order.pagerNo,scope:`รับ ${item.name} ก่อน`});
    }catch(e:any){if(snapshot)setData(snapshot);setMsg(errorText(e.message));await load().catch(()=>{})}finally{setBusy("")}
  }

  async function callOrder(order:QOrder){
    const snapshot=data,key="call:"+order.id;setBusy(key);setMsg("");
    optimistic(list=>list.map(o=>o.id!==order.id?o:{...o,status:"ready",items:o.items.map(x=>({...x,calledQty:x.qty,prepSelected:false}))}));
    pulse("บันทึกการเรียกบัตร "+order.pagerNo);
    try{
      const r=await api<any>("/api/pos/queue",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({requestKey:crypto.randomUUID(),orderId:order.id,action:"call"})});
      if(!applyState(r))load().catch(()=>{});
      setCallPrompt({queueNo:order.queueNo,pagerNo:order.pagerNo,scope:"รับออเดอร์ทั้งหมด"});
    }catch(e:any){if(snapshot)setData(snapshot);setMsg(errorText(e.message));await load().catch(()=>{})}finally{setBusy("")}
  }

  async function deliver(orderId:string){
    const snapshot=data,order=orders.find(x=>x.id===orderId),key="return:"+orderId;setBusy(key);setMsg("");
    optimistic(list=>list.filter(o=>o.id!==orderId));
    pulse("กำลังส่งมอบ "+(order?.queueNo||"คิว")+"…");
    try{
      const r=await api<any>("/api/pos/queue",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({requestKey:crypto.randomUUID(),orderId,action:"return"})});
      if(!applyState(r))load().catch(()=>{});
      setNotice("ส่งมอบคิวแล้ว · ระบบเลื่อนไปคิวถัดไป");
      pulse("✓ ส่งมอบ "+(order?.queueNo||"คิว")+" เรียบร้อยแล้ว");
    }catch(e:any){if(snapshot)setData(snapshot);setMsg(errorText(e.message));pulse("ส่งมอบไม่สำเร็จ · ระบบคืนคิวกลับแล้ว");await load().catch(()=>{})}finally{setBusy("")}
  }

  const first=orders[0];
  const firstReady=first?orderReady(first):false;
  const firstCalled=first?orderCalled(first):false;
  const firstCupCount=first?(first.items||[]).reduce((sum,item)=>sum+n(item.qty),0):0;
  const firstRemaining=first?(first.items||[]).reduce((sum,item)=>sum+Math.max(0,n(item.qty)-n(item.readyQty)),0):0;
  const upcoming=orders.filter((_,index)=>index>0&&index<4);
  const extraUpcoming=Math.max(0,orders.length-1-upcoming.length);

  return <section className="h-full overflow-hidden p-2.5 sm:p-4 md:p-6">
    <div className="flex h-full min-h-0 flex-col gap-2.5 sm:gap-3">
      <header className="flex shrink-0 items-end justify-between gap-3">
        <div><p className="gold m-0 text-[9px] font-bold tracking-[.26em]">PRODUCTION CONTROL</p><h1 className="mt-0.5 text-lg font-semibold sm:text-xl">QUEUE CONTROL</h1></div>
        <span className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[10px] font-semibold text-slate-600">{orders.length} ACTIVE</span>
      </header>

      {msg&&<div className="shrink-0 rounded-2xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">{msg}</div>}
      {notice&&<div className="flex shrink-0 items-start justify-between gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><span>{notice}</span><button onClick={()=>setNotice("")}><X size={15}/></button></div>}

      {!first&&<div className="grid min-h-0 flex-1 place-items-center rounded-[24px] border border-dashed border-slate-300 bg-white/70 p-6 text-center">
        <div><CheckCircle2 size={34} className="mx-auto text-emerald-600"/><h2 className="mt-3 text-lg font-bold">ไม่มีคิวค้าง</h2><p className="mt-1 text-sm text-slate-500">เมื่อมีออเดอร์ใหม่ ระบบจะแสดงคิวและเมนูที่ควรทำก่อนตรงนี้</p></div>
      </div>}

      {first&&<>
        <div className="shrink-0 rounded-[22px] border-2 border-[#d4af37]/55 bg-white p-3 shadow-sm sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="shrink-0 rounded-2xl bg-[#fff3bf] px-3 py-2 text-center"><small className="block text-[9px] font-bold tracking-widest text-[#765b08]">คิวปัจจุบัน</small><div className="mt-0.5 text-2xl font-black leading-none text-[#6f5510]">{first.queueNo}</div></div>
              <div className="min-w-0"><div className="text-sm font-bold">บัตรเรียกคิว {first.pagerNo||"—"}</div><div className="mt-0.5 text-[11px] text-slate-500">{firstCupCount} แก้ว · เหลือทำ {firstRemaining} แก้ว · ฿{n(first.total).toFixed(0)}</div></div>
            </div>
            <button onClick={()=>router.push("/orders?queue="+encodeURIComponent(first.queueNo))} className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 text-[11px] font-semibold text-slate-700"><ReceiptText size={14}/>ดู/แก้</button>
          </div>

          <div className={"mt-3 rounded-[18px] border p-3 "+(selectedTask?"border-emerald-300 bg-emerald-50":recommendedTask?"border-[#d4af37] bg-[#fffaf0]":"border-slate-200 bg-slate-50")}>
            {selectedTask&&<div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-emerald-600 px-2.5 py-1 text-[10px] font-black text-white">กำลังทำ · ทำก่อน</span>{selectedTask.item.prepGroup&&<span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-[#765b08]">{selectedTask.item.prepGroup.label}</span>}</div><div className="mt-2 truncate text-lg font-black">{selectedTask.item.name}</div><div className="mt-0.5 text-xs text-slate-600">{selectedTask.item.variant} · {selectedTask.item.qty} แก้ว · เสร็จ {n(selectedTask.item.readyQty)}/{n(selectedTask.item.qty)}</div></div>
              <button disabled={busy!==""} onClick={()=>completeNext(selectedTask.order,selectedTask.item,selectedTask.index)} className="min-h-12 rounded-2xl bg-[#d4af37] px-5 text-sm font-black text-black disabled:opacity-40">ทำเสร็จ {Math.max(0,n(selectedTask.item.qty)-n(selectedTask.item.readyQty))} แก้ว</button>
            </div>}

            {!selectedTask&&recommendedTask&&<div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="min-w-0"><div className="mb-1 text-[9px] font-bold tracking-[.18em] text-slate-400">ลำดับงานแนะนำ</div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-[#d4af37] px-2.5 py-1 text-[10px] font-black text-black"><Sparkles size={11} className="mr-1 inline"/>แนะนำให้ทำก่อน</span>{recommendedTask.item.prepGroup&&<span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-[#765b08]">{recommendedTask.item.prepGroup.label}</span>}</div><div className="mt-2 truncate text-lg font-black">{recommendedTask.item.name}</div><div className="mt-0.5 text-xs text-slate-600">{recommendedTask.item.variant} · เหลือ {Math.max(0,n(recommendedTask.item.qty)-n(recommendedTask.item.readyQty))}/{n(recommendedTask.item.qty)} แก้ว</div></div>
              <button disabled={busy!==""} onClick={()=>selectTask(recommendedTask.order.id,recommendedTask.index)} className="min-h-12 rounded-2xl bg-[#d4af37] px-5 text-sm font-black text-black disabled:opacity-40">{busy==="select:"+recommendedTask.order.id+":"+recommendedTask.index?"กำลังบันทึก...":"รับทำเมนูนี้"}</button>
            </div>}

            {!task&&firstReady&&!firstCalled&&<div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center"><div><span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700">ทำครบทุกเมนูแล้ว</span><div className="mt-2 text-sm font-bold">พร้อมเรียกลูกค้ารับทั้งคิว</div></div><button disabled={busy!==""} onClick={()=>callOrder(first)} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#d4af37] px-5 text-sm font-black text-black"><BellRing size={17}/>เรียกบัตร {first.pagerNo}</button></div>}
            {!task&&firstCalled&&<div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center"><div><span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700">แจ้งลูกค้ารับครบแล้ว</span><div className="mt-2 text-sm font-bold">พร้อมส่งมอบและไปคิวถัดไป</div></div><button disabled={busy!==""} onClick={()=>deliver(first.id)} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-emerald-400 bg-white px-5 text-sm font-black text-emerald-700">ส่งมอบคิวนี้ <ChevronRight size={16}/></button></div>}
          </div>
        </div>

        <div className="min-h-0 flex-1 rounded-[22px] border border-slate-300 bg-white p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3"><div><b className="text-sm">ภาพรวมคิวนี้</b><p className="mt-0.5 text-[10px] text-slate-500">เห็นทุกเมนูในคิวเดียว ไม่ต้องเลื่อนไปดู card อื่น</p></div>{(first.prepGroups||[]).length>0&&<button onClick={()=>setPrepOpen(true)} className="flex min-h-9 items-center gap-1.5 rounded-full border border-[#d4af37]/60 bg-[#fffaf0] px-3 text-[10px] font-bold text-[#765b08]"><Layers3 size={13}/>ดูแผนเบส</button>}</div>

          <div className={"mt-2 grid gap-1.5 "+((first.items||[]).length>4?"grid-cols-2":"grid-cols-1 sm:grid-cols-2")}>
            {(first.items||[]).map((item,index)=>{
              const done=itemDone(item),called=itemCalled(item);
              const current=selectedTask?.order.id===first.id&&selectedTask.index===index;
              const recommended=recommendedTask?.order.id===first.id&&recommendedTask.index===index;
              const canCallEarly=done&&!called&&!firstReady;
              return <div key={index} className={"rounded-2xl border px-2.5 py-2 "+(current?"border-emerald-400 bg-emerald-50":recommended?"border-[#d4af37] bg-[#fffaf0]":done?"border-emerald-200 bg-white":"border-slate-200 bg-slate-50")}>
                <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="flex items-center gap-1.5"><b className="truncate text-[12px] sm:text-sm">{item.name}</b>{current&&<span className="shrink-0 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[8px] font-black text-white">กำลังทำ</span>}{recommended&&<span className="shrink-0 rounded-full bg-[#d4af37] px-1.5 py-0.5 text-[8px] font-black text-black">ทำก่อน</span>}</div><div className="mt-0.5 truncate text-[10px] text-slate-500">{item.variant} · ×{item.qty}{item.price==null?" · ราคาไม่พบ":" · ฿"+(item.price*n(item.qty)).toFixed(0)}</div></div>{done?<CheckCircle2 size={16} className="shrink-0 text-emerald-600"/>:<span className="shrink-0 text-[10px] font-bold text-slate-500">{n(item.readyQty)}/{n(item.qty)}</span>}</div>
                <div className="mt-1.5 flex items-center justify-between gap-2"><span className={"text-[9px] font-semibold "+(done?"text-emerald-700":"text-slate-500")}>{done?"ทำเสร็จ":current?"กำลังผลิต":recommended?"ลำดับถัดไป":"รอทำ"}</span>{canCallEarly&&<button disabled={busy!==""} onClick={()=>callReadyItem(first,item,index)} className="rounded-full border border-[#d4af37] bg-white px-2 py-1 text-[9px] font-bold text-[#765b08]"><BellRing size={10} className="mr-1 inline"/>รับเมนูนี้ก่อน</button>}</div>
              </div>;
            })}
          </div>

          {(first.prepGroups||[]).length>0&&<div className="mt-2 flex flex-wrap items-center gap-1.5"><span className="text-[9px] font-bold text-slate-500">PREP BASE</span>{(first.prepGroups||[]).map(group=><span key={group.id} className="rounded-full bg-[#f4ecd0] px-2 py-1 text-[9px] font-bold text-[#765b08]">{group.label} · {group.qty} แก้ว</span>)}</div>}
        </div>

        <div className="shrink-0 rounded-[18px] border border-slate-300 bg-white px-3 py-2">
          <div className="flex items-center gap-2"><b className="shrink-0 text-[10px] text-slate-500">คิวถัดไป</b><div className="grid min-w-0 flex-1 grid-cols-3 gap-1.5">{upcoming.map(order=><div key={order.id} className="min-w-0 rounded-xl bg-slate-50 px-2 py-1.5 text-center"><div className="truncate text-[10px] font-black text-slate-700">{order.queueNo}</div><div className="truncate text-[9px] text-slate-500">บัตร {order.pagerNo} · {(order.items||[]).reduce((sum,item)=>sum+n(item.qty),0)} แก้ว</div></div>)}{upcoming.length===0&&<div className="col-span-3 py-1 text-center text-[10px] text-slate-400">ไม่มีคิวถัดไป</div>}</div>{extraUpcoming>0&&<span className="shrink-0 text-[9px] font-bold text-slate-500">+{extraUpcoming}</span>}</div>
        </div>
      </>}
    </div>

    {prepOpen&&first&&<div className="fixed inset-0 z-[80] grid place-items-center bg-black/55 p-3">
      <div className="soft-scroll max-h-[88vh] w-full max-w-lg overflow-auto rounded-[26px] border border-[#d4af37]/50 bg-white p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3"><div><p className="gold text-[9px] font-bold tracking-[.24em]">PREP PLAN</p><h2 className="mt-1 text-lg font-bold">แผนเตรียมเบสของคิวนี้</h2><p className="mt-1 text-xs text-slate-500">เตรียมเบสของ {first.queueNo} พร้อมกันภายในคิว · รวมเมนูที่ใช้ Prep Base เดียวกันในบัตรนี้เป็น 1 กลุ่มและเตรียมพร้อมกันทีเดียว · Prep Base เดียวกันในบัตรนี้ให้เตรียมพร้อมกันทีเดียว · ไม่ข้ามไปเตรียมคิวถัดไป · ต้องทำคิวนี้ให้ครบก่อนจึงไปคิวถัดไป</p></div><button onClick={()=>setPrepOpen(false)}><X size={20}/></button></div>
        <div className="mt-4 space-y-2">{(first.prepGroups||[]).map(group=><div key={group.id} className="rounded-2xl border border-[#eadb9b] bg-[#fffaf0] p-3"><div className="flex justify-between gap-2"><b className="text-sm text-[#765b08]">{group.label}</b><span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold">{group.qty} แก้ว</span></div><div className="mt-2 space-y-2">{group.items.map(x=><div key={x.id+"|"+x.variant} className="rounded-xl bg-white px-3 py-2"><div className="flex justify-between gap-2 text-xs"><b>{x.name}</b><span className="text-slate-500">{x.variant} ×{x.qty}</span></div>{x.baseUsage?.length>0&&<div className="mt-1 text-[11px] text-[#765b08]">{x.baseUsage.map(u=>x.qty>1?u.name+" "+Number(u.perCup.toFixed(2)).toLocaleString()+" "+u.unit+"/แก้ว ×"+x.qty+" = "+Number(u.qty.toFixed(2)).toLocaleString()+" "+u.unit:u.name+" "+Number(u.perCup.toFixed(2)).toLocaleString()+" "+u.unit).join(" · ")}</div>}</div>)}</div></div>)}</div>
        <button onClick={()=>setPrepOpen(false)} className="mt-4 min-h-11 w-full rounded-2xl bg-[#d4af37] text-sm font-bold text-black">ปิดรายละเอียด</button>
      </div>
    </div>}

    {toast&&<div className="fixed bottom-[76px] sm:bottom-[92px] left-4 right-4 z-[95] mx-auto max-w-xl rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-center text-sm font-semibold text-emerald-800 shadow-xl">{toast}</div>}

    {callPrompt&&<div className="fixed inset-0 z-[80] grid place-items-center bg-black/55 p-4">
      <div className="w-full max-w-lg rounded-[28px] border-2 border-[#d4af37] bg-white p-6 text-center shadow-2xl">
        <div className="flex justify-end"><button onClick={()=>setCallPrompt(null)}><X size={22}/></button></div>
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#fff3bf] text-[#765b08]"><BellRing size={30}/></div>
        <p className="mt-4 text-sm font-bold tracking-[.18em] text-[#765b08]">{callPrompt.queueNo} · {callPrompt.scope}</p>
        <div className="mt-2 text-5xl font-black leading-none text-[#6f5510] md:text-6xl">บัตร {callPrompt.pagerNo||"—"}</div>
        <p className="mt-4 text-base font-semibold text-slate-800">กดหมายเลข {callPrompt.pagerNo||"—"} ที่เครื่องเรียกคิว Bluetooth ตอนนี้</p>
        <p className="mt-1 text-sm text-slate-500">FIELD POS บันทึกการเรียกในระบบ แต่ต้องกดเครื่องเรียกจริงอีกครั้ง</p>
        <button onClick={()=>setCallPrompt(null)} className="mt-6 w-full rounded-2xl bg-[#d4af37] py-3.5 text-base font-bold text-black">กดเครื่องเรียกแล้ว / ปิด</button>
      </div>
    </div>}
  </section>;
}