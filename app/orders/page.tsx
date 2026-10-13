"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {AlertTriangle,Ban,Eye,Pencil,Printer,RefreshCw,RotateCcw,Search,ShieldCheck,X} from "lucide-react";
import AuthGate from "@/components/auth-gate";
import SaleReceipt from "@/components/sale-receipt";
import {api,type Session} from "@/lib/api-client";
import {operatorErrorFallback} from "@/lib/operator-error-language.mjs";
import {useCartStore} from "@/stores/cart-store";
import {prepareOrderMutationIntent,readOrderMutationIntent,sendOrderMutationIntent,type OrderMutationIntent,type OrderMutationOperation} from "@/lib/order-mutation-recovery";

type SaleItem={id:string;name:string;variant:string;qty:number;price:number};
type Sale={
  id:string;billNo:string;date:string;time:number;subtotal?:number;discountTotal?:number;crmDiscount?:number;pointsRedeemed?:number;pointsAwarded?:number;total:number;payment:string;paymentMethods?:string[];
  status:string;queueNo:string;itemCount:number;received?:number;change?:number;orderId?:string|null;
  orderStatus?:string|null;productionStarted?:boolean;items:SaleItem[];
};
type RecoveryPayment={id:string;label?:string;method:string;amount:number;received:number;change:number;allocations:{index:number;qty:number}[]};
type RecoverySession={
  id:string;status:"collecting"|"requires_resolution";mode:"split"|"promptpay_full";total:number;remainingAmount:number;date:string;pager:number;expiresAt:number;
  createdAt:number;updatedAt:number;resolutionRequiredAt?:number|null;resolvedAt?:number|null;resolvedBy?:string|null;
  items:SaleItem[];remainingQty:number[];payments:RecoveryPayment[];targetOrderId?:string|null;
};

export default function Orders(){return <AuthGate>{s=><OrdersView session={s}/>}</AuthGate>}

function OrdersView({session}:{session:Session}){
  const router=useRouter();
  const cart=useCartStore();
  const [sales,setSales]=useState<Sale[]>([]);
  const [q,setQ]=useState("");
  const [detail,setDetail]=useState<Sale|null>(null);
  const [msg,setMsg]=useState("");
  const [busy,setBusy]=useState(false);
  const [recoverySessions,setRecoverySessions]=useState<RecoverySession[]>([]);
  const [recoveryDetail,setRecoveryDetail]=useState<RecoverySession|null>(null);
  const [recoveryMethod,setRecoveryMethod]=useState<"cash"|"bank"|"card">("cash");
  const [recoveryReceived,setRecoveryReceived]=useState("");
  const [recoveryReference,setRecoveryReference]=useState("");
  const [recoveryConfirmed,setRecoveryConfirmed]=useState(false);
  const [pendingOrderMutation,setPendingOrderMutation]=useState<OrderMutationIntent|null>(null),[orderMutationRecoveryBlocked,setOrderMutationRecoveryBlocked]=useState(false);
  const orderMutationRecoveryRef=useRef(false);

  async function load(openFromQuery=false){
    const x=await api<{sales:Sale[]}>("/api/pos/history");
    setSales(x.sales);
    if(detail){
      const latest=x.sales.find(s=>s.id===detail.id);
      if(latest)setDetail(latest);
    }
    if(openFromQuery&&typeof window!=="undefined"){
      const queue=new URLSearchParams(window.location.search).get("queue")||"";
      if(queue){
        setQ(queue);
        const hit=x.sales.find(s=>s.queueNo===queue);
        if(hit)setDetail(hit);
      }
    }
  }

  async function loadRecovery(){
    if(session.user.role!=="admin")return;
    const x=await api<{sessions:RecoverySession[]}>("/api/pos/split/list");
    const next=x.sessions||[];
    setRecoverySessions(next);
    if(recoveryDetail){
      const latest=next.find(s=>s.id===recoveryDetail.id);
      if(latest)setRecoveryDetail(latest);else setRecoveryDetail(null);
    }
  }

  useEffect(()=>{load(true).catch(()=>{});loadRecovery().catch(()=>{})},[]);

  function orderMutationError(code:string){
    const map:Record<string,string>={
      order_mutation_recovery_unavailable:"อ่านข้อมูลการยกเลิก/คืนเงินที่ค้างไม่ได้ · ระบบปิดรายการใหม่ชั่วคราวเพื่อป้องกันเงินหรือสต็อกซ้ำ",
      pending_order_mutation_exists:"มีการยกเลิก/คืนเงินเดิมที่ยังไม่ทราบผล · ต้องตรวจรายการเดิมก่อน ห้ามสร้างรายการใหม่",
      order_mutation_ack_unknown:"ระบบกลางยังยืนยันผลการยกเลิก/คืนเงินเดิมไม่ครบ · ระบบเก็บรายการเดิมไว้และจะตรวจซ้ำ",
      network_unavailable:"เน็ตขาดการเชื่อมต่อ · ยังไม่ทราบว่าการยกเลิก/คืนเงินสำเร็จหรือไม่ ระบบเก็บรายการเดิมไว้ ห้ามทำรายการใหม่แทน",
      request_key_conflict:"ข้อมูลรายการเดิมไม่ตรงกัน · ระบบหยุดไว้เพื่อป้องกันทำซ้ำ กรุณาตรวจประวัติเดิมก่อน",
      refund_closed_day:"วันนี้ปิดยอดแล้ว · ไม่อนุญาตให้แก้ย้อนหลังจากหน้านี้",
      promptpay_manual_refund_required:"ต้องคืนเงินจริงส่วน PromptPay ภายนอกระบบก่อนยืนยัน",
      external_manual_refund_required:"ต้องคืนเงินจริงผ่านช่องทางภายนอกก่อนยืนยัน",
      manual_refund_reference_required:"ต้องกรอกเลขอ้างอิงการคืนเงิน",
      refund_payment_not_supported:"ช่องทางชำระเงินของบิลนี้ยังไม่รองรับการคืนเงินอัตโนมัติ",
      order_sale_missing:"ข้อมูลบิลในออเดอร์ไม่ครบ ระบบจึงหยุดเพื่อป้องกันยอดบัญชีผิด",
      use_void_before_production:"บิลเงินสดนี้ยังไม่เริ่มผลิต · ใช้ “ยกเลิกบิล” เพื่อคืนสต็อกอัตโนมัติ",
      void_after_production_started:"เริ่มผลิตแล้ว · ไม่สามารถยกเลิกบิลพร้อมคืนสต็อกอัตโนมัติ",
      non_cash_void_requires_refund:"บิลนี้ไม่ใช่เงินสด · ต้องใช้ขั้นตอนคืนเงิน",
      void_multi_sale_order_not_supported:"ออเดอร์นี้มีหลายบิลหรือมีรายการเพิ่ม · ต้องตรวจและคืนเงินตามบิลจริง",
      sale_already_void:"บิลนี้ถูกยกเลิกไปแล้ว · กรุณาตรวจประวัติก่อนทำต่อ",
      sale_already_refunded:"บิลนี้ถูกคืนเงินไปแล้ว · กรุณาตรวจประวัติก่อนทำต่อ",
      sale_not_voidable:"สถานะบิลนี้ไม่อนุญาตให้ยกเลิกบิล",
      sale_not_refundable:"สถานะบิลนี้ไม่อนุญาตให้คืนเงิน",
      sale_not_found:"ไม่พบบิลที่ต้องการ · ระบบยังไม่ได้สร้างการยกเลิกหรือคืนเงินใหม่"
    };
    return map[code]||operatorErrorFallback(code,"การแก้ไขบิล");
  }
  function mutationNotCommitted(operation:OrderMutationOperation){
    return new Set(operation==="void"?[
      "invalid_request_key","sale_required","sale_not_found","sale_already_void","sale_not_voidable","void_closed_day",
      "non_cash_void_requires_refund","order_not_found","void_multi_sale_order_not_supported","void_after_production_started",
      "ingredient_missing","high_risk_confirmation_required","high_risk_reason_required"
    ]:[
      "invalid_request_key","sale_required","sale_not_found","sale_already_refunded","sale_not_refundable","order_not_found",
      "order_sale_missing","refund_closed_day","refund_payment_not_supported","use_void_before_production",
      "promptpay_manual_refund_required","external_manual_refund_required","manual_refund_reference_required",
      "ingredient_missing","high_risk_confirmation_required","high_risk_reason_required"
    ]);
  }
  async function submitOrderMutation(intent:OrderMutationIntent,recovery=false){
    setBusy(true);setMsg("");
    try{
      const endpoint=intent.operation==="void"?"/api/pos/void":"/api/pos/refund";
      const result=await sendOrderMutationIntent(intent,body=>api<any>(endpoint,{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)}),mutationNotCommitted(intent.operation));
      setPendingOrderMutation(null);setOrderMutationRecoveryBlocked(false);setDetail(null);
      if(intent.operation==="void")setMsg((recovery?"ตรวจรายการเดิมสำเร็จ · ":"")+"ยกเลิกบิลสำเร็จ · ระบบกลางยืนยันแล้ว และคืนสต็อกตามเงื่อนไข");
      else{
        const count=Array.isArray(result.saleIds)?result.saleIds.length:1;
        setMsg((recovery?"ตรวจรายการเดิมสำเร็จ · ":"")+(count>1?"คืนเงินทั้งออเดอร์ "+count+" บิลสำเร็จ":"บันทึกการคืนเงินแล้ว")+" · "+(result.stockRestored?"คืนสต็อกแล้วเพราะยังไม่เริ่มผลิต":"ไม่คืนสต็อก เพราะวัตถุดิบถูกใช้หรือเริ่มดำเนินออเดอร์แล้ว"));
      }
      await load();
      return result;
    }catch(e:any){
      try{
        const current=readOrderMutationIntent(session.user.id);
        setPendingOrderMutation(current);
        setMsg(current?orderMutationError(e.message):orderMutationError(e.message));
      }catch{
        setOrderMutationRecoveryBlocked(true);setMsg(orderMutationError("order_mutation_recovery_unavailable"));
      }
      await load().catch(()=>{});
      return null;
    }finally{setBusy(false)}
  }

  useEffect(()=>{
    let disposed=false,recovering=false;
    const recover=async()=>{
      if(disposed||recovering||orderMutationRecoveryRef.current)return;
      let intent:OrderMutationIntent|null=null;
      try{intent=readOrderMutationIntent(session.user.id);if(!disposed)setOrderMutationRecoveryBlocked(false)}
      catch{if(!disposed){setOrderMutationRecoveryBlocked(true);setMsg(orderMutationError("order_mutation_recovery_unavailable"))}return}
      if(!disposed)setPendingOrderMutation(intent);
      if(!intent)return;
      if(typeof navigator!=="undefined"&&!navigator.onLine){if(!disposed)setMsg("มีการยกเลิก/คืนเงินเดิมรอตรวจ · ตอนเน็ตหลุดระบบจะไม่สร้างรายการใหม่");return}
      recovering=true;orderMutationRecoveryRef.current=true;
      try{await submitOrderMutation(intent,true)}
      finally{recovering=false;orderMutationRecoveryRef.current=false}
    };
    const onOnline=()=>recover().catch(()=>{}),onFocus=()=>recover().catch(()=>{}),onVisible=()=>{if(document.visibilityState==="visible")recover().catch(()=>{})};
    recover().catch(()=>{});
    window.addEventListener("online",onOnline);window.addEventListener("focus",onFocus);document.addEventListener("visibilitychange",onVisible);
    return()=>{disposed=true;window.removeEventListener("online",onOnline);window.removeEventListener("focus",onFocus);document.removeEventListener("visibilitychange",onVisible)};
  },[session.user.id,session.csrf]);

  const rows=useMemo(()=>sales.filter(x=>(x.billNo+" "+x.queueNo).toLowerCase().includes(q.toLowerCase())),[sales,q]);

  async function refundSaleUi(s:Sale){
    const group=s.orderId?sales.filter(x=>x.orderId===s.orderId&&x.status==="paid"):[s];
    const refundable=group.length?group:[s];
    const methods=[...new Set(refundable.flatMap(x=>x.payment==="split"?(x.paymentMethods||[]):[x.payment]))],external=methods.filter(m=>["promptpay","bank","card"].includes(m));
    const refundTotal=refundable.reduce((sum,x)=>sum+Number(x.total||0),0);
    let manualReference="";
    if(external.length){
      if(!window.confirm((external.includes("promptpay")?"ออเดอร์นี้มี PromptPay":"ออเดอร์นี้มีช่องทางรับเงินภายนอก")+" ("+external.join(", ")+") โปรดยืนยันว่าคุณได้คืนเงินจริงให้ลูกค้าภายนอกระบบแล้ว"))return;
      manualReference=window.prompt("เลขอ้างอิงการคืนเงิน / หมายเหตุ")||"";
      if(!manualReference.trim())return;
    }
    const reason=window.prompt(refundable.length>1?"เหตุผลในการ Refund ทั้งออเดอร์":"เหตุผลในการ Refund เต็มจำนวน")||"";
    if(reason.trim().length<2){setMsg("การคืนเงินต้องระบุเหตุผล เพื่อให้ตรวจสอบย้อนหลังได้");return}
    const confirmText=refundable.length>1
      ?"ยืนยัน Refund ทั้งออเดอร์ "+s.queueNo+" จำนวน "+refundable.length+" บิล รวม ฿"+refundTotal.toFixed(0)+" ? ระบบจะคืนทุก sale ในคิวนี้พร้อมกันและตัดสินการคืนสต็อกจากสถานะการผลิต"
      :"ยืนยัน Refund เต็มจำนวน ฿"+refundTotal.toFixed(0)+" ? ระบบจะตัดสินการคืนสต็อกจากสถานะการผลิต";
    if(!window.confirm(confirmText))return;
    if(orderMutationRecoveryBlocked){setMsg(orderMutationError("order_mutation_recovery_unavailable"));return}
    if(pendingOrderMutation){setMsg(orderMutationError("pending_order_mutation_exists"));return}
    try{
      const body={requestKey:crypto.randomUUID(),saleId:s.id,reason,riskConfirmed:true as const,manualConfirmed:external.length>0,manualReference};
      const intent=prepareOrderMutationIntent(session.user.id,"refund",s.date,body);
      setPendingOrderMutation(intent);
      await submitOrderMutation(intent,false);
    }catch(e:any){
      setMsg(orderMutationError(e.message));
      if(e.message==="order_mutation_recovery_unavailable")setOrderMutationRecoveryBlocked(true);
    }
  }

  async function voidCash(s:Sale,reasonInput?:string){
    const reason=reasonInput??window.prompt("เหตุผลในการยกเลิกบิลเงินสด (ทำได้ก่อนเริ่มผลิตเท่านั้น)");
    if(reason===null)return false;
    if(reason.trim().length<2){setMsg("การยกเลิกบิลต้องระบุเหตุผล เพื่อให้ตรวจสอบย้อนหลังได้");return false}
    if(reasonInput===undefined&&!window.confirm("ยืนยัน VOID บิลนี้? ระบบจะบันทึกผู้ทำ เหตุผล และคืน สต็อก ตามเงื่อนไข"))return false;
    if(orderMutationRecoveryBlocked){setMsg(orderMutationError("order_mutation_recovery_unavailable"));return false}
    if(pendingOrderMutation){setMsg(orderMutationError("pending_order_mutation_exists"));return false}
    try{
      const body={requestKey:crypto.randomUUID(),saleId:s.id,reason,riskConfirmed:true as const};
      const intent=prepareOrderMutationIntent(session.user.id,"void",s.date,body);
      setPendingOrderMutation(intent);
      return !!(await submitOrderMutation(intent,false));
    }catch(e:any){
      setMsg(orderMutationError(e.message));
      if(e.message==="order_mutation_recovery_unavailable")setOrderMutationRecoveryBlocked(true);
      return false;
    }
  }

  async function editCashOrder(s:Sale){
    if(s.payment!=="cash"||s.status!=="paid")return;
    if(s.productionStarted){
      setMsg("ออเดอร์นี้เริ่มผลิตแล้ว จึงไม่สามารถแก้รายการแบบคืน สต็อก อัตโนมัติได้ · หากลูกค้าเปลี่ยนใจให้ใช้ Refund ตามสถานะจริง");
      return;
    }
    if(!s.items.length||s.items.some(i=>!i.id)){
      setMsg("ข้อมูลเมนูของบิลนี้ไม่ครบ จึงไม่สามารถโหลดกลับไปแก้ไขอัตโนมัติได้");
      return;
    }
    if(!window.confirm("แก้ไข "+s.queueNo+" ?\nระบบจะยกเลิกบิลเดิม คืน สต็อก และนำรายการทั้งหมดกลับไปหน้า POS เพื่อให้เพิ่ม/ลด/เปลี่ยนเมนูแล้วคิดเงินใหม่"))return;
    const ok=await voidCash(s,"ลูกค้าขอแก้ไขรายการก่อนเริ่มผลิต");
    if(!ok)return;
    cart.replaceItems(s.items.map(i=>({key:i.id+"::"+i.variant,id:i.id,name:i.name,variant:i.variant,price:i.price,qty:i.qty})));
    try{sessionStorage.setItem("field-pos-edit-cash-v1",JSON.stringify({heldCash:s.total,fromBill:s.billNo,fromQueue:s.queueNo}))}catch{}
    router.push("/pos");
  }

  function openRecovery(s:RecoverySession){
    setRecoveryDetail(s);setRecoveryMethod("cash");setRecoveryReceived("");setRecoveryReference("");setRecoveryConfirmed(false);setMsg("");
  }

  async function resolveRecovery(s:RecoverySession){
    if(s.mode!=="split"||s.status!=="requires_resolution"||!s.payments.length||!recoveryConfirmed)return;
    setBusy(true);setMsg("");
    try{
      const r=await api<any>("/api/pos/split/resolve",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({requestKey:crypto.randomUUID(),sessionId:s.id})});
      setRecoveryDetail(r.session);setRecoveryConfirmed(false);
      setMsg("เปิดรายการรับเงินค้างแล้ว · เงินที่รับก่อนหน้ายังคงเดิมและสต็อกยังถูกจอง · กรุณารับเฉพาะยอดคงเหลือ");
      await loadRecovery();
    }catch(e:any){
      setMsg(e.message==="split_resolution_unavailable"?"สถานะการรับเงินเปลี่ยนแล้ว · ระบบหยุดเพื่อป้องกันรับเงินซ้ำ กรุณารีเฟรช":operatorErrorFallback(e.message,"รายการรับเงินค้าง"));
      await loadRecovery().catch(()=>{});
    }finally{setBusy(false)}
  }

  async function finishRecovery(s:RecoverySession){
    if(s.mode!=="split"||s.status!=="collecting"||!s.resolvedAt||!s.payments.length||!recoveryConfirmed)return;
    const allocations=(s.remainingQty||[]).map((qty,index)=>({index,qty:Number(qty)||0})).filter(x=>x.qty>0);
    const amount=Number(s.remainingAmount)||0;
    const received=recoveryMethod==="cash"?Number(recoveryReceived):amount;
    if(!allocations.length||amount<=0){setMsg("ไม่พบยอดคงเหลือที่ต้องรับ กรุณารีเฟรชสถานะ");return}
    if(recoveryMethod==="cash"&&(!Number.isFinite(received)||received<amount)){setMsg("เงินสดที่รับต้องไม่น้อยกว่ายอดคงเหลือ ฿"+amount.toFixed(0));return}
    setBusy(true);setMsg("");
    try{
      const r=await api<any>("/api/pos/split/pay",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({
        requestKey:crypto.randomUUID(),sessionId:s.id,method:recoveryMethod,received,allocations,
        paymentReference:recoveryMethod==="cash"?undefined:(recoveryReference.trim()||undefined),
        label:"Owner recovery"
      })});
      if(!r.completed)throw new Error("recovery_not_completed");
      setRecoveryDetail(null);setRecoveryConfirmed(false);setRecoveryReceived("");setRecoveryReference("");
      setMsg("จัดการรายการรับเงินค้างสำเร็จ · บันทึกยอดคงเหลือและสร้างออเดอร์แล้ว · ประวัติการรับเงินเดิมยังอยู่ครบ");
      await Promise.all([load(),loadRecovery()]);
    }catch(e:any){
      const map:Record<string,string>={
        split_session_unavailable:"รายการรับเงินนี้ถูกดำเนินการจากอีกเครื่องแล้ว · ระบบไม่รับเงินซ้ำ กรุณารีเฟรช",
        split_session_expired:"Session หมดอายุระหว่างทำรายการ · กรุณากู้คืนใหม่",
        cash_insufficient:"เงินสดที่รับไม่พอยอดคงเหลือ",
        target_order_unavailable:"คิวปลายทางเปลี่ยนสถานะแล้ว ระบบหยุดเพื่อป้องกันการผูกยอดผิด",
        day_closed:"วันนี้ปิดวันแล้ว ไม่อนุญาตให้รับยอดเพิ่ม",
        recovery_not_completed:"ระบบยังปิด Payment ไม่ครบ จึงไม่ถือว่ารายการสำเร็จ"
      };
      setMsg(map[e.message]||operatorErrorFallback(e.message,"รายการรับเงินค้าง"));await loadRecovery().catch(()=>{});
    }finally{setBusy(false)}
  }

  return <section className="flex h-full flex-col p-3 sm:p-5 md:p-7">
    <header className="mb-3 sm:mb-5"><p className="gold m-0 text-[10px] font-bold tracking-[.3em]">TRANSACTIONS</p><h1 className="mt-1 text-xl font-semibold sm:text-2xl">รายการออเดอร์</h1><div className="mt-2 flex gap-2"><button onClick={()=>router.push("/pos")} className="min-h-11 rounded-xl bg-[#d4af37] px-4 text-sm font-bold">รับออเดอร์ใหม่</button>{(session.user.role==="admin"||session.user.permissions?.queue===true)&&<button onClick={()=>router.push("/queue")} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold">ไปคิวครัว</button>}</div></header>
    {pendingOrderMutation&&<div className="mb-4 rounded-2xl border-2 border-red-300 bg-red-50 p-3 text-sm text-red-950"><b>มี {pendingOrderMutation.operation==="void"?"การยกเลิกบิล":"การคืนเงิน"} เดิมที่ยังไม่ทราบผล</b><p className="mt-1 text-xs">บิล {pendingOrderMutation.body.saleId} · ระบบล็อกรายการใหม่และจะตรวจข้อมูลเดิมเท่านั้น เพื่อป้องกันเงินหรือสต็อกซ้ำ</p><button disabled={busy} onClick={()=>submitOrderMutation(pendingOrderMutation,true)} className="mt-2 min-h-11 rounded-xl bg-red-800 px-4 text-xs font-bold text-white disabled:opacity-40">ตรวจรายการเดิม</button></div>}
    {orderMutationRecoveryBlocked&&<div className="mb-4 rounded-2xl border-2 border-red-400 bg-red-50 p-3 text-sm text-red-950"><b>อ่านข้อมูลการยกเลิก/คืนเงินที่ค้างไม่ได้</b><p className="mt-1 text-xs">ระบบปิดการยกเลิก/คืนเงินใหม่ชั่วคราว เพื่อป้องกันเงิน สต็อก หรือประวัติซ้ำ · ให้เจ้าของร้านตรวจพื้นที่เก็บข้อมูลของเครื่องแล้วเปิดหน้านี้ใหม่</p></div>}
    {msg&&<div className="mb-4 flex items-start justify-between gap-3 rounded-2xl border border-slate-300 bg-white p-3 text-sm"><span>{msg}</span><button onClick={()=>setMsg("")}><X size={16}/></button></div>}
    {session.user.role==="admin"&&recoverySessions.length>0&&<div className="mb-3 rounded-2xl border border-amber-300 bg-amber-50 p-3 sm:mb-4 sm:p-4"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-800"><AlertTriangle size={18}/></span><div><b className="text-sm text-amber-950">รายการรับเงินค้าง · {recoverySessions.length} รายการ</b><p className="mt-1 text-xs text-amber-800">มี รายการรับเงิน ที่ยังไม่จบ · รายการเหล่านี้อาจจอง สต็อก และบล็อก Close Day</p></div></div><button disabled={busy} onClick={()=>loadRecovery().catch(e=>setMsg(e.message))} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-amber-300 bg-white disabled:opacity-40" aria-label="รีเฟรช รายการรับเงินค้าง"><RefreshCw size={16}/></button></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{recoverySessions.map(s=>{const paid=s.payments.reduce((n,p)=>n+Number(p.amount||0),0);return <button key={s.id} onClick={()=>openRecovery(s)} className={"rounded-xl border p-3 text-left "+(s.status==="requires_resolution"?"border-red-200 bg-white":"border-amber-200 bg-white/80")}><div className="flex items-center justify-between gap-2"><b className="text-sm">฿{Number(s.remainingAmount||0).toFixed(0)} คงเหลือ</b><span className={"rounded-full px-2 py-1 text-[9px] font-black uppercase "+(s.status==="requires_resolution"?"bg-red-100 text-red-700":"bg-amber-100 text-amber-800")}>{s.status==="requires_resolution"?"ต้องกู้คืน":"กำลังรับชำระ"}</span></div><p className="mt-1 text-[11px] text-slate-500">{s.date} · รับแล้ว ฿{paid.toFixed(0)} · {s.items.reduce((n,x)=>n+x.qty,0)} แก้ว</p></button>})}</div></div>}
    <div className="glass mb-3 flex items-center gap-2.5 rounded-full px-3 py-2.5 sm:mb-4 sm:gap-3 sm:px-4 sm:py-3"><Search size={18} className="text-slate-500"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="ค้นหาเลขบิล / เลขคิว" className="w-full bg-transparent outline-none"/></div>

    <div className="glass card soft-scroll min-h-0 flex-1 overflow-auto p-2">
      <div className="space-y-2 sm:hidden">{rows.map(x=><button key={x.id} onClick={()=>setDetail(x)} className={"w-full rounded-2xl border border-slate-200 bg-white p-3 text-left "+(["void","refunded"].includes(x.status)?"opacity-50":"")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><div className="flex items-center gap-2"><b className="text-base">{x.queueNo||"—"}</b><span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-bold uppercase text-slate-500">{x.status}</span></div><small className="mt-1 block truncate text-slate-500">{x.billNo} · {x.date}</small></div>
          <div className="shrink-0 text-right"><b className="text-lg text-[#765b08]">฿{x.total.toFixed(0)}</b><span className="mt-1 grid h-11 w-11 place-items-center rounded-xl border border-slate-200"><Eye size={16}/></span></div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs text-slate-600"><span>{x.itemCount} รายการ</span><span className="uppercase">{x.payment}{x.payment==="split"&&x.paymentMethods?.length?" · "+x.paymentMethods.join("+"):""}</span></div>
      </button>)}</div>
      <div className="hidden sm:block"><table className="w-full min-w-[680px] text-sm">
        <thead className="sticky top-0 bg-slate-100 text-left text-[10px] uppercase tracking-widest text-slate-500"><tr><th className="p-4">Order</th><th>Date</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th></th></tr></thead>
        <tbody>{rows.map(x=><tr key={x.id} className={"border-t border-slate-200 "+(["void","refunded"].includes(x.status)?"opacity-45":"")}>
          <td className="p-4"><b>{x.queueNo||"—"}</b><small className="block text-slate-500">{x.billNo}</small></td>
          <td>{x.date}</td><td>{x.itemCount}</td><td className="gold">฿{x.total.toFixed(0)}</td>
          <td className="uppercase text-slate-600">{x.payment}{x.payment==="split"&&x.paymentMethods?.length?<small className="block text-[10px] normal-case text-slate-500">{x.paymentMethods.join(" + ")}</small>:null}</td>
          <td className="uppercase text-slate-500">{x.status}</td>
          <td><button onClick={()=>setDetail(x)} className="grid h-11 w-11 place-items-center rounded-full border border-slate-200"><Eye size={16}/></button></td>
        </tr>)}</tbody>
      </table></div>
    </div>

    {recoveryDetail&&<div className="fixed inset-0 z-[70] grid place-items-end bg-black/55 p-0 sm:place-items-center sm:p-4" onClick={()=>{if(!busy)setRecoveryDetail(null)}}><div role="dialog" aria-modal="true" aria-labelledby="payment-recovery-title" onClick={e=>e.stopPropagation()} className="soft-scroll max-h-[94dvh] w-full max-w-lg overflow-auto rounded-t-[28px] bg-white p-4 shadow-2xl sm:rounded-[28px] sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="m-0 text-[10px] font-black tracking-[.2em] text-amber-700">OWNER PAYMENT RECOVERY</p><h2 id="payment-recovery-title" className="mt-1 text-xl font-bold">กู้รายการรับชำระ</h2><p className="mt-1 text-xs text-slate-500">{recoveryDetail.id.slice(0,18)}… · {recoveryDetail.date}</p></div><button disabled={busy} onClick={()=>setRecoveryDetail(null)} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 disabled:opacity-40" aria-label="ปิด รายการรับเงินค้าง"><X size={18}/></button></div>{(()=>{const paid=recoveryDetail.payments.reduce((n,p)=>n+Number(p.amount||0),0),remaining=Number(recoveryDetail.remainingAmount||0),isPrompt=recoveryDetail.mode==="promptpay_full",canResolve=!isPrompt&&recoveryDetail.status==="requires_resolution"&&recoveryDetail.payments.length>0,canFinish=!isPrompt&&recoveryDetail.status==="collecting"&&!!recoveryDetail.resolvedAt&&recoveryDetail.payments.length>0;return <><div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-2xl bg-slate-50 p-3"><small className="text-slate-500">ยอดทั้งหมด</small><b className="mt-1 block">฿{Number(recoveryDetail.total||0).toFixed(0)}</b></div><div className="rounded-2xl bg-emerald-50 p-3"><small className="text-emerald-700">รับแล้ว</small><b className="mt-1 block text-emerald-800">฿{paid.toFixed(0)}</b></div><div className="rounded-2xl bg-amber-50 p-3"><small className="text-amber-700">คงเหลือ</small><b className="mt-1 block text-amber-900">฿{remaining.toFixed(0)}</b></div></div><div className="mt-4 rounded-2xl border border-slate-200 p-3"><b className="text-sm">รายการที่ยังจอง สต็อก</b><div className="mt-2 space-y-2">{recoveryDetail.items.map((item,index)=>{const qty=Number(recoveryDetail.remainingQty?.[index]||0);return <div key={index} className="flex items-center justify-between gap-3 text-sm"><span className={qty<=0?"text-slate-400 line-through":"text-slate-700"}>{item.name} · {item.variant}</span><b>{qty>0?"เหลือ ×"+qty:"รับเงินแล้ว"}</b></div>})}</div></div>{recoveryDetail.payments.length>0&&<div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3"><b className="text-sm text-emerald-900">เงินที่ระบบบันทึกแล้ว — ห้ามรับซ้ำ</b>{recoveryDetail.payments.map((p,i)=><div key={p.id||i} className="mt-2 flex justify-between text-xs text-emerald-800"><span>{p.label||"Payment "+(i+1)} · {p.method}</span><b>฿{Number(p.amount||0).toFixed(0)}</b></div>)}</div>}{isPrompt&&<div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><b>PromptPay protected</b><p className="mt-1 text-xs">ไม่อนุญาตให้ Owner เปลี่ยนรายการนี้เป็นเงินสด/โอน/บัตรจากหน้ากู้คืน เพื่อป้องกันรับเงินซ้ำกับ Payment Provider</p></div>}{canResolve&&<><label className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm"><input type="checkbox" checked={recoveryConfirmed} onChange={e=>setRecoveryConfirmed(e.target.checked)} className="mt-1 h-4 w-4"/><span><b>ฉันตรวจยอดที่รับไปแล้ว ฿{paid.toFixed(0)}</b><br/><span className="text-xs text-slate-600">กู้ session โดยไม่คืน สต็อก และไม่ลบ Payment เดิม จากนั้นจะรับเฉพาะยอดคงเหลือ ฿{remaining.toFixed(0)}</span></span></label><button disabled={busy||!recoveryConfirmed} onClick={()=>resolveRecovery(recoveryDetail)} className="mt-3 min-h-12 w-full rounded-2xl bg-amber-600 font-bold text-white disabled:opacity-40">{busy?"กำลังกู้คืน...":"กู้ session เพื่อรับยอดคงเหลือ"}</button></>}{canFinish&&<><div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800"><ShieldCheck size={16} className="mb-1"/><b>Session ผ่าน Owner Recovery แล้ว</b><p className="mt-1">ระบบจะส่งเฉพาะรายการ/จำนวนที่ยังเหลือให้ Server ตรวจอีกครั้งก่อนบันทึกเงินจริง</p></div><div className="mt-3 grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1">{(["cash","bank","card"] as const).map(m=><button key={m} onClick={()=>{setRecoveryMethod(m);setRecoveryReceived("");setRecoveryReference("")}} className={"min-h-11 rounded-xl text-xs font-bold "+(recoveryMethod===m?"bg-white shadow-sm":"text-slate-600")}>{m==="cash"?"เงินสด":m==="bank"?"โอน":"บัตร"}</button>)}</div>{recoveryMethod==="cash"?<label className="mt-3 block text-sm"><span className="font-semibold text-slate-700">รับเงินสด</span><input inputMode="decimal" value={recoveryReceived} onChange={e=>setRecoveryReceived(e.target.value)} placeholder={"อย่างน้อย "+remaining.toFixed(0)} className="mt-2 min-h-12 w-full rounded-2xl border border-slate-300 px-4 text-lg"/></label>:<label className="mt-3 block text-sm"><span className="font-semibold text-slate-700">เลขอ้างอิง / หมายเหตุ (ถ้ามี)</span><input value={recoveryReference} onChange={e=>setRecoveryReference(e.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-slate-300 px-4"/></label>}<label className="mt-3 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><input type="checkbox" checked={recoveryConfirmed} onChange={e=>setRecoveryConfirmed(e.target.checked)} className="mt-1 h-4 w-4"/><span>ยืนยันว่า <b>จะรับเฉพาะยอดคงเหลือ ฿{remaining.toFixed(0)}</b> และเงิน ฿{paid.toFixed(0)} ที่ระบบบันทึกไว้ก่อนหน้าไม่ได้รับซ้ำ</span></label><button disabled={busy||!recoveryConfirmed||(recoveryMethod==="cash"&&Number(recoveryReceived)<remaining)} onClick={()=>finishRecovery(recoveryDetail)} className="mt-3 min-h-12 w-full rounded-2xl bg-emerald-700 font-bold text-white disabled:opacity-40">{busy?"กำลังบันทึก...":"รับยอดคงเหลือและจบ Payment"}</button></>}{recoveryDetail.status==="collecting"&&!recoveryDetail.resolvedAt&&<div className="mt-3 rounded-2xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">Session นี้ยัง active และไม่ได้ผ่าน Owner Recovery · ระบบไม่เปิดปุ่มรับเงินจากหน้านี้เพื่อกันชนกับ POS เครื่องอื่น</div>}</>})()}</div></div>}

    {detail&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={()=>setDetail(null)}>
      <div onClick={e=>e.stopPropagation()} className="glass card soft-scroll max-h-[90vh] w-full max-w-lg overflow-auto p-4 sm:p-6">
        <SaleReceipt sale={detail}/>
        <div className="flex items-start justify-between gap-3"><div><p className="gold text-[10px] tracking-[.25em]">{detail.billNo}</p><h3 className="mt-1 text-xl">{detail.queueNo}</h3></div><button onClick={()=>setDetail(null)} className="grid h-11 w-11 place-items-center rounded-xl" aria-label="ปิดรายละเอียด"><X/></button></div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-slate-100 px-3 py-1 uppercase">{detail.status}</span>{detail.productionStarted?<span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">เริ่มผลิตแล้ว</span>:detail.status==="paid"?<span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">ยังแก้ก่อนผลิตได้</span>:null}</div>
        <div className="mt-4 space-y-2">{detail.items.map((i,n)=><div key={n} className="flex justify-between gap-3 rounded-2xl bg-slate-50 p-3"><span><b>{i.name}</b><small className="block text-slate-500">{i.variant} ×{i.qty} · ฿{i.price.toFixed(0)}/แก้ว</small></span><b className="shrink-0">฿{(i.price*i.qty).toFixed(0)}</b></div>)}</div>
        {Number(detail.discountTotal||0)>0&&<div className="mt-4 rounded-2xl bg-amber-50 p-3 text-sm"><div className="flex justify-between"><span>ยอดก่อนส่วนลด</span><b>฿{Number(detail.subtotal??detail.total).toFixed(0)}</b></div><div className="mt-1 flex justify-between text-amber-800"><span>ส่วนลดสมาชิก{detail.pointsRedeemed?" · "+detail.pointsRedeemed+" แต้ม":""}</span><b>−฿{Number(detail.discountTotal||0).toFixed(0)}</b></div></div>}<div className="mt-5 flex justify-between border-t border-slate-200 pt-4 text-lg"><b>ยอดสุทธิ</b><b className="gold">฿{detail.total.toFixed(0)}</b></div>{Number(detail.pointsAwarded||0)>0&&<p className="mt-2 text-right text-xs text-emerald-700">ได้รับ +{detail.pointsAwarded} แต้ม</p>}

        {session.user.role==="admin"&&detail.payment==="cash"&&detail.status==="paid"&&!detail.productionStarted&&<button disabled={busy} onClick={()=>editCashOrder(detail)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#d4af37] py-3 text-sm font-black text-black disabled:opacity-50"><Pencil size={16}/>{busy?"กำลังบันทึก...":"แก้ไข / ลด / เปลี่ยนเมนู"}</button>}
        {session.user.role==="admin"&&detail.payment==="cash"&&detail.status==="paid"&&<button disabled={busy} onClick={()=>voidCash(detail)} className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-red-400/30 py-3 text-sm font-semibold text-red-600 disabled:opacity-40"><Ban size={16}/>ยกเลิกบิลเงินสด + คืนสต็อก</button>}
        {session.user.role==="admin"&&["cash","promptpay","bank","card","split"].includes(detail.payment)&&detail.status==="paid"&&<button disabled={busy} onClick={()=>refundSaleUi(detail)} className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-400/30 py-3 text-sm font-semibold text-amber-800 disabled:opacity-40"><RotateCcw size={16}/>{detail.orderId&&sales.filter(x=>x.orderId===detail.orderId&&x.status==="paid").length>1?"คืนเงินทั้งออเดอร์":"คืนเงินเต็มจำนวน"}</button>}
        <button onClick={()=>window.print()} className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-300 py-3 text-sm font-semibold"><Printer size={16}/>พิมพ์ใบเสร็จ</button>
      </div>
    </div>}
  </section>;
}
