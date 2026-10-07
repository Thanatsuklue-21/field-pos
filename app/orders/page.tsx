"use client";

import {useEffect,useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import {Ban,Eye,Pencil,Printer,RotateCcw,Search,X} from "lucide-react";
import AuthGate from "@/components/auth-gate";
import SaleReceipt from "@/components/sale-receipt";
import {api,type Session} from "@/lib/api-client";
import {useCartStore} from "@/stores/cart-store"; import {writeRecovery} from "@/lib/recovery-storage";

type SaleItem={id:string;name:string;variant:string;qty:number;price:number};
type Sale={
  id:string;billNo:string;date:string;time:number;subtotal?:number;discountTotal?:number;crmDiscount?:number;pointsRedeemed?:number;pointsAwarded?:number;total:number;payment:string;paymentMethods?:string[];
  status:string;queueNo:string;itemCount:number;received?:number;change?:number;orderId?:string|null;
  orderStatus?:string|null;productionStarted?:boolean;items:SaleItem[];
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

  useEffect(()=>{load(true).catch(()=>{})},[]);
  const rows=useMemo(()=>sales.filter(x=>(x.billNo+" "+x.queueNo).toLowerCase().includes(q.toLowerCase())),[sales,q]);\n  const paidOrderGroup=(s:Sale)=>{const group=s.orderId?sales.filter(x=>x.orderId===s.orderId&&x.status==="paid"):[s];return group.length?group:[s]};

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
      ?"ยืนยัน Refund ทั้งออเดอร์ "+s.queueNo+" จำนวน "+refundable.length+" บิล รวม ฿"+refundTotal.toFixed(0)+" ? ระบบจะคืนทุก sale ในคิวนี้พร้อมกันและตัดสินการคืนสต็อกจากสถานะการผลิต"
      :"ยืนยัน Refund เต็มจำนวน ฿"+refundTotal.toFixed(0)+" ? ระบบจะตัดสินการคืนสต็อกจากสถานะการผลิต";
    if(!window.confirm(confirmText))return;
    setBusy(true);setMsg("");
    try{
      const r=await api<any>("/api/pos/refund",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({requestKey:crypto.randomUUID(),saleId:s.id,reason,manualConfirmed:external.length>0,manualReference})});
      setDetail(null);
      const count=Array.isArray(r.saleIds)?r.saleIds.length:1;
      setMsg((count>1?"Refund ทั้งออเดอร์ "+count+" บิลสำเร็จ":"Refund ถูกบันทึกแล้ว")+" · "+(r.stockRestored?"คืนสต็อกแล้วเพราะยังไม่เริ่มผลิต":"ไม่คืนสต็อกเพราะวัตถุดิบถูกใช้/ออเดอร์ดำเนินการแล้ว"));
      await load();
    }catch(e:any){
      setMsg(e.message==="refund_closed_day"?"วันนี้ถูก Close Day แล้ว ไม่อนุญาตให้แก้ย้อนหลัง":e.message==="promptpay_manual_refund_required"?"ต้องคืนเงินจริงส่วน PromptPay ภายนอกระบบก่อนยืนยัน":e.message==="external_manual_refund_required"?"ต้องคืนเงินจริงผ่านช่องทางภายนอกก่อนยืนยัน":e.message==="manual_refund_reference_required"?"ต้องกรอกเลขอ้างอิงการคืนเงิน":e.message==="refund_payment_not_supported"?"ช่องทางชำระเงินของบิลในออเดอร์นี้ยังไม่รองรับ Refund":e.message==="order_sale_missing"?"ข้อมูลบิลในออเดอร์ไม่ครบ ระบบจึงหยุดเพื่อป้องกันยอดบัญชีผิด":e.message==="use_void_before_production"?"บิลเงินสดเดี่ยวยังไม่เริ่มผลิต ให้ใช้ VOID เพื่อคืนสต็อกอัตโนมัติ":e.message);
    }finally{setBusy(false)}
  }

  async function voidCash(s:Sale,reasonInput?:string){
    const group=paidOrderGroup(s),wholeOrder=group.length>1;
    const reason=reasonInput??window.prompt(wholeOrder?"เหตุผลในการยกเลิกออเดอร์เงินสดทั้งหมด (ทำได้ก่อนเริ่มผลิตเท่านั้น)":"เหตุผลในการยกเลิกบิลเงินสด (ทำได้ก่อนเริ่มผลิตเท่านั้น)");
    if(reason===null)return false;
    setBusy(true);setMsg("");
    try{
      const r=await api<any>("/api/pos/void",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({requestKey:crypto.randomUUID(),saleId:s.id,reason})});
      setDetail(null);
      const count=Array.isArray(r.saleIds)?r.saleIds.length:1;
      setMsg((count>1?"ยกเลิกออเดอร์เงินสด "+count+" บิลสำเร็จ":"ยกเลิกบิลสำเร็จ")+" · คืน Stock แล้ว");
      await load();
      return true;
    }catch(e:any){
      setMsg(e.message==="void_after_production_started"?"เริ่มผลิตแล้ว ไม่สามารถยกเลิกและคืน Stock อัตโนมัติ":e.message==="non_cash_void_requires_refund"?"ออเดอร์นี้มีช่องทางที่ไม่ใช่เงินสด ต้องใช้ขั้นตอน Refund":e.message==="void_order_mixed_status"?"ออเดอร์นี้มีบางบิลถูกยกเลิก/คืนเงินไปแล้ว ระบบจึงหยุดเพื่อป้องกันยอดผิด":e.message==="order_sale_missing"?"ข้อมูลบิลในออเดอร์ไม่ครบ ระบบจึงหยุดเพื่อป้องกันยอดบัญชีผิด":e.message);
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
    const total=group.reduce((sum,x)=>sum+Number(x.total||0),0);
    if(!window.confirm("แก้ไข "+s.queueNo+" ?\n"+(group.length>1?"คิวนี้มี "+group.length+" บิล รวม ฿"+total.toFixed(0)+"\n":"")+"ระบบจะยกเลิกยอดเงินสดเดิมทั้งหมด คืน Stock และนำรายการทุกบิลกลับไปหน้า POS เพื่อให้เพิ่ม/ลด/เปลี่ยนเมนูแล้วคิดเงินใหม่"))return;
    const merged=new Map<string,SaleItem>();
    for(const item of allItems){
      const key=item.id+"::"+item.variant,old=merged.get(key);
      merged.set(key,old?{...old,qty:old.qty+item.qty}:{...item});
    }
    const ok=await voidCash(s,"ลูกค้าขอแก้ไขรายการก่อนเริ่มผลิต");
    if(!ok)return;
    cart.replaceItems([...merged.values()].map(i=>({key:i.id+"::"+i.variant,id:i.id,name:i.name,variant:i.variant,price:i.price,qty:i.qty})));
    writeRecovery("field-pos-edit-cash-v1",{heldCash:total,fromBill:group.map(x=>x.billNo).join(", "),fromQueue:s.queueNo,saleCount:group.length,createdAt:Date.now()});
    router.push("/pos");
  }

  return <section className="flex h-full flex-col p-3 sm:p-5 md:p-7">
    <header className="mb-3 sm:mb-5"><p className="gold m-0 text-[10px] font-bold tracking-[.3em]">TRANSACTIONS</p><h1 className="mt-1 text-xl font-semibold sm:text-2xl">รายการออเดอร์</h1><div className="mt-2 flex gap-2"><button onClick={()=>router.push("/pos")} className="min-h-11 rounded-xl bg-[#d4af37] px-4 text-sm font-bold">รับออเดอร์ใหม่</button>{(session.user.role==="admin"||session.user.permissions?.queue===true)&&<button onClick={()=>router.push("/queue")} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold">ไปคิวครัว</button>}</div></header>
    {msg&&<div className="mb-4 flex items-start justify-between gap-3 rounded-2xl border border-slate-300 bg-white p-3 text-sm"><span>{msg}</span><button onClick={()=>setMsg("")}><X size={16}/></button></div>}
    <div className="glass mb-3 flex items-center gap-2.5 rounded-full px-3 py-2.5 sm:mb-4 sm:gap-3 sm:px-4 sm:py-3"><Search size={18} className="text-slate-500"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="ค้นหาเลขบิล / เลขคิว" className="w-full bg-transparent outline-none"/></div>

    <div className="glass card soft-scroll min-h-0 flex-1 overflow-auto p-2">
      <table className="w-full min-w-[680px] text-sm">
        <thead className="sticky top-0 bg-slate-100 text-left text-[10px] uppercase tracking-widest text-slate-500"><tr><th className="p-4">Order</th><th>Date</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th></th></tr></thead>
        <tbody>{rows.map(x=><tr key={x.id} className={"border-t border-slate-200 "+(["void","refunded"].includes(x.status)?"opacity-45":"")}>
          <td className="p-4"><b>{x.queueNo||"—"}</b><small className="block text-slate-500">{x.billNo}</small></td>
          <td>{x.date}</td><td>{x.itemCount}</td><td className="gold">฿{x.total.toFixed(0)}</td>
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
        <div className="mt-4 space-y-2">{detail.items.map((i,n)=><div key={n} className="flex justify-between gap-3 rounded-2xl bg-slate-50 p-3"><span><b>{i.name}</b><small className="block text-slate-500">{i.variant} ×{i.qty} · ฿{i.price.toFixed(0)}/แก้ว</small></span><b className="shrink-0">฿{(i.price*i.qty).toFixed(0)}</b></div>)}</div>
        {Number(detail.discountTotal||0)>0&&<div className="mt-4 rounded-2xl bg-amber-50 p-3 text-sm"><div className="flex justify-between"><span>ยอดก่อนส่วนลด</span><b>฿{Number(detail.subtotal??detail.total).toFixed(0)}</b></div><div className="mt-1 flex justify-between text-amber-800"><span>ส่วนลดสมาชิก{detail.pointsRedeemed?" · "+detail.pointsRedeemed+" แต้ม":""}</span><b>−฿{Number(detail.discountTotal||0).toFixed(0)}</b></div></div>}<div className="mt-5 flex justify-between border-t border-slate-200 pt-4 text-lg"><b>ยอดสุทธิ</b><b className="gold">฿{detail.total.toFixed(0)}</b></div>{Number(detail.pointsAwarded||0)>0&&<p className="mt-2 text-right text-xs text-emerald-700">ได้รับ +{detail.pointsAwarded} แต้ม</p>}

        {session.user.role==="admin"&&detail.status==="paid"&&!paidOrderGroup(detail).some(x=>x.productionStarted)&&paidOrderGroup(detail).every(x=>x.payment==="cash")&&<button disabled={busy} onClick={()=>editCashOrder(detail)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#d4af37] py-3 text-sm font-black text-black disabled:opacity-50"><Pencil size={16}/>{busy?"กำลังบันทึก...":paidOrderGroup(detail).length>1?"แก้ไขทั้งออเดอร์ / รวมทุกบิล":"แก้ไข / ลด / เปลี่ยนเมนู"}</button>}
        {session.user.role==="admin"&&detail.status==="paid"&&paidOrderGroup(detail).every(x=>x.payment==="cash")&&<button disabled={busy} onClick={()=>voidCash(detail)} className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-red-400/30 py-3 text-sm font-semibold text-red-600 disabled:opacity-40"><Ban size={16}/>{paidOrderGroup(detail).length>1?"VOID CASH ORDER + RESTORE STOCK / ยกเลิกทั้งออเดอร์":"VOID CASH SALE + RESTORE STOCK / ยกเลิกบิลเงินสด"}</button>}
        {session.user.role==="admin"&&["cash","promptpay","bank","card","split"].includes(detail.payment)&&detail.status==="paid"&&<button disabled={busy} onClick={()=>refundSaleUi(detail)} className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-400/30 py-3 text-sm font-semibold text-amber-800 disabled:opacity-40"><RotateCcw size={16}/>{detail.orderId&&sales.filter(x=>x.orderId===detail.orderId&&x.status==="paid").length>1?"REFUND ORDER / คืนเงินทั้งออเดอร์":"FULL REFUND / คืนเงินเต็มจำนวน"}</button>}
        <button onClick={()=>window.print()} className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-300 py-3 text-sm font-semibold"><Printer size={16}/>พิมพ์ใบเสร็จ</button>
      </div>
    </div>}
  </section>;
}
