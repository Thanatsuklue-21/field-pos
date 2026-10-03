"use client";

import {useEffect,useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import {ArrowRight,CheckCircle2,Minus,Plus,Search,Trash2,WalletCards,X} from "lucide-react";
import AuthGate from "@/components/auth-gate";
import {api,type Bootstrap,type MenuItem,type Session} from "@/lib/api-client";
import {additionalServingsAvailable,cartAvailability} from "@/lib/domain/availability.mjs";
import {useCartStore} from "@/stores/cart-store";

export default function Pos(){return <AuthGate>{s=><PosView session={s}/>}</AuthGate>}

function localDate(){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}

const PENDING_KEY="field-pos-pending-promptpay-v1";
type PendingPrompt={requestKey:string;payRequestKey?:string;sessionId?:string;date:string;cart:{id:string;variant:string;qty:number}[];paymentReference:string;total:number;customerId:string|null;createdAt:number};
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

function orderOptionLabel(label:string){
  const raw=String(label||"").trim(),v=raw.toLowerCase().replace(/\s+/g,"");
  if(["100%","normal","ปกติ","หวานปกติ"].includes(v))return "หวานปกติ (100%)";
  if(["50%","less","lesssweet","หวานน้อย"].includes(v))return "หวานน้อย (50%)";
  if(["0%","no","nosweet","ไม่หวาน"].includes(v))return "ไม่หวาน (0%)";
  if(!raw||v==="standard")return "สูตรมาตรฐาน";
  return raw;
}

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
  const [promptConfig,setPromptConfig]=useState<any|null>(null);
  const [customers,setCustomers]=useState<any[]>([]);
  const [customerId,setCustomerId]=useState("");
  const cart=useCartStore();

  const load=()=>api<Bootstrap>("/api/pos/bootstrap").then(setData);

  useEffect(()=>{
    load().catch(()=>{});
    api<any>("/api/customers").then(x=>setCustomers(x.customers||[])).catch(()=>{});
    api<any>("/api/payments/promptpay/config").then(setPromptConfig).catch(()=>setPromptConfig({ready:false,configured:false}));
    recoverCashCheckout().then(()=>recoverPending()).catch(()=>{});
  },[]);

  useEffect(()=>{
    try{
      const raw=sessionStorage.getItem("field-pos-edit-cash-v1");
      if(!raw)return;
      sessionStorage.removeItem("field-pos-edit-cash-v1");
      const edit=JSON.parse(raw),heldCash=Number(edit?.heldCash);
      if(Number.isFinite(heldCash)&&heldCash>0){
        setMethod("cash");
        setReceived(String(heldCash));
        setNotice("กำลังแก้ไข "+String(edit?.fromQueue||edit?.fromBill||"บิลเดิม")+" · ยอดเงินสดจากบิลเดิม ฿"+heldCash.toFixed(0)+" ถูกกรอกไว้แล้ว เพิ่ม/ลด/เปลี่ยนเมนูแล้วกด CHECKOUT ใหม่");
      }
    }catch{}
  },[]);

  useEffect(()=>{
    const refresh=()=>load().catch(()=>{});
    const visible=()=>{if(document.visibilityState==="visible")refresh()};
    const timer=setInterval(refresh,15000);
    window.addEventListener("focus",refresh);document.addEventListener("visibilitychange",visible);
    return()=>{clearInterval(timer);window.removeEventListener("focus",refresh);document.removeEventListener("visibilitychange",visible)};
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
      const currentVariant=current?.variants?.find(v=>v.label===item.variant);
      if(!current||!currentVariant){removed.push(item.name);changed=true;return []}
      if(!currentVariant.available){
        const missing=(currentVariant.missingIngredients||[]).map(x=>x.name).join(", ");
        removed.push(item.name+(missing?" (ขาด "+missing+")":""));
        changed=true;
        return [];
      }
      if(item.name!==current.name||item.price!==current.price){changed=true;return [{...item,name:current.name,price:current.price}]}
      return [item];
    });
    if(changed)cart.replaceItems(next);
    if(removed.length)setNotice("นำ "+removed.join(", ")+" ออกจากตะกร้าอัตโนมัติ เพราะสต็อกหรือสูตรไม่พร้อม กรุณาตรวจยอดก่อนชำระ");
  },[data?.revision]);

  const cats=useMemo(()=>["ทั้งหมด",...Array.from(new Set((data?.menu||[]).filter(sellable).map(x=>x.category||"อื่นๆ")))], [data]);
  const menu=(data?.menu||[]).filter(x=>sellable(x)&&(cat==="ทั้งหมด"||(x.category||"อื่นๆ")===cat)&&x.name.toLowerCase().includes(q.toLowerCase()));
  const allUnavailable=menu.length>0&&menu.every(x=>!x.available);
  const unavailableNames=Array.from(new Set(menu.flatMap(x=>x.variants.flatMap(v=>v.missingIngredients||[]).map(i=>i.name)))).slice(0,4);
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
    load().catch(()=>{});
  }

  function availabilityMessage(result:ReturnType<typeof cartAvailability>){
    if(result.shortages.length)return "วัตถุดิบเพียงพอไม่ครบสำหรับตะกร้านี้ · ขาด: "+result.shortages.map(x=>x.name).join(", ");
    return "มีเมนูหรือตัวเลือกที่หมดชั่วคราว กรุณาตรวจตะกร้า";
  }

  function addVariant(product:MenuItem,variant:MenuItem["variants"][number]){
    const remaining=additionalServingsAvailable({cart:cart.items,menu:data?.menu||[],stock:data?.availabilityStock||{},menuId:product.id,variantLabel:variant.label});
    if(!variant.available||remaining<1){setNotice("วัตถุดิบเพียงพออีก 0 แก้วเท่านั้น"+(variant.missingIngredients?.length?" · ขาด: "+variant.missingIngredients.map(x=>x.name).join(", "):""));return}
    cart.addItem({id:product.id,name:product.name,variant:variant.label,price:product.price});setSelected(null);
  }

  function updateCartQuantity(key:string,nextQty:number){
    const item=cart.items.find(x=>x.key===key);if(!item)return;
    if(nextQty<=item.qty){cart.updateQuantity(key,nextQty);return}
    const remaining=additionalServingsAvailable({cart:cart.items,menu:data?.menu||[],stock:data?.availabilityStock||{},menuId:item.id,variantLabel:item.variant});
    if(remaining<1){setNotice("วัตถุดิบเพียงพออีก 0 แก้วเท่านั้น");return}
    cart.updateQuantity(key,nextQty);
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
    if(p.sessionId){
      const status=await api<any>("/api/pos/split/status",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({sessionId:p.sessionId})});
      if(status?.session?.status==="completed"){
        pendingClear();
        cart.clearCart();
        finishSale({queueNo:status.session.queueNo,pager:status.session.pager,total:status.session.total},{payment:"promptpay",total:p.total,received:p.total,recovered:true});
        return status;
      }
      const allocations=p.cart.map((x,index)=>({index,qty:x.qty}));
      const body={requestKey:p.payRequestKey||crypto.randomUUID(),sessionId:p.sessionId,method:"promptpay",allocations,paymentReference:p.paymentReference,paymentVerified:verified,label:"PromptPay"};
      try{
        const r=await api<any>("/api/pos/split/pay",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)});
        pendingClear();
        cart.clearCart();
        finishSale(r,{payment:"promptpay",total:p.total,received:p.total,recovered:true});
        return r;
      }catch(e:any){
        if(e.message==="split_session_unavailable"){
          const retry=await api<any>("/api/pos/split/status",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({sessionId:p.sessionId})});
          if(retry?.session?.status==="completed"){
            pendingClear();
            cart.clearCart();
            finishSale({queueNo:retry.session.queueNo,pager:retry.session.pager,total:retry.session.total},{payment:"promptpay",total:p.total,received:p.total,recovered:true});
            return retry;
          }
        }
        throw e;
      }
    }
    const body={requestKey:p.requestKey,date:p.date,cart:p.cart,payment:"promptpay",received:p.total,paymentReference:p.paymentReference,paymentVerified:verified,customerId:p.customerId};
    const r=await api<any>("/api/pos/checkout",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)});
    pendingClear();
    cart.clearCart();
    finishSale(r,{payment:"promptpay",total:p.total,received:p.total,recovered:true});
    return r;
  }

  async function cancelPendingReservation(p:PendingPrompt){
    if(!p.sessionId)return;
    try{
      await api<any>("/api/pos/split/cancel",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({requestKey:crypto.randomUUID(),sessionId:p.sessionId})});
    }catch(e:any){
      if(!["split_session_unavailable","split_session_not_found"].includes(e.message))throw e;
    }
  }

  async function ensurePendingPrompt(p:PendingPrompt){
    let next={...p};
    if(!next.sessionId){
      const reserved=await api<any>("/api/pos/split/start",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({requestKey:next.requestKey,date:next.date,cart:next.cart,customerId:next.customerId,mode:"promptpay_full"})});
      const serverTotal=Number(reserved?.session?.total);
      if(!reserved?.session?.id||!Number.isFinite(serverTotal)||serverTotal<=0)throw new Error("promptpay_reservation_failed");
      next={...next,sessionId:reserved.session.id,total:serverTotal};
      pendingWrite(next);
    }
    let st:any=null;
    if(!next.paymentReference){
      st=await api<any>("/api/payments/promptpay/create",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({amount:next.total,reference:next.sessionId})});
      if(!st?.chargeId)throw new Error("promptpay_qr_unavailable");
      next={...next,paymentReference:st.chargeId};
      pendingWrite(next);
    }
    return {pending:next,status:st};
  }

  async function recoverPending(){
    let p=pendingRead();
    if(!p)return;
    try{
      if(!p.sessionId||!p.paymentReference){
        const resumed=await ensurePendingPrompt(p);
        p=resumed.pending;
        if(resumed.status)setPrompt(resumed.status);
      }
      if(p.sessionId){
        const sessionStatus=await api<any>("/api/pos/split/status",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({sessionId:p.sessionId})});
        if(sessionStatus?.session?.status==="completed"){
          pendingClear();
          cart.clearCart();
          finishSale({queueNo:sessionStatus.session.queueNo,pager:sessionStatus.session.pager,total:sessionStatus.session.total},{payment:"promptpay",total:p.total,received:p.total,recovered:true});
          return;
        }
        if(["expired","cancelled"].includes(String(sessionStatus?.session?.status||"").toLowerCase())){pendingClear();return}
      }
      const st=await api<any>("/api/payments/promptpay/status",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({chargeId:p.paymentReference})});
      if(st.paid){await finalizePending(p,st.chargeId||p.paymentReference);return}
      if(["failed","expired","reversed"].includes(String(st.status||"").toLowerCase())){await cancelPendingReservation(p);pendingClear();return}
      setMethod("promptpay");
      setPrompt(st);
      setPayOpen(true);
      setResult("พบ PromptPay ที่ยังรอชำระ ระบบใช้ QR เดิม ตรวจสอบรายการเดิม และยังคงจอง Stock ไว้เพื่อป้องกันรับเงินเกินจำนวนที่ขายได้");
    }catch{
      setMethod("promptpay");
      setPayOpen(true);
      setResult("ยังตรวจสอบ PromptPay รายการเดิมไม่ได้ ระบบเก็บรายการและ Stock reservation ไว้เพื่อป้องกันบิล/การรับเงินซ้ำ");
    }
  }

  function errorText(code:string){
    return code==="cash_insufficient"?"จำนวนเงินรับไม่พอ":
      code==="menu_unavailable"?"มีเมนูในตะกร้าที่ปิดขาย ราคาเป็น 0 หรือยังไม่พร้อมขาย กรุณาตรวจตะกร้าใหม่":
      code==="request_key_conflict"?"รายการเดิมถูกเปลี่ยน กรุณาตรวจประวัติออเดอร์ก่อนชำระอีกครั้ง":
      code==="recipe_unavailable"?"สูตรเมนูยังไม่ครบหรือมีปริมาณผิด กรุณาตรวจสูตรก่อนขาย":
      code==="day_closed"?"วันนี้ปิดยอดแล้ว ไม่สามารถรับรายการขายเพิ่มได้":
      code==="variant_unavailable"?"ตัวเลือกของเมนูในตะกร้าเปลี่ยนแล้ว กรุณาเลือกเมนูใหม่":
      (code==="stock_shortage"||code.startsWith("stock_shortage:"))?"วัตถุดิบไม่เพียงพอสำหรับออเดอร์นี้":
      code==="promptpay_timeout"?"หมดเวลารอ PromptPay ระบบยังเก็บรายการจองไว้ชั่วคราวและจะตรวจสอบอีกครั้ง":
      code==="promptpay_not_ready"?"PromptPay ยังไม่พร้อมใช้งาน กรุณารอ Beam อนุมัติและตั้งค่า API/Webhook ให้ครบ":
      code==="promptpay_provider_not_configured"?"ยังไม่ได้ตั้งค่า Beam Merchant ID / API Key":
      code==="promptpay_webhook_not_configured"?"ยังไม่ได้ตั้งค่า Beam Webhook HMAC Key":
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
      let checkoutTotal=cart.getTotal();
      const cartPayload=cart.items.map(i=>({id:i.id,variant:i.variant,qty:i.qty}));
      let paymentVerified:any=true,paymentReference:any=null,requestKey=crypto.randomUUID();
      if(method==="cash"&&Number(received)<checkoutTotal)throw Object.assign(new Error("cash_insufficient"),{status:409});

      if(method==="promptpay"){
        if(promptConfig?.ready!==true)throw Object.assign(new Error("promptpay_not_ready"),{status:503});
        let st:any=null;
        let activePending:PendingPrompt|null=null;
        const existing=pendingRead();
        if(existing){
          let resumed=existing,current:any=null;
          if(!resumed.sessionId||!resumed.paymentReference){
            const setup=await ensurePendingPrompt(resumed);
            resumed=setup.pending;
            current=setup.status;
          }
          if(!current)current=await api<any>("/api/payments/promptpay/status",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({chargeId:resumed.paymentReference})});
          if(current.paid){await finalizePending(resumed,current.chargeId||resumed.paymentReference);return}
          if(["failed","expired","reversed"].includes(String(current.status||"").toLowerCase())){await cancelPendingReservation(resumed);pendingClear()}
          else if(!samePending(resumed,checkoutTotal,cartPayload,customerId))throw Object.assign(new Error("pending_promptpay_exists"),{status:409});
          else{st=current;paymentReference=resumed.paymentReference;requestKey=resumed.requestKey;activePending=resumed;checkoutTotal=resumed.total}
        }
        if(!st){
          const reservationKey=crypto.randomUUID();
          const payRequestKey=crypto.randomUUID();
          activePending={requestKey:reservationKey,payRequestKey,date:localDate(),cart:cartPayload,paymentReference:"",total:checkoutTotal,customerId:customerId||null,createdAt:Date.now()};
          pendingWrite(activePending);
          const setup=await ensurePendingPrompt(activePending);
          activePending=setup.pending;
          st=setup.status||await api<any>("/api/payments/promptpay/status",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({chargeId:activePending.paymentReference})});
          checkoutTotal=activePending.total;
          paymentReference=activePending.paymentReference;
        }
        setPrompt(st);
        const deadline=Date.now()+15*60*1000;
        while(!st.paid&&Date.now()<deadline){
          if(["failed","expired","reversed"].includes(String(st.status||"").toLowerCase())){
            if(activePending)await cancelPendingReservation(activePending);
            pendingClear();
            throw Object.assign(new Error("promptpay_failed"),{status:409});
          }
          await new Promise(resolve=>setTimeout(resolve,2500));
          st=await api<any>("/api/payments/promptpay/status",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({chargeId:paymentReference})});
          setPrompt(st);
        }
        if(!st.paid)throw new Error("promptpay_timeout");
        const p=activePending||pendingRead();
        if(p?.sessionId){await finalizePending(p,st.chargeId||paymentReference);return}
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
      if(["menu_unavailable","variant_unavailable"].includes(e.message)||e.message==="stock_shortage"||e.message.startsWith("stock_shortage:")){
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
    const blocked=cart.items.filter(item=>{
      const variant=byId.get(item.id)?.variants?.find(v=>v.label===item.variant);
      return !variant||!variant.available;
    });
    if(blocked.length){
      const blockedKeys=new Set(blocked.map(item=>item.key));
      cart.replaceItems(cart.items.filter(item=>!blockedKeys.has(item.key)));
      setNotice("นำ "+blocked.map(item=>item.name).join(", ")+" ออกจากตะกร้า เพราะเมนูหมดชั่วคราวหรือสูตรไม่พร้อม · กรุณาตรวจยอดแล้วกด CHECKOUT อีกครั้ง");
      load().catch(()=>{});
      return;
    }
    const current=cartAvailability({cart:cart.items,menu:data?.menu||[],stock:data?.availabilityStock||{}});
    if(!current.available){setNotice(availabilityMessage(current));load().catch(()=>{});return}
    setResult("");
    setPayOpen(true);
  }

  return <section className="flex h-full min-h-0">
    <div className="flex min-w-0 flex-1 flex-col p-3 sm:p-4 md:p-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div><p className="gold m-0 text-[10px] font-bold tracking-[.3em]">POINT OF SALE</p><h1 className="m-0 mt-1 text-xl font-semibold tracking-wide md:text-2xl">FIELD DRINKS</h1></div>
        <div className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] text-slate-600 sm:px-4 sm:py-2 sm:text-xs">{session.user.username}</div>
      </div>

      {notice&&<div className="mb-3 flex items-start justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"><span>{notice}</span><button onClick={()=>setNotice("")} className="shrink-0"><X size={16}/></button></div>}
      {allUnavailable&&<div className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"><b>เมนูทั้งหมดถูกพักขายชั่วคราว</b><p className="mt-1 text-xs">ต้องบันทึกยอดวัตถุดิบจริงก่อนรับออเดอร์{unavailableNames.length?" · ขาด: "+unavailableNames.join(", "):""}</p><button onClick={()=>router.push("/stock")} className="mt-3 rounded-full bg-red-700 px-4 py-2 text-xs font-bold text-white">ตั้งยอดเริ่มต้น Stock</button></div>}

      <div className="glass mb-2.5 flex items-center gap-2.5 rounded-2xl px-3 py-2.5 sm:mb-3 sm:gap-3 sm:px-4 sm:py-3"><Search size={17} className="text-slate-500"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="ค้นหาเมนู" className="w-full bg-transparent outline-none"/></div>

      <div className="soft-scroll mb-3 flex gap-1.5 overflow-x-auto sm:mb-4 sm:gap-2">{cats.map(x=><button key={x} onClick={()=>setCat(x)} className={"shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold sm:px-4 sm:py-2 sm:text-xs "+(cat===x?"border-[#c59b19] bg-[#d4af37] text-black shadow-sm":"border-slate-300 bg-white text-slate-700")}>{x}</button>)}</div>

      <div className="soft-scroll min-h-0 flex-1 overflow-auto">
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 2xl:grid-cols-4">{menu.map(x=><button key={x.id} disabled={!x.available} onClick={()=>setSelected(x)} className="glass group min-h-[154px] overflow-hidden rounded-[20px] text-left sm:min-h-[190px] sm:rounded-[24px] hover:border-[#c59b19] disabled:border-slate-200 disabled:bg-slate-100 disabled:opacity-65"><div className="relative h-20 bg-[#f4ecd0] sm:h-24">{x.image?<img src={x.image} alt={x.name} className="h-full w-full object-cover"/>:<div className="grid h-full place-items-center text-2xl font-bold text-[#765b08]">{x.name.slice(0,1)}</div>}<div className="absolute right-2 top-2">{!x.available?<span className="rounded-full bg-red-100 px-2 py-1 text-[10px] font-bold text-red-700">หมดชั่วคราว</span>:x.lowStock?<span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-800">เหลือประมาณ {x.maxServings} แก้ว</span>:null}</div></div><div className="p-3 sm:p-4"><div className="text-[9px] uppercase tracking-widest text-slate-500 sm:text-[10px]">{x.category||"DRINK"}</div><b className="mt-1 block line-clamp-2 text-sm sm:text-base">{x.name}</b><div className="mt-2 text-base font-semibold text-[#765b08] sm:mt-3 sm:text-lg">฿{x.price.toFixed(0)}</div>{!x.available&&<small className="mt-2 block text-xs text-red-600">{Array.from(new Set(x.variants.flatMap(v=>v.missingIngredients||[]).map(i=>i.name))).slice(0,2).join(", ")||"สูตรยังไม่พร้อม"}</small>}</div></button>)}</div>
      </div>
    </div>

    <div className="fixed bottom-[70px] left-2 right-2 z-30 flex items-center justify-between rounded-[18px] border border-slate-300 bg-white/95 p-1.5 pl-4 shadow-lg backdrop-blur sm:bottom-[78px] sm:left-4 sm:right-4 sm:rounded-[22px] sm:p-2 sm:pl-5 lg:hidden">
      <div><small className="block text-[10px] tracking-widest text-slate-500">{cart.items.reduce((s,i)=>s+i.qty,0)} ITEMS</small><b className="text-lg text-[#765b08]">฿{cart.getTotal().toFixed(0)}</b></div>
      <button disabled={!cart.items.length} onClick={openPayment} className="min-h-11 rounded-2xl bg-[#d4af37] px-4 py-2.5 text-sm font-bold text-black disabled:opacity-30 sm:px-5 sm:py-3">CHECKOUT</button>
    </div>

    <aside className="glass m-3 ml-0 hidden w-[360px] shrink-0 flex-col rounded-[24px] p-5 lg:flex">
      <div className="mb-4 flex items-center justify-between"><div><p className="m-0 text-[10px] tracking-[.25em] text-slate-500">CURRENT ORDER</p><h2 className="m-0 mt-1 text-lg">CART</h2></div><span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs">{cart.items.reduce((s,i)=>s+i.qty,0)} ITEMS</span></div>
      <div className="soft-scroll min-h-0 flex-1 overflow-auto">{cart.items.length===0?<div className="grid h-full place-items-center text-sm text-slate-400">เลือกเมนูเพื่อเริ่มออเดอร์</div>:cart.items.map(i=><div key={i.key} className="mb-3 rounded-[18px] border border-slate-200 bg-slate-100/70 p-4"><div className="flex gap-3"><div className="flex-1"><b className="text-sm">{i.name}</b><small className="mt-1 block text-slate-500">{i.variant}</small></div><button onClick={()=>cart.removeItem(i.key)} className="text-slate-500 hover:text-red-600"><Trash2 size={16}/></button></div><div className="mt-3 flex items-center justify-between"><div className="flex items-center gap-2"><button onClick={()=>updateCartQuantity(i.key,i.qty-1)} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-300 bg-white"><Minus size={13}/></button><span className="w-5 text-center">{i.qty}</span><button onClick={()=>updateCartQuantity(i.key,i.qty+1)} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-300 bg-white"><Plus size={13}/></button></div><b className="text-[#765b08]">฿{(i.price*i.qty).toFixed(0)}</b></div></div>)}</div>
      <div className="border-t border-slate-300 pt-4"><div className="mb-2 flex justify-between text-sm text-slate-600"><span>Subtotal</span><span>฿{cart.getSubtotal().toFixed(0)}</span></div><div className="mb-4 flex justify-between text-xl font-semibold"><span>Total</span><span className="text-[#765b08]">฿{cart.getTotal().toFixed(0)}</span></div><button disabled={!cart.items.length} onClick={openPayment} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#d4af37] py-3 font-bold text-black disabled:opacity-30"><WalletCards size={18}/>CHECKOUT / PAY</button></div>
    </aside>

    {selected&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-3 sm:p-4" onMouseDown={()=>setSelected(null)}><div className="card w-full max-w-md border border-slate-300 bg-white p-4 shadow-2xl sm:p-6" onMouseDown={e=>e.stopPropagation()}><div className="flex items-start justify-between"><div><p className="gold text-[10px] tracking-[.25em]">{selected.category||"DRINK"}</p><h3 className="mt-1 text-lg sm:text-xl">{selected.name}</h3></div><button onClick={()=>setSelected(null)}><X/></button></div><p className="mt-5 text-xs uppercase tracking-widest text-slate-500">Choose variant</p><div className="mt-3 grid gap-2">{selected.variants.map(v=><button key={v.label} disabled={!v.available} onClick={()=>addVariant(selected,v)} className="min-h-11 rounded-2xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-left hover:border-[#c59b19] sm:px-4 sm:py-3 disabled:bg-slate-100 disabled:text-slate-400"><span>{v.label||"Standard"}{!v.available&&<small className="ml-2 text-red-600">หมดชั่วคราว</small>}{v.available&&v.lowStock&&<small className="ml-2 text-amber-700">เหลือประมาณ {v.maxServings} แก้ว</small>}</span><span className="float-right font-semibold text-[#765b08]">฿{selected.price.toFixed(0)}</span>{!v.available&&v.missingIngredients?.length>0&&<small className="mt-1 block text-xs text-red-500">ขาด: {v.missingIngredients.map(i=>i.name).join(", ")}</small>}</button>)}</div></div></div>}

    {payOpen&&<div className="fixed inset-0 z-[80] grid place-items-center bg-black/55 p-3 sm:p-4"><div className="soft-scroll card max-h-[94vh] w-full max-w-md overflow-auto border border-slate-300 bg-white p-4 pb-3 shadow-2xl sm:p-6 sm:pb-4"><div className="flex justify-between"><div><p className="gold text-[10px] tracking-[.25em]">PAYMENT</p><h3 className="mt-1 text-2xl font-semibold">ยอดชำระ ฿{cart.getTotal().toFixed(0)}</h3><p className="mt-1 text-xs text-slate-500">{cart.items.reduce((s,i)=>s+i.qty,0)} แก้ว · {cart.items.length} เมนู</p></div><button disabled={busy} onClick={()=>setPayOpen(false)} className="disabled:cursor-not-allowed disabled:opacity-30"><X/></button></div>

      <div className="mt-4 rounded-[20px] border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center justify-between gap-3"><div><b className="text-sm">รายการที่สั่ง</b><p className="mt-0.5 text-[11px] text-slate-500">ทวนเมนู ราคา และระดับหวานก่อนรับเงิน</p></div><b className="shrink-0 text-lg text-[#765b08]">฿{cart.getTotal().toFixed(0)}</b></div>
        <div className="soft-scroll mt-3 max-h-[230px] space-y-2 overflow-auto pr-1">
          {cart.items.map(i=><div key={i.key} className="rounded-2xl border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1"><b className="block text-sm">{i.name}</b><span className="mt-1 inline-block rounded-full bg-[#f4ecd0] px-2 py-1 text-[10px] font-semibold text-[#765b08]">{orderOptionLabel(i.variant)}</span></div><button disabled={busy} onClick={()=>cart.removeItem(i.key)} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30" aria-label={"ลบ "+i.name}><Trash2 size={15}/></button></div>
            <div className="mt-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><button disabled={busy} onClick={()=>updateCartQuantity(i.key,i.qty-1)} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-300 bg-white disabled:opacity-30"><Minus size={13}/></button><span className="min-w-6 text-center text-sm font-semibold">{i.qty}</span><button disabled={busy} onClick={()=>updateCartQuantity(i.key,i.qty+1)} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-300 bg-white disabled:opacity-30"><Plus size={13}/></button></div><div className="text-right"><small className="block text-[10px] text-slate-500">{i.qty} × ฿{i.price.toFixed(0)}</small><b className="text-sm text-[#765b08]">฿{(i.qty*i.price).toFixed(0)}</b></div></div>
          </div>)}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3"><span className="text-sm font-semibold">รวม {cart.items.reduce((s,i)=>s+i.qty,0)} แก้ว</span><b className="text-xl text-[#765b08]">฿{cart.getTotal().toFixed(0)}</b></div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1"><button onClick={()=>setMethod("cash")} className={"rounded-xl p-3 "+(method==="cash"?"bg-[#d4af37] font-semibold text-black shadow-sm":"text-slate-700")}>Cash</button><button disabled={promptConfig?.ready!==true} onClick={()=>setMethod("promptpay")} title={promptConfig?.ready===true?"PromptPay พร้อมใช้งาน":"รอ Beam อนุมัติ / ตั้งค่า API และ Webhook"} className={"rounded-xl p-3 disabled:cursor-not-allowed disabled:opacity-45 "+(method==="promptpay"?"bg-[#d4af37] font-semibold text-black shadow-sm":"text-slate-700")}>PromptPay{promptConfig?.selectedProvider==="beam"&&promptConfig?.mode==="test"?" · TEST":""}</button></div>
      {promptConfig?.ready!==true&&<div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">PromptPay ยังไม่เปิดรับเงินจริง · ระบบกำลังรอ Beam Merchant/API/Webhook ให้พร้อม</div>}
      {customers.length>0&&<select value={customerId} onChange={e=>setCustomerId(e.target.value)} className="mt-4 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3"><option value="">ลูกค้าทั่วไป / ไม่สะสมแต้ม</option>{customers.map(x=><option key={x.id} value={x.id}>{x.name} · {x.points||0} pts</option>)}</select>}
      {method==="cash"&&<><div className="mt-4 grid grid-cols-[1fr_auto] gap-2"><input autoFocus inputMode="decimal" value={received} onChange={e=>setReceived(e.target.value)} placeholder="จำนวนเงินที่รับ" className="min-w-0 rounded-2xl border border-slate-300 bg-slate-100 px-4 py-3 text-lg outline-none focus:border-[#c59b19]"/><button type="button" disabled={busy||!cart.items.length} onClick={()=>setReceived(String(cart.getTotal()))} className="min-h-12 rounded-2xl border border-[#d4af37] bg-[#fff8dc] px-3 text-xs font-bold text-[#765b08] disabled:opacity-40">รับมาพอดี<br/>฿{cart.getTotal().toFixed(0)}</button></div>{received.trim()!==""&&Number.isFinite(cashDelta)&&<div className={"mt-3 flex items-center justify-between rounded-2xl border px-4 py-3 "+(cashDelta>=0?"border-emerald-300 bg-emerald-50 text-emerald-900":"border-red-300 bg-red-50 text-red-800")}><span>{cashDelta>=0?"เงินทอน":"ขาดอีก"}</span><b className="text-xl">฿{Math.abs(cashDelta).toFixed(0)}</b></div>}</>}
      {method==="promptpay"&&prompt?.qrUrl&&<div className="mt-4 rounded-[20px] border border-slate-300 bg-white p-4 text-center"><img src={prompt.qrUrl} alt="PromptPay QR" className="mx-auto max-h-56 w-auto"/><p className="mt-2 text-xs font-semibold text-black">{prompt.paid?"ชำระเงินแล้ว":"สแกน QR แล้วระบบจะตรวจสอบอัตโนมัติ"}</p></div>}
      <div className="sticky bottom-0 z-20 -mx-4 mt-4 border-t border-slate-200 bg-white/95 px-4 pb-[max(.25rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:-mx-6 sm:px-6"><button disabled={busy||!cart.items.length||(method==="cash"&&(!Number.isFinite(cashReceived)||cashReceived<cart.getTotal()))} onClick={checkout} className="w-full rounded-2xl bg-[#d4af37] py-3.5 font-bold text-black shadow-sm disabled:opacity-40">{busy?(method==="promptpay"&&prompt?"WAITING FOR PAYMENT...":"กำลังบันทึกบิล..."):(method==="promptpay"?"CREATE QR / PAY":"CONFIRM PAYMENT")}</button>{result&&<p className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-center text-sm text-slate-700">{result}</p>}</div>
    </div></div>}

    {lastSale&&<div className="fixed bottom-[92px] right-4 z-[70] w-[min(460px,calc(100vw-2rem))] rounded-[26px] border border-emerald-300 bg-white p-5 shadow-2xl md:bottom-6 md:right-6"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700"><CheckCircle2 size={22}/></div><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div><b className="text-lg">ชำระเงินสำเร็จ</b><p className="mt-1 text-sm text-slate-600">คิว {lastSale.queueNo}{lastSale.recovered?" · กู้คืนรายการเดิม":""}</p></div><button onClick={()=>setLastSale(null)}><X size={18}/></button></div><div className="mt-3 rounded-[20px] border-2 border-[#d4af37] bg-[#fff8dc] p-4 text-center"><div className="text-xs font-bold tracking-[.18em] text-[#765b08]">หยิบบัตรให้ลูกค้า</div><div className="mt-1 text-4xl font-black leading-none text-[#6f5510] md:text-5xl">บัตร {lastSale.pager||"—"}</div></div>{lastSale.payment==="cash"&&<div className="mt-3 flex items-center justify-between rounded-2xl bg-emerald-50 p-3"><span className="text-sm font-semibold text-emerald-800">เงินทอน</span><div className="text-2xl font-bold text-emerald-800">฿{lastSale.change.toFixed(0)}</div></div>}<button onClick={()=>router.push("/queue")} className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-slate-50 py-2.5 text-sm font-semibold">ไปคิวผลิต <ArrowRight size={16}/></button></div></div></div>}
  </section>;
}
