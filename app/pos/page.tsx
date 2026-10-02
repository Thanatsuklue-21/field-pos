"use client";

import {useEffect,useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import {ArrowRight,CheckCircle2,Minus,Plus,Search,Trash2,WalletCards,X} from "lucide-react";
import AuthGate from "@/components/auth-gate";
import {api,type Bootstrap,type MenuItem,type Session} from "@/lib/api-client";
import {useCartStore} from "@/stores/cart-store";

export default function Pos(){return <AuthGate>{s=><PosView session={s}/>}</AuthGate>}

function localDate(){
  const d=new Date();
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
}

const PENDING_KEY="field-pos-pending-promptpay-v1";
type PendingPrompt={requestKey:string;date:string;cart:{id:string;variant:string;qty:number}[];paymentReference:string;total:number;customerId:string|null;createdAt:number};
const pendingRead=():PendingPrompt|null=>{try{return JSON.parse(localStorage.getItem(PENDING_KEY)||"null")}catch{return null}};
const pendingWrite=(p:PendingPrompt)=>localStorage.setItem(PENDING_KEY,JSON.stringify(p));
const pendingClear=()=>localStorage.removeItem(PENDING_KEY);
const samePending=(p:PendingPrompt,total:number,cart:{id:string;variant:string;qty:number}[],customerId:string)=>p.total===total&&p.customerId===(customerId||null)&&JSON.stringify(p.cart)===JSON.stringify(cart);

const CASH_PENDING_KEY="field-pos-pending-cash-v1";
type PendingCash={body:any;createdAt:number};
const cashPendingRead=():PendingCash|null=>{try{return JSON.parse(localStorage.getItem(CASH_PENDING_KEY)||"null")}catch{return null}};
const cashPendingWrite=(p:PendingCash)=>localStorage.setItem(CASH_PENDING_KEY,JSON.stringify(p));
const cashPendingClear=()=>localStorage.removeItem(CASH_PENDING_KEY);
const sameCashPending=(p:PendingCash,total:number,cart:{id:string;variant:string;qty:number}[],customerId:string,received:number)=>Number(p.body?.received)===received&&Number(p.body?.total??total)===total&&(p.body?.customerId||null)===(customerId||null)&&JSON.stringify(p.body?.cart||[])===JSON.stringify(cart);

type LastSale={queueNo:string;pager:number;billNo?:string;total:number;received:number;change:number;payment:"cash"|"promptpay";recovered?:boolean};

const sellable=(x:MenuItem)=>!!x.enabled&&Number(x.price)>0&&Array.isArray(x.variants)&&x.variants.length>0;
const compactOrders=(state:any)=>(Array.isArray(state?.orders)?state.orders:[])
  .filter((o:any)=>!["returned","void","refunded","cancelled"].includes(String(o.status||"")))
  .map((o:any)=>({
    id:o.id,queueNo:o.queueNo,pagerNo:o.pagerNo,status:o.status,time:o.time,total:o.total,
    items:(o.items||[]).map((x:any)=>({id:x.id,name:x.name,variant:x.variant,qty:x.qty,readyQty:x.readyQty,calledQty:x.calledQty,prepSelected:!!x.prepSelected}))
  }));

function PosView({session}:{session:Session}){
  const router=useRouter();
  const [data,setData]=useState<Bootstrap|null>(null);
  const [q,setQ]=useState("");
  const [cat,setCat]=useState("ทั้งหมด");
  const [selected,setSelected]=useState<MenuItem|null>(null);
  const [payOpen,setPayOpen]=useState(false);
  const [method,setMethod]=useState<"cash"|"promptpay">("cash");
  const [received,setReceived]=useState("");
  const [busy,setBusy]=useState(false);
  const [result,setResult]=useState("");
  const [notice,setNotice]=useState("");
  const [lastSale,setLastSale]=useState<LastSale|null>(null);
  const [prompt,setPrompt]=useState<any|null>(null);
  const [customers,setCustomers]=useState<any[]>([]);
  const [customerId,setCustomerId]=useState("");
  const cart=useCartStore();

  const load=()=>api<Bootstrap>("/api/pos/bootstrap").then(setData);

  useEffect(()=>{
    load().catch(()=>{});
    api<any>("/api/customers").then(x=>setCustomers(x.customers||[])).catch(()=>{});
    recoverCashCheckout().then(()=>recoverPending()).catch(()=>{});
  },[]);

  useEffect(()=>{
    if(!lastSale)return;
    const timer=setTimeout(()=>setLastSale(null),8000);
    return()=>clearTimeout(timer);
  },[lastSale]);

  useEffect(()=>{
    if(!data)return;
    const byId=new Map((data.menu||[]).filter(sellable).map(x=>[x.id,x]));
    const removed:string[]=[];
    let changed=false;
    const next=cart.items.flatMap(item=>{
      const current=byId.get(item.id);
      const validVariant=current?.variants?.some(v=>v.label===item.variant);
      if(!current||!validVariant){removed.push(item.name);changed=true;return []}
      if(item.name!==current.name||item.price!==current.price){changed=true;return [{...item,name:current.name,price:current.price}]}
      return [item];
    });
    if(changed)cart.replaceItems(next);
    if(removed.length)setNotice("นำ "+removed.join(", ")+" ออกจากตะกร้า เพราะเมนูปิดขาย ราคาเป็น 0 หรือเวอร์ชันเมนูเปลี่ยนแล้ว");
  },[data?.revision]);

  const cats=useMemo(()=>["ทั้งหมด",...Array.from(new Set((data?.menu||[]).filter(sellable).map(x=>x.category||"อื่นๆ")))], [data]);
  const menu=(data?.menu||[]).filter(x=>sellable(x)&&(cat==="ทั้งหมด"||(x.category||"อื่นๆ")===cat)&&x.name.toLowerCase().includes(q.toLowerCase()));
  const total=cart.getTotal();
  const cashReceived=received.trim()===""?NaN:Number(received);
  const cashDelta=Number.isFinite(cashReceived)?cashReceived-total:NaN;

  function applyServerState(r:any){
    const orders=Array.isArray(r?.orders)?r.orders:(r?.state?compactOrders(r.state):null);
    if(!orders)return;
    setData(prev=>prev?{...prev,revision:Number(r.revision)||prev.revision,orders}:prev);
  }

  function finishSale(r:any,opts:{payment:"cash"|"promptpay";total:number;received:number;recovered?:boolean}){
    applyServerState(r);
    const serverTotal=Number(r?.total??opts.total);
    const serverReceived=Number(r?.received??opts.received);
    const serverChange=Number(r?.change??(opts.payment==="cash"?Math.max(0,serverReceived-serverTotal):0));
    setPayOpen(false);
    setResult("");
    setPrompt(null);
    cart.clearCart();
    setReceived("");
    setCustomerId("");
    setLastSale({
      queueNo:String(r?.queueNo||"—"),
      pager:Number(r?.pager)||0,
      billNo:r?.billNo?String(r.billNo):undefined,
      total:serverTotal,
      received:serverReceived,
      change:serverChange,
      payment:opts.payment,
      recovered:opts.recovered
    });
    api<any>("/api/customers").then(x=>setCustomers(x.customers||[])).catch(()=>{});
  }

  async function recoverCashCheckout(){
    const p=cashPendingRead();
    if(!p)return;
    if(Date.now()-Number(p.createdAt||0)>24*60*60*1000){
      setNotice("พบรายการเงินสดค้างเกิน 24 ชม. กรุณาตรวจ Orders ก่อนดำเนินการต่อ");
      return;
    }
    try{
      const r=await api<any>("/api/pos/checkout",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(p.body)});
      cashPendingClear();
      finishSale(r,{payment:"cash",total:Number(p.body?.total)||0,received:Number(p.body?.received)||0,recovered:true});
    }catch(e:any){
      if(e.message==="business_date_changed")setNotice("รายการเงินสดค้างข้ามวัน · กรุณาตรวจ Orders ก่อน หากไม่พบบิลให้บันทึกปรับปรุงด้วย Admin");
      else if(!["network_unavailable","offline_write_blocked"].includes(e.message)){
        cashPendingClear();
        setNotice("ตรวจรายการเงินสดค้างไม่สำเร็จ · "+errorText(e.message));
      }
    }
  }

  async function finalizePending(p:PendingPrompt,verified:string){
    const body={requestKey:p.requestKey,date:p.date,cart:p.cart,payment:"promptpay",received:p.total,paymentReference:p.paymentReference,paymentVerified:verified,customerId:p.customerId};
    const r=await api<any>("/api/pos/checkout",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)});
    pendingClear();
    cart.clearCart();
    finishSale(r,{payment:"promptpay",total:p.total,received:p.total,recovered:true});
    return r;
  }

  async function recoverPending(){
    const p=pendingRead();
    if(!p)return;
    try{
      const st=await api<any>("/api/payments/promptpay/status",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({chargeId:p.paymentReference})});
      if(st.paid){await finalizePending(p,st.chargeId||p.paymentReference);return}
      if(["failed","expired","reversed"].includes(String(st.status||"").toLowerCase())){pendingClear();return}
      setMethod("promptpay");
      setPrompt(st);
      setPayOpen(true);
      setResult("พบ PromptPay ที่ยังรอชำระ ระบบจะใช้ QR เดิมและตรวจสอบรายการเดิมเพื่อป้องกันรายการซ้ำ");
    }catch{
      setMethod("promptpay");
      setPayOpen(true);
      setResult("ยังตรวจสอบ PromptPay รายการเดิมไม่ได้ ระบบเก็บรายการไว้และจะไม่สร้าง QR ใหม่");
    }
  }

  function errorText(code:string){
    return code==="cash_insufficient"?"จำนวนเงินรับไม่พอ":
      code==="menu_unavailable"?"มีเมนูในตะกร้าที่ปิดขาย ราคาเป็น 0 หรือยังไม่พร้อมขาย กรุณาตรวจตะกร้าใหม่":
      code==="variant_unavailable"?"ตัวเลือกของเมนูในตะกร้าเปลี่ยนแล้ว กรุณาเลือกเมนูใหม่":
      code==="stock_shortage"?"วัตถุดิบไม่เพียงพอสำหรับออเดอร์นี้":
      code==="promptpay_timeout"?"หมดเวลารอ PromptPay ระบบจะเก็บรายการไว้และตรวจสอบอีกครั้งเมื่อกลับมา":
      code==="promptpay_failed"?"PromptPay ไม่สำเร็จ กรุณาลองใหม่":
      code==="pending_promptpay_exists"?"มี PromptPay รายการเดิมที่ยังไม่สิ้นสุด กรุณาชำระหรือรอผลรายการเดิม":
      code==="pending_cash_checkout_exists"?"มีออเดอร์เงินสดเดิมที่ยังไม่ทราบผล กรุณารอระบบตรวจรายการเดิมก่อนรับบิลใหม่":
      code==="business_date_changed"?"วันธุรกิจเปลี่ยนแล้ว กรุณาตรวจ Orders ก่อนทำรายการใหม่":
      code==="offline_write_blocked"?"ออฟไลน์อยู่ ระบบหยุดรับการชำระเงินเพื่อป้องกันบิลซ้ำ":
      code==="network_unavailable"?"การเชื่อมต่อขาดหาย กรุณาตรวจอินเทอร์เน็ต ระบบจะไม่สร้างบิลซ้ำ":
      code;
  }

  async function checkout(){
    if(!cart.items.length||busy)return;
    setBusy(true);
    setResult("");
    try{
      const checkoutTotal=cart.getTotal();
      const cartPayload=cart.items.map(i=>({id:i.id,variant:i.variant,qty:i.qty}));
      let paymentVerified:any=true,paymentReference:any=null,requestKey=crypto.randomUUID();
      if(method==="cash"&&Number(received)<checkoutTotal)throw Object.assign(new Error("cash_insufficient"),{status:409});

      if(method==="promptpay"){
        let st:any=null;
        const existing=pendingRead();
        if(existing){
          const current=await api<any>("/api/payments/promptpay/status",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({chargeId:existing.paymentReference})});
          if(current.paid){await finalizePending(existing,current.chargeId||existing.paymentReference);return}
          if(["failed","expired","reversed"].includes(String(current.status||"").toLowerCase()))pendingClear();
          else if(!samePending(existing,checkoutTotal,cartPayload,customerId))throw Object.assign(new Error("pending_promptpay_exists"),{status:409});
          else{st=current;paymentReference=existing.paymentReference;requestKey=existing.requestKey}
        }
        if(!st){
          st=await api<any>("/api/payments/promptpay/create",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({amount:checkoutTotal,reference:"FIELD-"+Date.now()})});
          paymentReference=st.chargeId;
          pendingWrite({requestKey,date:localDate(),cart:cartPayload,paymentReference,total:checkoutTotal,customerId:customerId||null,createdAt:Date.now()});
        }
        setPrompt(st);
        const deadline=Date.now()+15*60*1000;
        while(!st.paid&&Date.now()<deadline){
          if(["failed","expired","reversed"].includes(String(st.status||"").toLowerCase())){pendingClear();throw Object.assign(new Error("promptpay_failed"),{status:409})}
          await new Promise(resolve=>setTimeout(resolve,2500));
          st=await api<any>("/api/payments/promptpay/status",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({chargeId:paymentReference})});
          setPrompt(st);
        }
        if(!st.paid)throw new Error("promptpay_timeout");
        paymentVerified=st.chargeId||paymentReference;
      }

      let body:any={
        requestKey,date:localDate(),cart:cartPayload,payment:method,
        received:method==="cash"?Number(received):checkoutTotal,
        paymentReference,paymentVerified,customerId:customerId||null,total:checkoutTotal
      };
      if(method==="cash"){
        const existing=cashPendingRead();
        if(existing){
          if(!sameCashPending(existing,checkoutTotal,cartPayload,customerId,Number(received)))throw Object.assign(new Error("pending_cash_checkout_exists"),{status:409});
          body=existing.body;
          requestKey=body.requestKey;
        }else cashPendingWrite({body,createdAt:Date.now()});
      }

      const r=await api<any>("/api/pos/checkout",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)});
      if(method==="promptpay")pendingClear();
      if(method==="cash")cashPendingClear();
      finishSale(r,{payment:method,total:checkoutTotal,received:method==="cash"?Number(received):checkoutTotal});
    }catch(e:any){
      if(method==="cash"&&e?.status&&e.status<500)cashPendingClear();
      const message=errorText(e.message);
      if(["menu_unavailable","variant_unavailable"].includes(e.message)){
        setPayOpen(false);
        setNotice(message);
        load().catch(()=>{});
      }else{
        setResult(method==="cash"&&e.message==="network_unavailable"?"การเชื่อมต่อขาดหาย · เก็บ request เดิมไว้และจะตรวจซ้ำอัตโนมัติ":message);
      }
    }finally{
      setBusy(false);
    }
  }

  function openPayment(){
    if(!cart.items.length)return;
    const byId=new Map((data?.menu||[]).filter(sellable).map(x=>[x.id,x]));
    const invalid=cart.items.find(i=>!byId.get(i.id)?.variants?.some(v=>v.label===i.variant));
    if(invalid){
      setNotice("เมนู "+invalid.name+" ไม่พร้อมขายแล้ว ระบบกำลังอัปเดตตะกร้า");
      load().catch(()=>{});
      return;
    }
    setResult("");
    setPayOpen(true);
  }

  return <section className="flex h-full min-h-0">
    <div className="flex min-w-0 flex-1 flex-col p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between">
        <div><p className="gold m-0 text-[10px] font-bold tracking-[.3em]">POINT OF SALE</p><h1 className="m-0 mt-1 text-xl font-semibold tracking-wide md:text-2xl">FIELD DRINKS</h1></div>
        <div className="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs text-slate-600">{session.user.username}</div>
      </div>

      {notice&&<div className="mb-3 flex items-start justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"><span>{notice}</span><button onClick={()=>setNotice("")} className="shrink-0"><X size={16}/></button></div>}

      <div className="glass mb-3 flex items-center gap-3 rounded-2xl px-4 py-3"><Search size={18} className="text-slate-500"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="ค้นหาเมนู" className="w-full bg-transparent outline-none"/></div>

      <div className="soft-scroll mb-4 flex gap-2 overflow-x-auto">{cats.map(x=><button key={x} onClick={()=>setCat(x)} className={"shrink-0 rounded-full border px-4 py-2 text-xs font-semibold "+(cat===x?"border-[#c59b19] bg-[#d4af37] text-black shadow-sm":"border-slate-300 bg-white text-slate-700")}>{x}</button>)}</div>

      <div className="soft-scroll min-h-0 flex-1 overflow-auto">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-4">{menu.map(x=><button key={x.id} onClick={()=>setSelected(x)} className="glass group min-h-[156px] rounded-[24px] p-4 text-left hover:border-[#c59b19]"><div className="mb-7 grid h-10 w-10 place-items-center rounded-xl bg-[#f4ecd0] text-sm font-bold text-[#765b08]">{x.name.slice(0,1)}</div><div className="text-[10px] uppercase tracking-widest text-slate-500">{x.category||"DRINK"}</div><b className="mt-1 block line-clamp-2">{x.name}</b><div className="mt-3 text-lg font-semibold text-[#765b08]">฿{x.price.toFixed(0)}</div></button>)}</div>
      </div>
    </div>

    <div className="fixed bottom-[84px] left-4 right-4 z-30 flex items-center justify-between rounded-[22px] border border-slate-300 bg-white/95 p-2 pl-5 shadow-lg backdrop-blur lg:hidden">
      <div><small className="block text-[10px] tracking-widest text-slate-500">{cart.items.reduce((s,i)=>s+i.qty,0)} ITEMS</small><b className="text-lg text-[#765b08]">฿{cart.getTotal().toFixed(0)}</b></div>
      <button disabled={!cart.items.length} onClick={openPayment} className="rounded-2xl bg-[#d4af37] px-5 py-3 text-sm font-bold text-black disabled:opacity-30">CHECKOUT</button>
    </div>

    <aside className="glass m-3 ml-0 hidden w-[360px] shrink-0 flex-col rounded-[24px] p-5 lg:flex">
      <div className="mb-4 flex items-center justify-between"><div><p className="m-0 text-[10px] tracking-[.25em] text-slate-500">CURRENT ORDER</p><h2 className="m-0 mt-1 text-lg">CART</h2></div><span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs">{cart.items.reduce((s,i)=>s+i.qty,0)} ITEMS</span></div>
      <div className="soft-scroll min-h-0 flex-1 overflow-auto">{cart.items.length===0?<div className="grid h-full place-items-center text-sm text-slate-400">เลือกเมนูเพื่อเริ่มออเดอร์</div>:cart.items.map(i=><div key={i.key} className="mb-3 rounded-[18px] border border-slate-200 bg-slate-100/70 p-4"><div className="flex gap-3"><div className="flex-1"><b className="text-sm">{i.name}</b><small className="mt-1 block text-slate-500">{i.variant}</small></div><button onClick={()=>cart.removeItem(i.key)} className="text-slate-500 hover:text-red-600"><Trash2 size={16}/></button></div><div className="mt-3 flex items-center justify-between"><div className="flex items-center gap-2"><button onClick={()=>cart.updateQuantity(i.key,i.qty-1)} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-300 bg-white"><Minus size={13}/></button><span className="w-5 text-center">{i.qty}</span><button onClick={()=>cart.updateQuantity(i.key,i.qty+1)} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-300 bg-white"><Plus size={13}/></button></div><b className="text-[#765b08]">฿{(i.price*i.qty).toFixed(0)}</b></div></div>)}</div>
      <div className="border-t border-slate-300 pt-4"><div className="mb-2 flex justify-between text-sm text-slate-600"><span>Subtotal</span><span>฿{cart.getSubtotal().toFixed(0)}</span></div><div className="mb-4 flex justify-between text-xl font-semibold"><span>Total</span><span className="text-[#765b08]">฿{cart.getTotal().toFixed(0)}</span></div><button disabled={!cart.items.length} onClick={openPayment} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#d4af37] py-3 font-bold text-black disabled:opacity-30"><WalletCards size={18}/>CHECKOUT / PAY</button></div>
    </aside>

    {selected&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4" onMouseDown={()=>setSelected(null)}><div className="card w-full max-w-md border border-slate-300 bg-white p-6 shadow-2xl" onMouseDown={e=>e.stopPropagation()}><div className="flex items-start justify-between"><div><p className="gold text-[10px] tracking-[.25em]">{selected.category||"DRINK"}</p><h3 className="mt-1 text-xl">{selected.name}</h3></div><button onClick={()=>setSelected(null)}><X/></button></div><p className="mt-5 text-xs uppercase tracking-widest text-slate-500">Choose variant</p><div className="mt-3 grid gap-2">{selected.variants.map(v=><button key={v.label} onClick={()=>{cart.addItem({id:selected.id,name:selected.name,variant:v.label,price:selected.price});setSelected(null)}} className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-left hover:border-[#c59b19]">{v.label||"Standard"} <span className="float-right font-semibold text-[#765b08]">฿{selected.price.toFixed(0)}</span></button>)}</div></div></div>}

    {payOpen&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4"><div className="card w-full max-w-md border border-slate-300 bg-white p-6 shadow-2xl"><div className="flex justify-between"><div><p className="gold text-[10px] tracking-[.25em]">PAYMENT</p><h3 className="mt-1 text-2xl font-semibold">ยอดชำระ ฿{cart.getTotal().toFixed(0)}</h3></div><button disabled={busy} onClick={()=>setPayOpen(false)} className="disabled:cursor-not-allowed disabled:opacity-30"><X/></button></div>
      <div className="mt-5 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1"><button onClick={()=>setMethod("cash")} className={"rounded-xl p-3 "+(method==="cash"?"bg-[#d4af37] font-semibold text-black shadow-sm":"text-slate-700")}>Cash</button><button onClick={()=>setMethod("promptpay")} className={"rounded-xl p-3 "+(method==="promptpay"?"bg-[#d4af37] font-semibold text-black shadow-sm":"text-slate-700")}>PromptPay</button></div>
      {customers.length>0&&<select value={customerId} onChange={e=>setCustomerId(e.target.value)} className="mt-4 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3"><option value="">ลูกค้าทั่วไป / ไม่สะสมแต้ม</option>{customers.map(x=><option key={x.id} value={x.id}>{x.name} · {x.points||0} pts</option>)}</select>}
      {method==="cash"&&<><input autoFocus inputMode="decimal" value={received} onChange={e=>setReceived(e.target.value)} placeholder="จำนวนเงินที่รับ" className="mt-4 w-full rounded-2xl border border-slate-300 bg-slate-100 px-4 py-3 text-lg outline-none focus:border-[#c59b19]"/>{received.trim()!==""&&Number.isFinite(cashDelta)&&<div className={"mt-3 flex items-center justify-between rounded-2xl border px-4 py-3 "+(cashDelta>=0?"border-emerald-300 bg-emerald-50 text-emerald-900":"border-red-300 bg-red-50 text-red-800")}><span>{cashDelta>=0?"เงินทอน":"ขาดอีก"}</span><b className="text-xl">฿{Math.abs(cashDelta).toFixed(0)}</b></div>}</>}
      {method==="promptpay"&&prompt?.qrUrl&&<div className="mt-4 rounded-[20px] border border-slate-300 bg-white p-4 text-center"><img src={prompt.qrUrl} alt="PromptPay QR" className="mx-auto max-h-56 w-auto"/><p className="mt-2 text-xs font-semibold text-black">{prompt.paid?"ชำระเงินแล้ว":"สแกน QR แล้วระบบจะตรวจสอบอัตโนมัติ"}</p></div>}
      <button disabled={busy||!cart.items.length||(method==="cash"&&(!Number.isFinite(cashReceived)||cashReceived<cart.getTotal()))} onClick={checkout} className="mt-5 w-full rounded-2xl bg-[#d4af37] py-3.5 font-bold text-black disabled:opacity-40">{busy?(method==="promptpay"&&prompt?"WAITING FOR PAYMENT...":"PROCESSING..."):(method==="promptpay"?"CREATE QR / PAY":"CONFIRM PAYMENT")}</button>
      {result&&<p className="mt-4 rounded-xl bg-slate-100 px-3 py-2 text-center text-sm text-slate-700">{result}</p>}
    </div></div>}

    {lastSale&&<div className="fixed bottom-[92px] right-4 z-[70] w-[min(420px,calc(100vw-2rem))] rounded-[24px] border border-emerald-300 bg-white p-5 shadow-2xl md:bottom-6 md:right-6"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700"><CheckCircle2 size={22}/></div><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div><b className="text-lg">ชำระเงินสำเร็จ</b><p className="mt-1 text-sm text-slate-600">คิว {lastSale.queueNo} · บัตร {lastSale.pager||"—"}{lastSale.recovered?" · กู้คืนรายการเดิม":""}</p></div><button onClick={()=>setLastSale(null)}><X size={18}/></button></div>{lastSale.payment==="cash"&&<div className="mt-3 rounded-2xl bg-emerald-50 p-3"><span className="text-sm text-emerald-800">เงินทอน</span><div className="text-2xl font-bold text-emerald-800">฿{lastSale.change.toFixed(0)}</div></div>}<button onClick={()=>router.push("/queue")} className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-slate-50 py-2.5 text-sm font-semibold">ไปคิวผลิต <ArrowRight size={16}/></button></div></div></div>}
  </section>;
}
