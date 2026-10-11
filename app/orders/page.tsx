"use client";
import {formatMoney} from "@/lib/money-format.mjs";

import {useEffect,useMemo,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {AlertTriangle,Ban,Eye,Pencil,Printer,RefreshCw,RotateCcw,Search,ShieldCheck,X} from "lucide-react";
import AuthGate from "@/components/auth-gate";
import SaleReceipt from "@/components/sale-receipt";
import {api,type Session} from "@/lib/api-client";
import {useCartStore} from "@/stores/cart-store"; import {writeRecovery} from "@/lib/recovery-storage";
import {ORDER_MUTATION_PENDING_KEY,orderMutationPath,shouldRetainOrderMutationPending,validateOrderMutationAck,validatePendingOrderMutation} from "@/lib/order-mutation-recovery.mjs";

type SaleItem={id:string;name:string;variant:string;qty:number;price:number};
type Sale={
  id:string;billNo:string;date:string;time:number;subtotal?:number;discountTotal?:number;crmDiscount?:number;pointsRedeemed?:number;pointsAwarded?:number;customerId?:string|null;total:number;payment:string;paymentMethods?:string[];
  status:string;queueNo:string;itemCount:number;received?:number;change?:number;orderId?:string|null;
  orderStatus?:string|null;productionStarted?:boolean;items:SaleItem[];
};
type ProviderEvidence={chargeId:string;provider?:string;status:string;paid?:boolean;amount?:number;currency?:string;referenceId?:string;expiresAt?:string|null;checkedAt?:number;failureCode?:string|null;failureMessage?:string|null;error?:string};
type ResolutionEvent={id:number;actorId?:string|null;actor:string;action:string;details:Record<string,unknown>;createdAt:number};
type PaymentResolution={
  id:string;status:string;mode?:string;total:number;date:string;pager:number;items:SaleItem[];remainingQty:number[];
  payments?:unknown[];providerManaged?:boolean;providerAttempt?:{state:string;provider:string;attemptKey:string;startedAt:number;updatedAt:number}|null;expiresAt?:number;targetOrderId?:string|null;providerCharge?:{chargeId:string;provider?:string;amount?:number;currency?:string;status?:string;expiresAt?:string|null;referenceId?:string};
type OrderMutationKind="void"|"refund";
type OrderMutationBody={requestKey:string;saleId:string;reason:string;manualConfirmed?:boolean;manualReference?:string};
type PendingOrderMutation={kind:OrderMutationKind;body:OrderMutationBody;createdAt:number};

function orderMutationPendingRead():PendingOrderMutation|null{
  let raw:string|null=null;
  try{raw=localStorage.getItem(ORDER_MUTATION_PENDING_KEY)}catch{throw new Error("order_mutation_recovery_storage_unavailable")}
  if(!raw)return null;
  try{return validatePendingOrderMutation(JSON.parse(raw)) as PendingOrderMutation}catch{throw new Error("order_mutation_recovery_corrupt")}
}
function orderMutationPendingWrite(kind:OrderMutationKind,body:OrderMutationBody){
  try{localStorage.setItem(ORDER_MUTATION_PENDING_KEY,JSON.stringify({kind,body,createdAt:Date.now()}))}
  catch{throw new Error("order_mutation_recovery_storage_unavailable")}
}
function orderMutationPendingClear(){
  try{localStorage.removeItem(ORDER_MUTATION_PENDING_KEY)}
  catch{throw new Error("order_mutation_recovery_storage_unavailable")}
}

  providerEvidence?:ProviderEvidence|null;timeline?:ResolutionEvent[];
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
  const [resolutions,setResolutions]=useState<PaymentResolution[]>([]);
  const [resolutionBusy,setResolutionBusy]=useState<string|null>(null);
  const [resolutionChargeIds,setResolutionChargeIds]=useState<Record<string,string>>({});
  const orderMutationRecoveryRef=useRef(false);

  async function loadResolutions(){
    if(session.user.role!=="admin"){setResolutions([]);return}
    const x=await api<{resolutions:PaymentResolution[]}>("/api/pos/payment-resolutions");
    setResolutions(Array.isArray(x.resolutions)?x.resolutions:[]);
  }

  async function load(openFromQuery=false){
    const x=await api<{sales:Sale[]}>("/api/pos/history");
    setSales(x.sales);
    if(session.user.role==="admin")loadResolutions().catch(e=>setMsg("โหลด Orders สำเร็จ แต่ Payment Resolution ตรวจ Provider ไม่สำเร็จ · "+String(e?.message||"server_error")));
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

  function orderMutationErrorText(code:string){
    return code==="order_mutation_pending"?"มี VOID/Refund เดิมที่ยังไม่ทราบผล · ระบบจะตรวจ request เดิมก่อน":
      code==="order_mutation_unconfirmed"?"Server ยังไม่ยืนยัน VOID/Refund เดิมครบถ้วน · ระบบเก็บ request เดิมไว้เพื่อป้องกันคืน Stock/CRM ซ้ำ":
      code==="order_mutation_recovery_corrupt"?"ข้อมูล recovery ของ VOID/Refund ในเครื่องเสีย · ห้ามทำรายการใหม่จนกว่าจะตรวจ Orders":
      code==="order_mutation_recovery_storage_unavailable"?"เครื่องนี้เก็บ recovery ของ VOID/Refund ไม่ได้ · ระบบไม่ส่งรายการเพื่อป้องกันทำซ้ำ":
      code;
  }

  async function sendOrderMutation(kind:OrderMutationKind,body:OrderMutationBody){
    let pending=orderMutationPendingRead();
    if(pending&&pending.body.requestKey!==body.requestKey)throw Object.assign(new Error("order_mutation_pending"),{status:409});
    if(!pending){orderMutationPendingWrite(kind,body);pending={kind,body,createdAt:Date.now()}}
    try{
      const r=await api<any>(orderMutationPath(pending.kind),{
        method:"POST",
        headers:{"X-CSRF-Token":session.csrf},
        body:JSON.stringify(pending.body)
      });
      validateOrderMutationAck(r,pending);
      orderMutationPendingClear();
      return r;
    }catch(e:any){
      if(!shouldRetainOrderMutationPending(e))orderMutationPendingClear();
      throw e;
    }
  }

  useEffect(()=>{
    load(true).catch(e=>setMsg(String(e?.message||"โหลดข้อมูลไม่สำเร็จ")));
    let disposed=false;
    const recover=async()=>{
      if(disposed||orderMutationRecoveryRef.current)return;
      let pending:PendingOrderMutation|null=null;
      try{pending=orderMutationPendingRead()}catch(e:any){if(!disposed)setMsg(orderMutationErrorText(e.message));return}
      if(!pending)return;
      orderMutationRecoveryRef.current=true;setBusy(true);setMsg("");
      try{
        const r=await sendOrderMutation(pending.kind,pending.body);
        if(!disposed){
          setDetail(null);
          const count=Array.isArray(r.saleIds)?r.saleIds.length:1;
          setMsg(pending.kind==="void"
            ?"กู้คืน VOID เดิมสำเร็จ · ใช้ request key เดิม · "+count+" บิล ไม่คืน Stock ซ้ำ"
            :"กู้คืน Refund เดิมสำเร็จ · ใช้ request key เดิม · "+count+" บิล ไม่ย้อน Stock/CRM ซ้ำ");
          await load();
        }
      }catch(e:any){
        if(!disposed){
          setMsg(shouldRetainOrderMutationPending(e)
            ?"VOID/Refund เดิมยังไม่ทราบผล · ระบบเก็บ request เดิมไว้และจะตรวจซ้ำเมื่อเชื่อมต่อ"
            :orderMutationErrorText(e.message));
          await load().catch(()=>{});
        }
      }finally{
        orderMutationRecoveryRef.current=false;
        if(!disposed)setBusy(false);
      }
    };
    const onOnline=()=>recover(),onFocus=()=>recover(),onVisible=()=>{if(document.visibilityState==="visible")recover()};
    recover();
    window.addEventListener("online",onOnline);
    window.addEventListener("focus",onFocus);
    document.addEventListener("visibilitychange",onVisible);
    return()=>{disposed=true;window.removeEventListener("online",onOnline);window.removeEventListener("focus",onFocus);document.removeEventListener("visibilitychange",onVisible)};
  },[]);
  const rows=useMemo(()=>sales.filter(x=>(x.billNo+" "+x.queueNo).toLowerCase().includes(q.toLowerCase())),[sales,q]);
  const paidOrderGroup=(s:Sale)=>{const group=s.orderId?sales.filter(x=>x.orderId===s.orderId&&x.status==="paid"):[s];return group.length?group:[s]};
  const cashVoidEligible=(s:Sale)=>{const group=paidOrderGroup(s);return s.status==="paid"&&group.every(x=>x.payment==="cash")&&!group.some(x=>x.productionStarted)};

  async function refreshResolutions(){
    setBusy(true);setMsg("");
    try{
      await loadResolutions();
      setMsg("ตรวจสถานะ Payment Resolution ล่าสุดแล้ว");
    }catch(e:any){setMsg("ตรวจรายการ Payment Resolution ไม่สำเร็จ · "+String(e?.message||"server_error"))}
    finally{setBusy(false)}
  }

  async function reconcileResolution(r:PaymentResolution){
    if(session.user.role!=="admin")return;
    const chargeId=String(r.providerCharge?.chargeId||r.providerEvidence?.chargeId||"");
    const manualChargeId=String(resolutionChargeIds[r.id]||"").trim();
    const recoverableAttempt=!chargeId&&r.providerAttempt?.state==="creating"&&r.providerAttempt?.provider==="beam";
    if(!chargeId&&!manualChargeId&&!recoverableAttempt){
      setMsg("รายการนี้ไม่มี provider charge ที่กู้คืนอัตโนมัติได้ · กรุณาใส่ Charge ID จาก Provider เพื่อให้ Server ตรวจสอบหลักฐานจริง");
      return;
    }
    if(!window.confirm(
      "ตรวจและแก้สถานะ PromptPay จาก Provider จริง?\n"+
      "Session: "+r.id+"\n"+
      "Charge: "+(chargeId||manualChargeId||"ยังไม่ bind · จะกู้ด้วย Beam idempotency เดิม")+"\n"+
      "ยอด: ฿"+formatMoney(r.total)+"\n\n"+
      "ระบบจะ Finalize เฉพาะเมื่อ Provider ยืนยันว่าจ่ายแล้ว หรือคืน Stock เฉพาะเมื่อ Provider ยืนยัน failed/expired/reversed"
    ))return;
    setResolutionBusy(r.id);setMsg("");
    try{
      const x=await api<any>("/api/pos/payment-resolutions/reconcile",{
        method:"POST",
        headers:{"X-CSRF-Token":session.csrf},
        body:JSON.stringify({sessionId:r.id,chargeId:manualChargeId||undefined})
      });
      const outcome=String(x.outcome||"");
      setMsg(outcome==="finalized"
        ?"ยืนยันเงินเข้าแล้ว · สร้างยอดขาย/คิวจาก charge เดิมสำเร็จ"
        :outcome==="released"
          ?"Provider ยืนยันรายการสิ้นสุดโดยไม่จ่าย · คืน Stock reservation แล้ว"
          :"Provider ยังไม่ยืนยันผลสุดท้าย · ระบบยังคงจอง Stock และไม่รับช่องทางอื่น");
      await load();
    }catch(e:any){
      setMsg(e.message==="promptpay_amount_mismatch"?"ยอดจาก Provider ไม่ตรงกับ reservation · ระบบหยุดเพื่อป้องกันบัญชีผิด":
        e.message==="promptpay_reference_mismatch"?"Charge จาก Provider ไม่ตรงกับ session · ระบบหยุดเพื่อป้องกันรับเงินผิดรายการ":
        e.message==="split_resolution_unavailable"?"รายการนี้ถูกแก้สถานะจากอุปกรณ์อื่นแล้ว · กำลังรีเฟรชข้อมูล":
        e.message==="promptpay_recovery_window_elapsed"?"attempt สร้าง QR ค้างเกินช่วง recovery อัตโนมัติ · ต้องตรวจ Provider ด้วยหลักฐานภายนอก":
        e.message==="promptpay_provider_changed"?"Provider ปัจจุบันไม่ตรงกับ attempt เดิม · ระบบหยุดเพื่อป้องกันสร้าง QR ซ้ำ":
        "Reconcile ไม่สำเร็จ · "+String(e.message||"server_error"));
      await loadResolutions().catch(()=>{});
    }finally{setResolutionBusy(null)}
  }

  async function cancelAbandonedCollecting(r:PaymentResolution){
    if(session.user.role!=="admin")return;
    const safe=r.status==="collecting"&&r.providerManaged!==true&&r.mode!=="promptpay_full"&&(r.payments?.length||0)===0&&!r.providerCharge?.chargeId;
    if(!safe){
      setMsg("รายการนี้ไม่เข้าเงื่อนไขยกเลิกแบบคืน Stock อัตโนมัติ · ต้องใช้ flow ตามสถานะ Payment จริง");
      return;
    }
    if(!window.confirm(
      "ยกเลิก Split session ที่ยังไม่มีการรับเงิน?\n"+
      "Session: "+r.id+"\nยอดที่จอง: ฿"+formatMoney(r.total)+"\n\n"+
      "ระบบจะคืน Stock reservation จาก session นี้เพียงครั้งเดียว และจะไม่ใช้กับ PromptPay/provider-managed session"
    ))return;
    setResolutionBusy(r.id);setMsg("");
    try{
      await api<any>("/api/pos/split/cancel",{
        method:"POST",
        headers:{"X-CSRF-Token":session.csrf},
        body:JSON.stringify({requestKey:crypto.randomUUID(),sessionId:r.id})
      });
      setMsg("ยกเลิก collecting split ที่ยังไม่มีการรับเงินแล้ว · คืน Stock reservation สำเร็จ");
      await loadResolutions();
    }catch(e:any){
      setMsg(e.message==="split_session_provider_managed"
        ?"รายการนี้ถูกผูกกับ Provider แล้ว · ห้ามยกเลิกด้วยวิธีคืน Stock ทั่วไป"
        :e.message==="split_session_has_payments"
          ?"รายการนี้มีการรับเงินบางส่วนแล้ว · ต้องใช้ขั้นตอน Resolution"
          :"ยกเลิก session ไม่สำเร็จ · "+String(e.message||"server_error"));
      await loadResolutions().catch(()=>{});
    }finally{setResolutionBusy(null)}
  }

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
    const confirmText=refundable.length>1
      ?"ยืนยัน Refund ทั้งออเดอร์ "+s.queueNo+" จำนวน "+refundable.length+" บิล รวม ฿"+formatMoney(refundTotal)+" ? ระบบจะคืนทุก sale ในคิวนี้พร้อมกันและตัดสินการคืนสต็อกจากสถานะการผลิต"
      :"ยืนยัน Refund เต็มจำนวน ฿"+formatMoney(refundTotal)+" ? ระบบจะตัดสินการคืนสต็อกจากสถานะการผลิต";
    if(!window.confirm(confirmText))return;
    setBusy(true);setMsg("");
    try{
      const body:OrderMutationBody={requestKey:crypto.randomUUID(),saleId:s.id,reason:reason.trim(),manualConfirmed:external.length>0,manualReference:manualReference.trim()};
      const r=await sendOrderMutation("refund",body);
      setDetail(null);
      const count=Array.isArray(r.saleIds)?r.saleIds.length:1;
      setMsg((count>1?"Refund ทั้งออเดอร์ "+count+" บิลสำเร็จ":"Refund ถูกบันทึกแล้ว")+" · "+(r.stockRestored?"คืนสต็อกแล้วเพราะยังไม่เริ่มผลิต":"ไม่คืนสต็อกเพราะวัตถุดิบถูกใช้/ออเดอร์ดำเนินการแล้ว"));
      await load();
    }catch(e:any){
      setMsg(e.message==="refund_closed_day"?"วันนี้ถูก Close Day แล้ว ไม่อนุญาตให้แก้ย้อนหลัง":e.message==="promptpay_manual_refund_required"?"ต้องคืนเงินจริงส่วน PromptPay ภายนอกระบบก่อนยืนยัน":e.message==="external_manual_refund_required"?"ต้องคืนเงินจริงผ่านช่องทางภายนอกก่อนยืนยัน":e.message==="manual_refund_reference_required"?"ต้องกรอกเลขอ้างอิงการคืนเงิน":e.message==="refund_payment_not_supported"?"ช่องทางชำระเงินของบิลในออเดอร์นี้ยังไม่รองรับ Refund":e.message==="order_sale_missing"?"ข้อมูลบิลในออเดอร์ไม่ครบ ระบบจึงหยุดเพื่อป้องกันยอดบัญชีผิด":e.message==="use_void_before_production"?"บิลเงินสดเดี่ยวยังไม่เริ่มผลิต ให้ใช้ VOID เพื่อคืนสต็อกอัตโนมัติ":orderMutationErrorText(e.message));
    }finally{setBusy(false)}
  }

  async function voidCash(s:Sale,reasonInput?:string){
    const group=paidOrderGroup(s),wholeOrder=group.length>1;
    const reason=reasonInput??window.prompt(wholeOrder?"เหตุผลในการยกเลิกออเดอร์เงินสดทั้งหมด (ทำได้ก่อนเริ่มผลิตเท่านั้น)":"เหตุผลในการยกเลิกบิลเงินสด (ทำได้ก่อนเริ่มผลิตเท่านั้น)");
    if(reason===null)return false;
    setBusy(true);setMsg("");
    try{
      const body:OrderMutationBody={requestKey:crypto.randomUUID(),saleId:s.id,reason:reason.trim()};
      const r=await sendOrderMutation("void",body);
      setDetail(null);
      const count=Array.isArray(r.saleIds)?r.saleIds.length:1;
      setMsg((count>1?"ยกเลิกออเดอร์เงินสด "+count+" บิลสำเร็จ":"ยกเลิกบิลสำเร็จ")+" · คืน Stock แล้ว");
      await load();
      return true;
    }catch(e:any){
      setMsg(e.message==="void_after_production_started"?"เริ่มผลิตแล้ว ไม่สามารถยกเลิกและคืน Stock อัตโนมัติ":e.message==="non_cash_void_requires_refund"?"ออเดอร์นี้มีช่องทางที่ไม่ใช่เงินสด ต้องใช้ขั้นตอน Refund":e.message==="void_order_mixed_status"?"ออเดอร์นี้มีบางบิลถูกยกเลิก/คืนเงินไปแล้ว ระบบจึงหยุดเพื่อป้องกันยอดผิด":e.message==="order_sale_missing"?"ข้อมูลบิลในออเดอร์ไม่ครบ ระบบจึงหยุดเพื่อป้องกันยอดบัญชีผิด":orderMutationErrorText(e.message));
      return false;
    }finally{setBusy(false)}
  }

  async function editCashOrder(s:Sale){
    const group=paidOrderGroup(s);
    if(s.status!=="paid"||group.some(x=>x.payment!=="cash")){
      setMsg("แก้ไขอัตโนมัติได้เฉพาะออเดอร์ที่ทุกบิลชำระเป็นเงินสด · ช่องทางอื่นให้ใช้ Refund ตามสถานะจริง");
      return;
    }
    if(group.some(x=>x.productionStarted)){
      setMsg("ออเดอร์นี้เริ่มผลิตแล้ว จึงไม่สามารถแก้รายการแบบคืน Stock อัตโนมัติได้ · หากลูกค้าเปลี่ยนใจให้ใช้ Refund ตามสถานะจริง");
      return;
    }
    const allItems=group.flatMap(x=>x.items||[]);
    if(!allItems.length||allItems.some(i=>!i.id)){
      setMsg("ข้อมูลเมนูของออเดอร์นี้ไม่ครบ จึงไม่สามารถโหลดกลับไปแก้ไขอัตโนมัติได้");
      return;
    }
    const customerKeys=[...new Set(group.map(x=>String(x.customerId||"")))];
    if(customerKeys.length>1){
      setMsg("ออเดอร์นี้มีหลายบิลที่ผูกลูกค้าต่างกัน ระบบจะไม่รวมแก้ไขอัตโนมัติเพื่อป้องกันแต้ม/ประวัติลูกค้าผิด");
      return;
    }
    const total=group.reduce((sum,x)=>sum+Number(x.total||0),0);
    const originalPointsRedeemed=group.reduce((sum,x)=>sum+Number(x.pointsRedeemed||0),0);
    const customerId=customerKeys[0]||null;
    if(!window.confirm("แก้ไข "+s.queueNo+" ?\n"+(group.length>1?"คิวนี้มี "+group.length+" บิล รวม ฿"+formatMoney(total)+"\n":"")+"ระบบจะยกเลิกยอดเงินสดเดิมทั้งหมด คืน Stock และนำรายการทุกบิลกลับไปหน้า POS เพื่อให้เพิ่ม/ลด/เปลี่ยนเมนูแล้วคิดเงินใหม่"))return;
    const merged=new Map<string,SaleItem>();
    for(const item of allItems){
      const key=item.id+"::"+item.variant,old=merged.get(key);
      merged.set(key,old?{...old,qty:old.qty+item.qty}:{...item});
    }
    const ok=await voidCash(s,"ลูกค้าขอแก้ไขรายการก่อนเริ่มผลิต");
    if(!ok)return;
    cart.replaceItems([...merged.values()].map(i=>({key:i.id+"::"+i.variant,id:i.id,name:i.name,variant:i.variant,price:i.price,qty:i.qty})));
    writeRecovery("field-pos-edit-cash-v1",{heldCash:total,fromBill:group.map(x=>x.billNo).join(", "),fromQueue:s.queueNo,saleCount:group.length,customerId,pointsRedeemed:originalPointsRedeemed,createdAt:Date.now()});
    router.push("/pos");
  }

  return <section className="flex h-full flex-col p-3 sm:p-5 md:p-7">
    <header className="mb-3 sm:mb-5"><p className="gold m-0 text-[10px] font-bold tracking-[.3em]">TRANSACTIONS</p><h1 className="mt-1 text-xl font-semibold sm:text-2xl">รายการออเดอร์</h1><div className="mt-2 flex gap-2"><button onClick={()=>router.push("/pos")} className="min-h-11 rounded-xl bg-[#d4af37] px-4 text-sm font-bold">รับออเดอร์ใหม่</button>{(session.user.role==="admin"||session.user.permissions?.queue===true)&&<button onClick={()=>router.push("/queue")} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold">ไปคิวครัว</button>}</div></header>
    {msg&&<div className="mb-4 flex items-start justify-between gap-3 rounded-2xl border border-slate-300 bg-white p-3 text-sm"><span>{msg}</span><button onClick={()=>setMsg("")}><X size={16}/></button></div>}

    {session.user.role==="admin"&&<div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 shrink-0 text-amber-700" size={19}/>
          <div>
            <h2 className="m-0 text-sm font-black text-amber-950">Payment Resolution Console</h2>
            <p className="mt-1 text-xs text-amber-800">รายการที่ผลการชำระยังต้องตรวจ Provider ก่อนสร้างยอดขายหรือคืน Stock · Admin เท่านั้น</p>
          </div>
        </div>
        <button disabled={busy||!!resolutionBusy} onClick={refreshResolutions} className="flex min-h-11 items-center gap-2 rounded-xl border border-amber-300 bg-white px-3 text-xs font-bold text-amber-900 disabled:opacity-40"><RefreshCw size={15}/>ตรวจสถานะใหม่</button>
      </div>
      {resolutions.length===0
        ?<div className="mt-3 flex items-center gap-2 rounded-xl bg-white/70 p-3 text-xs text-emerald-800"><ShieldCheck size={16}/>ไม่มีรายการ Payment ที่ต้อง Resolution</div>
        :<div className="mt-3 space-y-2">{resolutions.map(r=>{
          const ev=r.providerEvidence;
          const charge=String(r.providerCharge?.chargeId||ev?.chargeId||"");
          const providerStatus=String(ev?.status||r.providerCharge?.status||"unknown");
          const amount=Number(ev?.amount??r.providerCharge?.amount??r.total);
          const amountMismatch=Number.isFinite(amount)&&Math.abs(amount-Number(r.total))>0.009;
          const refMismatch=!!ev?.referenceId&&ev.referenceId!==r.id;
          return <div key={r.id} className="rounded-xl border border-amber-200 bg-white p-3 text-xs">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <b className="text-slate-900">{r.id}</b>
                <div className="mt-1 text-slate-500">{r.date} · Pager {r.pager||"—"} · ฿{formatMoney(r.total)}</div>
              </div>
              <span className={"rounded-full px-2 py-1 text-[10px] font-black "+(ev?.paid?"bg-emerald-100 text-emerald-800":providerStatus==="provider_check_failed"?"bg-red-100 text-red-800":"bg-amber-100 text-amber-900")}>{providerStatus.toUpperCase()}</span>
            </div>
            <div className="mt-2 grid gap-1 text-slate-600 sm:grid-cols-2">
              <div>Provider: <b>{ev?.provider||r.providerCharge?.provider||r.providerAttempt?.provider||"—"}</b></div>
              <div>Charge: <b className="break-all">{charge||"—"}</b></div>
              {r.providerAttempt?.state==="creating"&&!charge&&<div className="sm:col-span-2 rounded bg-amber-50 p-2 font-semibold text-amber-800">พบ provider creation attempt ที่ยังไม่ bind charge · Admin reconcile จะกู้ด้วย idempotency key เดิมเฉพาะ Beam และช่วงเวลาที่ปลอดภัย</div>}
              <div>Provider amount: <b>{Number.isFinite(amount)?("฿"+formatMoney(amount)):"—"}</b></div>
              <div>Currency: <b>{ev?.currency||r.providerCharge?.currency||"—"}</b></div>
              <div>Reference: <b className="break-all">{ev?.referenceId||r.providerCharge?.referenceId||"—"}</b></div>
              <div>ตรวจล่าสุด: <b>{ev?.checkedAt?new Date(ev.checkedAt).toLocaleTimeString("th-TH"):"—"}</b></div>
            </div>
            <div className="mt-2 text-slate-600">จองสินค้า: {r.items.map((i,n)=>i.name+" ×"+Number(r.remainingQty?.[n]??i.qty)).join(" · ")}</div>
            {Array.isArray(r.timeline)&&r.timeline.length>0&&<details className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
              <summary className="cursor-pointer font-bold text-slate-700">Audit timeline · {r.timeline.length} เหตุการณ์ล่าสุด</summary>
              <div className="mt-2 space-y-2">{r.timeline.map(event=><div key={event.id} className="rounded-lg bg-white p-2">
                <div className="flex flex-wrap items-center justify-between gap-2"><b className="text-slate-800">{event.action}</b><span className="text-[10px] text-slate-500">{event.createdAt?new Date(event.createdAt).toLocaleString("th-TH"):"—"}</span></div>
                <div className="mt-1 text-[10px] text-slate-500">โดย {event.actor||"system"}</div>
                <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-100 p-2 text-[10px] text-slate-600">{JSON.stringify(event.details,null,2)}</pre>
              </div>)}</div>
            </details>}
            {(amountMismatch||refMismatch||ev?.error)&&<div className="mt-2 rounded-lg bg-red-50 p-2 font-semibold text-red-700">{amountMismatch?"ยอด Provider ไม่ตรงกับ Reservation · ":""}{refMismatch?"Reference ไม่ตรงกับ Session · ":""}{ev?.error?"ตรวจ Provider ไม่สำเร็จ: "+ev.error:""}</div>}
            {r.status==="requires_resolution"&&!charge&&<label className="mt-3 block rounded-lg border border-slate-200 bg-slate-50 p-2">
              <span className="text-[10px] font-bold text-slate-600">Charge ID จาก Provider (ใช้เมื่อกู้คืนอัตโนมัติไม่ได้)</span>
              <input value={resolutionChargeIds[r.id]||""} onChange={e=>setResolutionChargeIds(prev=>({...prev,[r.id]:e.target.value}))} placeholder="ch_... / chrg_..." className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs"/>
              <span className="mt-1 block text-[10px] text-slate-500">Server จะดึงข้อมูลจาก Provider และตรวจ Session / ยอด / THB ก่อนทุกครั้ง ไม่ใช้สถานะที่พิมพ์เอง</span>
            </label>}
            {r.status==="requires_resolution"
              ?<button disabled={resolutionBusy===r.id||amountMismatch||refMismatch||providerStatus==="provider_check_failed"} onClick={()=>reconcileResolution(r)} className="mt-3 min-h-11 w-full rounded-xl bg-slate-900 px-4 font-bold text-white disabled:opacity-35">{resolutionBusy===r.id?"กำลังตรวจและแก้สถานะ...":"ตรวจ Provider และ Reconcile อย่างปลอดภัย"}</button>
              :r.providerManaged!==true&&r.mode!=="promptpay_full"&&(r.payments?.length||0)===0&&!r.providerCharge?.chargeId
                ?<button disabled={resolutionBusy===r.id} onClick={()=>cancelAbandonedCollecting(r)} className="mt-3 min-h-11 w-full rounded-xl border border-red-300 bg-red-50 px-4 font-bold text-red-800 disabled:opacity-35">{resolutionBusy===r.id?"กำลังยกเลิก...":"ยกเลิก Split ที่ยังไม่รับเงิน · คืน Stock"}</button>
                :<div className="mt-3 rounded-xl bg-blue-50 p-3 font-semibold text-blue-800">รายการยังอยู่สถานะ collecting · แสดงหลักฐานแบบ read-only เท่านั้น การเปลี่ยนสถานะต้องมาจากผล Provider และ flow ฝั่ง Server</div>}
          </div>
        })}</div>}
    </div>}

    <div className="glass mb-3 flex items-center gap-2.5 rounded-full px-3 py-2.5 sm:mb-4 sm:gap-3 sm:px-4 sm:py-3"><Search size={18} className="text-slate-500"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="ค้นหาเลขบิล / เลขคิว" className="w-full bg-transparent outline-none"/></div>

    <div className="glass card soft-scroll min-h-0 flex-1 overflow-auto p-2">
      <table className="w-full min-w-[680px] text-sm">
        <thead className="sticky top-0 bg-slate-100 text-left text-[10px] uppercase tracking-widest text-slate-500"><tr><th className="p-4">Order</th><th>Date</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th></th></tr></thead>
        <tbody>{rows.map(x=><tr key={x.id} className={"border-t border-slate-200 "+(["void","refunded"].includes(x.status)?"opacity-45":"")}>
          <td className="p-4"><b>{x.queueNo||"—"}</b><small className="block text-slate-500">{x.billNo}</small></td>
          <td>{x.date}</td><td>{x.itemCount}</td><td className="gold">฿{formatMoney(x.total)}</td>
          <td className="uppercase text-slate-600">{x.payment}{x.payment==="split"&&x.paymentMethods?.length?<small className="block text-[10px] normal-case text-slate-500">{x.paymentMethods.join(" + ")}</small>:null}</td>
          <td className="uppercase text-slate-500">{x.status}</td>
          <td><button onClick={()=>setDetail(x)} className="grid h-9 w-9 place-items-center rounded-full border border-slate-200"><Eye size={16}/></button></td>
        </tr>)}</tbody>
      </table>
    </div>

    {detail&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={()=>setDetail(null)}>
      <div onClick={e=>e.stopPropagation()} className="glass card soft-scroll max-h-[90vh] w-full max-w-lg overflow-auto p-4 sm:p-6">
        <SaleReceipt sale={detail}/>
        <div className="flex items-start justify-between gap-3"><div><p className="gold text-[10px] tracking-[.25em]">{detail.billNo}</p><h3 className="mt-1 text-xl">{detail.queueNo}</h3></div><button onClick={()=>setDetail(null)}><X/></button></div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-slate-100 px-3 py-1 uppercase">{detail.status}</span>{detail.productionStarted?<span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">เริ่มผลิตแล้ว</span>:detail.status==="paid"?<span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">ยังแก้ก่อนผลิตได้</span>:null}</div>
        <div className="mt-4 space-y-2">{detail.items.map((i,n)=><div key={n} className="flex justify-between gap-3 rounded-2xl bg-slate-50 p-3"><span><b>{i.name}</b><small className="block text-slate-500">{i.variant} ×{i.qty} · ฿{formatMoney(i.price)}/แก้ว</small></span><b className="shrink-0">฿{formatMoney((i.price*i.qty))}</b></div>)}</div>
        {Number(detail.discountTotal||0)>0&&<div className="mt-4 rounded-2xl bg-amber-50 p-3 text-sm"><div className="flex justify-between"><span>ยอดก่อนส่วนลด</span><b>฿{formatMoney(Number(detail.subtotal??detail.total))}</b></div><div className="mt-1 flex justify-between text-amber-800"><span>ส่วนลดสมาชิก{detail.pointsRedeemed?" · "+detail.pointsRedeemed+" แต้ม":""}</span><b>−฿{formatMoney(Number(detail.discountTotal||0))}</b></div></div>}<div className="mt-5 flex justify-between border-t border-slate-200 pt-4 text-lg"><b>ยอดสุทธิ</b><b className="gold">฿{formatMoney(detail.total)}</b></div>{Number(detail.pointsAwarded||0)>0&&<p className="mt-2 text-right text-xs text-emerald-700">ได้รับ +{detail.pointsAwarded} แต้ม</p>}

        {session.user.role==="admin"&&cashVoidEligible(detail)&&<button disabled={busy} onClick={()=>editCashOrder(detail)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#d4af37] py-3 text-sm font-black text-black disabled:opacity-50"><Pencil size={16}/>{busy?"กำลังบันทึก...":paidOrderGroup(detail).length>1?"แก้ไขทั้งออเดอร์ / รวมทุกบิล":"แก้ไข / ลด / เปลี่ยนเมนู"}</button>}
        {session.user.role==="admin"&&cashVoidEligible(detail)&&<button disabled={busy} onClick={()=>voidCash(detail)} className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-red-400/30 py-3 text-sm font-semibold text-red-600 disabled:opacity-40"><Ban size={16}/>{paidOrderGroup(detail).length>1?"VOID CASH ORDER + RESTORE STOCK / ยกเลิกทั้งออเดอร์":"VOID CASH SALE + RESTORE STOCK / ยกเลิกบิลเงินสด"}</button>}
        {session.user.role==="admin"&&["cash","promptpay","bank","card","split"].includes(detail.payment)&&detail.status==="paid"&&!cashVoidEligible(detail)&&<button disabled={busy} onClick={()=>refundSaleUi(detail)} className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-400/30 py-3 text-sm font-semibold text-amber-800 disabled:opacity-40"><RotateCcw size={16}/>{detail.orderId&&sales.filter(x=>x.orderId===detail.orderId&&x.status==="paid").length>1?"REFUND ORDER / คืนเงินทั้งออเดอร์":"FULL REFUND / คืนเงินเต็มจำนวน"}</button>}
        <button onClick={()=>window.print()} className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-300 py-3 text-sm font-semibold"><Printer size={16}/>พิมพ์ใบเสร็จ</button>
      </div>
    </div>}
  </section>;
}
