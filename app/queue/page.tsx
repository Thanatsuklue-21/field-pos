"use client";

import {useEffect,useMemo,useState} from "react";
import {BellRing,CheckCircle2,ChevronRight,Layers3,PackageCheck,Play,Sparkles,X} from "lucide-react";
import AuthGate from "@/components/auth-gate";
import {api,type Bootstrap,type Session} from "@/lib/api-client";

type QItem={
  id:string;
  name:string;
  variant:string;
  qty:number;
  readyQty?:number;
  calledQty?:number;
  prepSelected?:boolean;
};

type QOrder={
  id:string;
  queueNo:string;
  pagerNo:number;
  status:string;
  time:number;
  total:number;
  startedAt?:number|null;
  notifiedAt?:number|null;
  notifyCount?:number;
  lastNotifyReadyQty?:number;
  items:QItem[];
};

export default function Queue(){
  return <AuthGate>{session=><QueueView session={session}/>}</AuthGate>;
}

function QueueView({session}:{session:Session}){
  const [data,setData]=useState<Bootstrap|null>(null);
  const [busy,setBusy]=useState("");
  const [msg,setMsg]=useState("");
  const [stepNotice,setStepNotice]=useState("");
  const [callPrompt,setCallPrompt]=useState<{queueNo:string;pagerNo:number;partial:boolean}|null>(null);

  const load=()=>api<Bootstrap>("/api/pos/bootstrap").then(setData);
  useEffect(()=>{load().catch(()=>{})},[]);

  const applyState=(r:any)=>{
    const orders=Array.isArray(r?.orders)?r.orders:null;
    if(!orders)return null;
    setData(prev=>prev?{...prev,revision:Number(r.revision)||prev.revision,orders}:prev);
    return orders as QOrder[];
  };

  const orders=useMemo(
    ()=>((data?.orders||[]) as QOrder[]).slice().sort((a,b)=>Number(a.time||0)-Number(b.time||0)),
    [data]
  );

  const current=orders[0]||null;
  const waiting=orders.slice(1);

  const currentState=useMemo(()=>{
    if(!current)return {
      selectedIndex:-1,
      recommendedIndex:-1,
      allReady:false,
      anyReady:false,
      readyUnits:0,
      totalUnits:0,
      batch:[] as {queueNo:string;pagerNo:number}[]
    };

    const items=current.items||[];
    const selectedIndex=items.findIndex(item=>!!item.prepSelected&&(Number(item.readyQty)||0)<(Number(item.qty)||0));
    const recommendedIndex=selectedIndex>=0
      ?selectedIndex
      :items.findIndex(item=>(Number(item.readyQty)||0)<(Number(item.qty)||0));

    const allReady=items.length>0&&items.every(item=>(Number(item.readyQty)||0)>=(Number(item.qty)||0));
    const anyReady=items.some(item=>(Number(item.readyQty)||0)>0);
    const readyUnits=items.reduce((sum,item)=>sum+Math.min(Number(item.readyQty)||0,Number(item.qty)||0),0);
    const totalUnits=items.reduce((sum,item)=>sum+(Number(item.qty)||0),0);
    const focus=recommendedIndex>=0?items[recommendedIndex]:null;
    const batch=focus
      ?waiting.filter(order=>(order.items||[]).some(item=>
        item.id===focus.id&&
        item.variant===focus.variant&&
        (Number(item.readyQty)||0)<(Number(item.qty)||0)
      )).map(order=>({queueNo:order.queueNo,pagerNo:order.pagerNo}))
      :[];

    return {selectedIndex,recommendedIndex,allReady,anyReady,readyUnits,totalUnits,batch};
  },[current,waiting]);

  async function queueAction(body:any){
    return api<any>("/api/pos/queue",{
      method:"POST",
      headers:{"X-CSRF-Token":session.csrf},
      body:JSON.stringify({requestKey:crypto.randomUUID(),...body})
    });
  }

  async function selectItem(order:QOrder,itemIndex:number){
    setBusy(order.id+":"+itemIndex+":select");
    setMsg("");
    setStepNotice("");
    try{
      const r=await queueAction({orderId:order.id,itemIndex,action:"select",selected:true});
      if(!applyState(r))load().catch(()=>{});
    }catch(e:any){
      setMsg(e.message==="queue_state_changed"?"สถานะคิวเปลี่ยนแล้ว ระบบโหลดข้อมูลล่าสุดให้":e.message);
      await load().catch(()=>{});
    }finally{
      setBusy("");
    }
  }

  async function completeUnit(order:QOrder,itemIndex:number){
    const before=order.items[itemIndex];
    const nextUnit=(Number(before.readyQty)||0)+1;
    setBusy(order.id+":"+itemIndex+":done");
    setMsg("");
    setStepNotice("");
    try{
      const r=await queueAction({orderId:order.id,itemIndex,action:"start",unit:nextUnit});
      const updatedOrders=applyState(r)||[];
      if(!updatedOrders.length)load().catch(()=>{});
      const updated=updatedOrders.find(x=>x.id===order.id);
      const updatedItem=updated?.items?.[itemIndex];
      if(updated&&updatedItem&&(Number(updatedItem.readyQty)||0)>=(Number(updatedItem.qty)||0)){
        const next=updated.items.find(item=>(Number(item.readyQty)||0)<(Number(item.qty)||0));
        setStepNotice(
          next
            ?before.name+" เสร็จแล้ว → เมนูถัดไป: "+next.name
            :"ทำครบทั้งบิล "+updated.queueNo+" แล้ว → เรียกลูกค้าหรือส่งมอบได้"
        );
      }
    }catch(e:any){
      setMsg(e.message==="queue_state_changed"?"สถานะคิวเปลี่ยนแล้ว ระบบโหลดข้อมูลล่าสุดให้":e.message);
      await load().catch(()=>{});
    }finally{
      setBusy("");
    }
  }

  async function notifyCustomer(order:QOrder,partial:boolean){
    setBusy(order.id+":notify");
    setMsg("");
    try{
      const r=await queueAction({orderId:order.id,action:"notify"});
      const updatedOrders=applyState(r)||[];
      const updated=updatedOrders.find(x=>x.id===order.id);
      setCallPrompt({
        queueNo:String(updated?.queueNo||order.queueNo||""),
        pagerNo:Number(updated?.pagerNo||order.pagerNo)||0,
        partial
      });
    }catch(e:any){
      setMsg(
        e.message==="fifo_violation"
          ?"ยังเรียกบัตรคิวนี้ไม่ได้ ต้องจัดการคิวก่อนหน้าให้เสร็จก่อน"
          :e.message==="order_not_ready"
            ?"ยังไม่มีเครื่องดื่มที่ทำเสร็จ"
            :e.message
      );
      await load().catch(()=>{});
    }finally{
      setBusy("");
    }
  }

  async function deliver(order:QOrder){
    setBusy(order.id+":deliver");
    setMsg("");
    setStepNotice("");
    try{
      const r=await queueAction({orderId:order.id,action:"deliver"});
      const updated=applyState(r)||[];
      if(!updated.length)load().catch(()=>{});
      const next=updated[0];
      setStepNotice(next?"ส่งมอบ "+order.queueNo+" แล้ว → คิวถัดไป "+next.queueNo:"ส่งมอบ "+order.queueNo+" แล้ว · ไม่มีคิวค้าง");
    }catch(e:any){
      setMsg(
        e.message==="fifo_violation"
          ?"ต้องส่งมอบคิวก่อนหน้าก่อน"
          :e.message==="order_not_ready"
            ?"ยังทำเครื่องดื่มในบิลนี้ไม่ครบ"
            :e.message
      );
      await load().catch(()=>{});
    }finally{
      setBusy("");
    }
  }

  if(!current){
    return <section className="grid h-full place-items-center p-6">
      <div className="text-center">
        <CheckCircle2 className="mx-auto text-emerald-600" size={42}/>
        <h1 className="mt-4 text-2xl font-semibold">ไม่มีคิวค้าง</h1>
        <p className="mt-2 text-sm text-slate-500">พร้อมรับออเดอร์ถัดไป</p>
      </div>
    </section>;
  }

  const activeIndex=currentState.recommendedIndex;
  const activeItem=activeIndex>=0?current.items[activeIndex]:null;
  const activeReady=activeItem?Number(activeItem.readyQty)||0:0;
  const activeQty=activeItem?Number(activeItem.qty)||0:0;
  const isSelected=activeIndex>=0&&currentState.selectedIndex===activeIndex;
  const hasNotified=Number(current.notifyCount)||0;

  return <section className="soft-scroll h-full overflow-auto p-4 md:p-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="gold m-0 text-[10px] font-bold tracking-[.3em]">PRODUCTION</p>
        <h1 className="mt-1 text-2xl font-semibold">คิวผลิต</h1>
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-slate-300 bg-white px-3 py-2 text-xs text-slate-600">
          ค้าง {orders.length} คิว
        </span>
        <span className="rounded-full border-2 border-[#d4af37] bg-[#fff8dc] px-4 py-2 text-sm font-black text-[#6f5510]">
          บัตร {current.pagerNo||"—"}
        </span>
      </div>
    </div>

    {msg&&<div className="mt-4 rounded-2xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
      {msg}
    </div>}

    {stepNotice&&<div className="mt-4 flex items-start justify-between gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">
      <span>{stepNotice}</span>
      <button onClick={()=>setStepNotice("")}><X size={17}/></button>
    </div>}

    <div className="mt-4 rounded-[28px] border-2 border-[#d4af37]/70 bg-[#fffaf0] p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold tracking-[.18em] text-[#765b08]">ขั้นตอนตอนนี้ · {current.queueNo}</div>
          {activeItem
            ?<div className="mt-2">
              <div className="text-sm text-slate-600">{isSelected?"กำลังทำ":"แนะนำให้ทำก่อน"}</div>
              <div className="mt-1 text-2xl font-black text-slate-950">{activeItem.name}</div>
              <div className="mt-1 text-sm text-slate-600">{activeItem.variant} · ทำเสร็จ {activeReady}/{activeQty}</div>
            </div>
            :<div className="mt-2">
              <div className="text-sm text-emerald-700">ทำครบทั้งบิลแล้ว</div>
              <div className="mt-1 text-2xl font-black text-slate-950">พร้อมเรียกลูกค้า / ส่งมอบ</div>
            </div>
          }
        </div>

        {activeItem&&<button
          disabled={busy!==""}
          onClick={()=>isSelected?completeUnit(current,activeIndex):selectItem(current,activeIndex)}
          className="min-w-[220px] rounded-2xl bg-[#d4af37] px-5 py-4 text-base font-black text-black shadow-sm disabled:opacity-40"
        >
          {isSelected
            ?(activeQty>1?"เสร็จแก้ว "+String(activeReady+1)+"/"+String(activeQty):"กดเมื่อทำเมนูนี้เสร็จ")
            :"เริ่มทำเมนูนี้"
          }
        </button>}
      </div>

      {isSelected&&activeItem&&<div className="mt-4 flex items-center gap-2 rounded-2xl border border-amber-300 bg-white px-4 py-3">
        <Play size={17} className="text-[#765b08]"/>
        <span className="text-sm font-semibold">กำลังทำ: {activeItem.name} · {activeItem.variant}</span>
      </div>}

      {currentState.batch.length>0&&activeItem&&<div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="flex items-center gap-1 font-semibold text-slate-600"><Layers3 size={14}/>เมนูเดียวกันในคิวถัดไป:</span>
        {currentState.batch.map(x=><span key={x.queueNo} className="rounded-full border border-slate-300 bg-white px-3 py-1">
          {x.queueNo} · บัตร {x.pagerNo}
        </span>)}
        <span className="text-slate-500">เตรียมพร้อมได้ แต่ส่งมอบยังเรียง FIFO</span>
      </div>}
    </div>

    <div className="glass card mt-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <small className="text-slate-500">คิวปัจจุบัน</small>
          <div className="mt-1 text-3xl font-black text-[#765b08]">{current.queueNo}</div>
        </div>
        <div className="text-right">
          <small className="text-slate-500">ความคืบหน้า</small>
          <div className="mt-1 text-lg font-bold">{currentState.readyUnits}/{currentState.totalUnits} แก้ว</div>
          {hasNotified>0&&<div className="mt-1 text-xs font-semibold text-emerald-700">แจ้งบัตรแล้ว {hasNotified} ครั้ง</div>}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {current.items.map((item,index)=>{
          const ready=Number(item.readyQty)||0;
          const qty=Number(item.qty)||0;
          const done=ready>=qty;
          const selected=!!item.prepSelected&&!done;
          const recommended=index===activeIndex&&!selected&&!done;

          return <div key={index} className={
            "rounded-[20px] border p-4 "+
            (selected
              ?"border-[#d4af37] bg-[#fff8dc]"
              :done
                ?"border-emerald-200 bg-emerald-50/70"
                :recommended
                  ?"border-[#d4af37]/50 bg-white"
                  :"border-slate-200 bg-slate-100/70")
          }>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <b>{item.name}</b>
                  <span className="text-sm text-slate-500">{item.variant} ×{qty}</span>
                  {selected&&<span className="rounded-full bg-[#d4af37] px-2 py-1 text-[10px] font-bold text-black">กำลังทำ</span>}
                  {recommended&&<span className="rounded-full border border-[#d4af37] bg-white px-2 py-1 text-[10px] font-bold text-[#765b08]">ถัดไป</span>}
                </div>
                <div className={"mt-1 text-sm "+(done?"font-semibold text-emerald-700":"text-slate-600")}>
                  {done?"✓ เสร็จแล้ว "+String(ready)+"/"+String(qty):"ทำเสร็จ "+String(ready)+"/"+String(qty)}
                </div>
              </div>
              {done&&<CheckCircle2 size={22} className="text-emerald-600"/>}
            </div>
          </div>;
        })}
      </div>

      <div className="mt-5 grid gap-2 md:grid-cols-2">
        <button
          disabled={busy!==""||!currentState.anyReady}
          onClick={()=>notifyCustomer(current,!currentState.allReady)}
          className="flex items-center justify-center gap-2 rounded-2xl border-2 border-[#d4af37] bg-white py-3.5 text-sm font-bold text-[#765b08] disabled:border-slate-200 disabled:text-slate-300"
        >
          <BellRing size={18}/>
          {currentState.allReady
            ?(hasNotified>0?"เรียกบัตร "+String(current.pagerNo)+" อีกครั้ง":"เรียกบัตร "+String(current.pagerNo))
            :(hasNotified>0?"เรียกลูกค้าอีกครั้ง":"เรียกลูกค้ามารับที่เสร็จแล้ว")
          }
        </button>

        <button
          disabled={busy!==""||!currentState.allReady}
          onClick={()=>deliver(current)}
          className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3.5 text-sm font-bold text-white disabled:bg-slate-200 disabled:text-slate-400"
        >
          <PackageCheck size={18}/>
          ส่งมอบครบทั้งบิล
        </button>
      </div>

      {!currentState.allReady&&currentState.anyReady&&<p className="mt-3 text-center text-xs text-slate-500">
        จะเรียกลูกค้ามารับบางรายการก่อนก็ได้ หรือรอให้ครบทั้งบิลแล้วค่อยเรียก/ส่งมอบ
      </p>}
    </div>

    {waiting.length>0&&<div className="mt-5">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-600">
        <ChevronRight size={16}/> คิวถัดไป
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {waiting.map(order=><div key={order.id} className="rounded-[20px] border border-slate-300 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <b className="text-lg">{order.queueNo}</b>
              <div className="mt-1 line-clamp-1 text-sm text-slate-500">
                {(order.items||[]).map(x=>x.name+" ×"+String(x.qty)).join(" · ")}
              </div>
            </div>
            <div className="rounded-xl border border-[#d4af37]/60 bg-[#fff8dc] px-3 py-2 text-center">
              <small className="block text-[9px] font-bold text-[#765b08]">บัตร</small>
              <b className="text-xl text-[#6f5510]">{order.pagerNo||"—"}</b>
            </div>
          </div>
        </div>)}
      </div>
    </div>}

    {callPrompt&&<div className="fixed inset-0 z-[80] grid place-items-center bg-black/55 p-4">
      <div className="w-full max-w-lg rounded-[28px] border-2 border-[#d4af37] bg-white p-6 text-center shadow-2xl">
        <div className="flex justify-end"><button onClick={()=>setCallPrompt(null)}><X size={22}/></button></div>
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#fff3bf] text-[#765b08]">
          <BellRing size={30}/>
        </div>
        <p className="mt-4 text-sm font-bold tracking-[.18em] text-[#765b08]">เรียกลูกค้า · {callPrompt.queueNo}</p>
        <div className="mt-2 text-5xl font-black leading-none text-[#6f5510] md:text-6xl">
          บัตร {callPrompt.pagerNo||"—"}
        </div>
        <p className="mt-4 text-base font-semibold text-slate-800">
          กดหมายเลข {callPrompt.pagerNo||"—"} ที่เครื่องเรียกคิว Bluetooth ตอนนี้
        </p>
        {callPrompt.partial&&<p className="mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          เรียกก่อนที่ทั้งบิลจะเสร็จ · ลูกค้าสามารถรับรายการที่พร้อมก่อน แล้วรอรายการที่เหลือได้
        </p>}
        <button onClick={()=>setCallPrompt(null)} className="mt-5 w-full rounded-2xl bg-[#d4af37] py-3.5 text-base font-bold text-black">
          กดเครื่องเรียกแล้ว / ปิด
        </button>
      </div>
    </div>}
  </section>;
}
