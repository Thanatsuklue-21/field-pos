"use client";

// FIELD guided single-task production flow: recommend → acknowledge → complete → call → handoff.

import {useEffect,useMemo,useRef,useState} from "react";
import {BellRing,CheckCircle2,ChevronRight,Layers3,Sparkles,X} from "lucide-react";
import AuthGate from "@/components/auth-gate";
import {api,type Bootstrap,type Session} from "@/lib/api-client";

type QItem={id:string;name:string;variant:string;qty:number;readyQty?:number;calledQty?:number;prepSelected?:boolean};
type QOrder={id:string;queueNo:string;pagerNo:number;status:string;time:number;items:QItem[]};

const n=(v:any)=>Number(v)||0;
const itemDone=(item:QItem)=>n(item.readyQty)>=n(item.qty);
const itemCalled=(item:QItem)=>n(item.calledQty)>=n(item.qty);
const orderReady=(order:QOrder)=>(order.items||[]).length>0&&(order.items||[]).every(itemDone);
const orderCalled=(order:QOrder)=>(order.items||[]).length>0&&(order.items||[]).every(itemCalled);

function nextTask(orders:QOrder[]){
  for(const order of orders){
    for(let index=0;index<(order.items||[]).length;index++){
      const item=order.items[index];
      if(item.prepSelected&&!itemDone(item))return {order,item,index,selected:true};
    }
  }
  const first=orders[0];
  if(!first)return null;
  for(let index=0;index<(first.items||[]).length;index++){
    const item=first.items[index];
    if(!itemDone(item))return {order:first,item,index,selected:false};
  }
  return null;
}

export default function Queue(){return <AuthGate>{session=><QueueView session={session}/>}</AuthGate>}

function QueueView({session}:{session:Session}){
  const [data,setData]=useState<Bootstrap|null>(null);
  const [busy,setBusy]=useState("");
  const [msg,setMsg]=useState("");
  const [notice,setNotice]=useState("");
  const busyRef=useRef(false);
  busyRef.current=busy!=="";
  const [callPrompt,setCallPrompt]=useState<{queueNo:string;pagerNo:number;scope:string}|null>(null);

  const load=()=>api<Bootstrap>("/api/pos/bootstrap").then(next=>setData(prev=>!prev||next.revision>=prev.revision?next:prev));
  useEffect(()=>{
    let disposed=false,inFlight=false;
    const refresh=async()=>{
      if(disposed||inFlight||busyRef.current||document.visibilityState==="hidden")return;
      inFlight=true;
      try{
        const next=await api<Bootstrap>("/api/pos/bootstrap");
        if(!disposed)setData(prev=>!prev||next.revision>=prev.revision?next:prev);
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
    setData(prev=>prev&&Number(r.revision)>=prev.revision?{...prev,revision:Number(r.revision),orders}:prev);
    return true;
  };

  const orders=useMemo(()=>((data?.orders||[]) as QOrder[]).slice().sort((a,b)=>n(a.time)-n(b.time)),[data]);
  const task=useMemo(()=>nextTask(orders),[orders]);
  const selectedTask=task?.selected?task:null;
  const recommendedTask=task&&!task.selected?task:null;

  const batch=useMemo(()=>{
    if(!task)return [] as {queueNo:string;pagerNo:number;qty:number}[];
    return orders.slice(1).flatMap(order=>(order.items||[])
      .filter(item=>item.id===task.item.id&&item.variant===task.item.variant&&!itemDone(item))
      .map(item=>({queueNo:order.queueNo,pagerNo:order.pagerNo,qty:n(item.qty)-n(item.readyQty)})));
  },[orders,task]);

  function errorText(code:string){
    return code==="fifo_violation"?"ยังทำขั้นตอนเรียกลูกค้าของคิวนี้ไม่ได้ ต้องจัดการคิวก่อนหน้าก่อน":
      code==="order_not_ready"?"ยังทำเครื่องดื่มไม่ครบ":
      code==="item_not_ready_for_call"?"เมนูนี้ยังไม่มีแก้วที่พร้อมเรียก":
      code==="pager_already_called"?"บัตรคิวนี้ถูกบันทึกว่าเรียกแล้ว":
      code==="queue_state_changed"?"สถานะคิวเปลี่ยนแล้ว ระบบกำลังอัปเดต":code;
  }

  async function selectTask(orderId:string,itemIndex:number){
    setBusy("select:"+orderId+":"+itemIndex);setMsg("");
    try{
      const r=await api<any>("/api/pos/queue",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({requestKey:crypto.randomUUID(),orderId,itemIndex,action:"select",selected:true})});
      if(!applyState(r))load().catch(()=>{});
      setNotice("รับงานแล้ว · ระบบจะแสดงเมนูนี้เป็น “กำลังทำ” จนกว่าจะทำครบ");
    }catch(e:any){setMsg(errorText(e.message));await load().catch(()=>{})}finally{setBusy("")}
  }

  async function completeNext(order:QOrder,item:QItem,itemIndex:number){
    const expectedReadyQty=n(item.readyQty);
    setBusy("done:"+order.id+":"+itemIndex);setMsg("");
    try{
      const r=await api<any>("/api/pos/queue",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({requestKey:crypto.randomUUID(),orderId:order.id,itemIndex,action:"complete_item",expectedReadyQty})});
      if(!applyState(r))load().catch(()=>{});
      const updated=(r?.orders||[]).find((x:any)=>x.id===order.id);
      const updatedItem=updated?.items?.[itemIndex];
      if(updatedItem&&n(updatedItem.readyQty)>=n(updatedItem.qty)){
        const nextRecommended=nextTask((r.orders||[]) as QOrder[]);
        setNotice(nextRecommended?`ทำ ${item.name} ครบแล้ว · ถัดไป ${nextRecommended.item.name}`:`ทำ ${item.name} ครบแล้ว · ตรวจปุ่มเรียกบัตรด้านล่าง`);
      }
    }catch(e:any){setMsg(errorText(e.message));await load().catch(()=>{})}finally{setBusy("")}
  }

  async function callReadyItem(order:QOrder,item:QItem,itemIndex:number){
    setBusy("callitem:"+order.id+":"+itemIndex);setMsg("");
    try{
      const r=await api<any>("/api/pos/queue",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({requestKey:crypto.randomUUID(),orderId:order.id,itemIndex,action:"call_item"})});
      if(!applyState(r))load().catch(()=>{});
      setCallPrompt({queueNo:order.queueNo,pagerNo:order.pagerNo,scope:`รับ ${item.name} ก่อน`});
    }catch(e:any){setMsg(errorText(e.message));await load().catch(()=>{})}finally{setBusy("")}
  }

  async function callOrder(order:QOrder){
    setBusy("call:"+order.id);setMsg("");
    try{
      const r=await api<any>("/api/pos/queue",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({requestKey:crypto.randomUUID(),orderId:order.id,action:"call"})});
      if(!applyState(r))load().catch(()=>{});
      setCallPrompt({queueNo:order.queueNo,pagerNo:order.pagerNo,scope:"รับออเดอร์ทั้งหมด"});
    }catch(e:any){setMsg(errorText(e.message));await load().catch(()=>{})}finally{setBusy("")}
  }

  async function deliver(orderId:string){
    setBusy("return:"+orderId);setMsg("");
    try{
      const r=await api<any>("/api/pos/queue",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({requestKey:crypto.randomUUID(),orderId,action:"return"})});
      if(!applyState(r))load().catch(()=>{});
      setNotice("ส่งมอบคิวแล้ว · ระบบเลื่อนไปคิวถัดไป");
    }catch(e:any){setMsg(errorText(e.message));await load().catch(()=>{})}finally{setBusy("")}
  }

  const first=orders[0];
  const firstReady=first?orderReady(first):false;
  const firstCalled=first?orderCalled(first):false;

  return <section className="soft-scroll h-full overflow-auto p-5 md:p-7">
    <div className="flex items-end justify-between gap-4">
      <div><p className="gold m-0 text-[10px] font-bold tracking-[.3em]">PRODUCTION</p><h1 className="mt-1 text-2xl font-semibold">QUEUE</h1></div>
      <span className="rounded-full border border-slate-300 bg-white px-3 py-2 text-xs text-slate-600">{orders.length} ACTIVE</span>
    </div>

    {msg&&<div className="mt-4 rounded-2xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{msg}</div>}
    {notice&&<div className="mt-4 flex items-start justify-between gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800"><span>{notice}</span><button onClick={()=>setNotice("")}><X size={16}/></button></div>}

    <div className="mt-5 rounded-[28px] border-2 border-[#d4af37]/50 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2"><Sparkles size={18} className="gold"/><b className="tracking-wide">ลำดับงานแนะนำ</b></div>

      {selectedTask&&<div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">กำลังทำ</span>
            <span className="rounded-full bg-[#fff3bf] px-3 py-1 text-xs font-bold text-[#765b08]">{selectedTask.order.queueNo} · บัตร {selectedTask.order.pagerNo}</span>
          </div>
          <div className="text-xl font-bold">{selectedTask.item.name}</div>
          <div className="mt-1 text-sm text-slate-600">{selectedTask.item.variant} · {selectedTask.item.qty} แก้ว · เสร็จ {n(selectedTask.item.readyQty)}/{n(selectedTask.item.qty)}</div>
        </div>
        <button disabled={busy!==""} onClick={()=>completeNext(selectedTask.order,selectedTask.item,selectedTask.index)} className="rounded-2xl bg-[#d4af37] px-6 py-4 text-base font-black text-black disabled:opacity-40">
          ทำเสร็จ {n(selectedTask.item.qty)-n(selectedTask.item.readyQty)} แก้ว
        </button>
      </div>}

      {!selectedTask&&recommendedTask&&<div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[#d4af37] px-3 py-1 text-xs font-bold text-black">แนะนำเมนูถัดไป</span>
            <span className="rounded-full bg-[#fff3bf] px-3 py-1 text-xs font-bold text-[#765b08]">{recommendedTask.order.queueNo} · บัตร {recommendedTask.order.pagerNo}</span>
          </div>
          <div className="text-xl font-bold">{recommendedTask.item.name}</div>
          <div className="mt-1 text-sm text-slate-600">{recommendedTask.item.variant} · เหลือ {n(recommendedTask.item.qty)-n(recommendedTask.item.readyQty)} จาก {n(recommendedTask.item.qty)} แก้ว</div>
        </div>
        <button disabled={busy!==""} onClick={()=>selectTask(recommendedTask.order.id,recommendedTask.index)} className="rounded-2xl bg-[#1d1d1f] px-6 py-4 text-base font-bold text-white disabled:opacity-40">
          รับทำเมนูนี้
        </button>
      </div>}

      {!task&&first&&firstReady&&!firstCalled&&<div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
        <div><span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">ทำครบทุกเมนูแล้ว</span><div className="mt-2 text-xl font-bold">{first.queueNo} · บัตร {first.pagerNo}</div><div className="mt-1 text-sm text-slate-600">เลือกเรียกลูกค้ามารับทั้งหมดได้เลย</div></div>
        <button disabled={busy!==""} onClick={()=>callOrder(first)} className="flex items-center justify-center gap-2 rounded-2xl bg-[#d4af37] px-6 py-4 text-base font-black text-black disabled:opacity-40"><BellRing size={19}/>เรียกบัตร {first.pagerNo}</button>
      </div>}

      {!task&&(!first||firstCalled)&&<div className="mt-4 text-sm text-emerald-700">ไม่มีเมนูค้างทำ</div>}

      {batch.length>0&&<div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4 text-xs"><span className="flex items-center gap-1 text-slate-600"><Layers3 size={14}/>เมนูเดียวกันในคิวถัดไป:</span>{batch.map(x=><span key={x.queueNo} className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1">{x.queueNo} · {x.qty} แก้ว</span>)}<span className="text-slate-500">เตรียม Batch ได้ แต่เรียกลูกค้ายังคงตาม FIFO</span></div>}
    </div>

    <div className="mt-5 grid gap-4 xl:grid-cols-2">
      {orders.map((order,orderIndex)=>{
        const allReady=orderReady(order);
        const allCalled=orderCalled(order);
        return <div key={order.id} className={"glass card p-5 "+(orderIndex===0?"border-[#d4af37]/50":"")}>
          <div className="flex items-start justify-between gap-4">
            <div><small className="text-slate-500">QUEUE</small><div className="mt-1 text-3xl font-black text-[#765b08]">{order.queueNo}</div></div>
            <div className="rounded-2xl border-2 border-[#d4af37] bg-[#fff8dc] px-4 py-2 text-center"><small className="block text-[10px] font-bold tracking-widest text-[#765b08]">บัตรเรียกคิว</small><div className="mt-1 text-3xl font-black leading-none text-[#6f5510]">บัตร {order.pagerNo||"—"}</div></div>
          </div>

          <div className="mt-5 space-y-2">
            {(order.items||[]).map((item,index)=>{
              const done=itemDone(item);
              const called=itemCalled(item);
              const current=selectedTask?.order.id===order.id&&selectedTask.index===index;
              const recommended=recommendedTask?.order.id===order.id&&recommendedTask.index===index;
              const canCallEarly=orderIndex===0&&done&&!called&&!allReady;
              return <div key={index} className={"rounded-[20px] border p-4 "+(current?"border-emerald-400 bg-emerald-50/50":recommended?"border-[#d4af37] bg-[#fffaf0]":"border-slate-300 bg-slate-50")}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><b>{item.name}</b><span className="text-sm text-slate-500">{item.variant} ×{item.qty}</span>{current&&<span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-700">กำลังทำ</span>}{recommended&&<span className="rounded-full bg-[#d4af37] px-2 py-1 text-[10px] font-bold text-black">ถัดไป</span>}</div>
                    <div className="mt-2 text-sm"><span className={done?"font-semibold text-emerald-700":"text-slate-600"}>ทำเสร็จ {n(item.readyQty)}/{n(item.qty)}</span>{called&&<span className="ml-2 text-emerald-700">· แจ้งรับแล้ว</span>}</div>
                  </div>
                  {done&&<CheckCircle2 size={22} className="text-emerald-600"/>}
                </div>

                {canCallEarly&&<button disabled={busy!==""} onClick={()=>callReadyItem(order,item,index)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[#d4af37] bg-white py-2.5 text-sm font-semibold text-[#765b08] disabled:opacity-40"><BellRing size={16}/>เรียกบัตร {order.pagerNo} · รับเมนูนี้ก่อน</button>}
              </div>;
            })}
          </div>

          <div className="mt-4 grid gap-2 border-t border-slate-200 pt-4">
            {allReady&&!allCalled&&<button disabled={busy!==""||orderIndex!==0} onClick={()=>callOrder(order)} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#d4af37] py-3 text-sm font-bold text-black disabled:bg-slate-200 disabled:text-slate-400"><BellRing size={17}/>{orderIndex===0?`เรียกบัตร ${order.pagerNo} · รับทั้งหมด`:"รอคิวก่อนหน้า"}</button>}
            {!allReady&&<div className="rounded-2xl bg-slate-100 px-4 py-3 text-center text-sm text-slate-600">เหลือทำอีก {(order.items||[]).reduce((sum,item)=>sum+Math.max(0,n(item.qty)-n(item.readyQty)),0)} แก้ว</div>}
            {allCalled&&<div className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-300 bg-emerald-50 py-3 text-sm font-semibold text-emerald-700"><BellRing size={17}/>แจ้งลูกค้ารับครบแล้ว</div>}
            <button disabled={busy!==""||!allCalled||orderIndex!==0} onClick={()=>deliver(order.id)} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-400/40 bg-white py-3 text-sm font-semibold text-emerald-700 disabled:border-slate-200 disabled:text-slate-300">ส่งมอบคิวนี้ <ChevronRight size={16}/></button>
          </div>
        </div>;
      })}
    </div>

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