"use client";

import {useEffect,useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import {Ban,Eye,Pencil,Printer,RotateCcw,Search,X} from "lucide-react";
import AuthGate from "@/components/auth-gate";
import SaleReceipt from "@/components/sale-receipt";
import {api,type Session} from "@/lib/api-client";
import {useCartStore} from "@/stores/cart-store";

type SaleItem={id:string;name:string;variant:string;qty:number;price:number};
type Sale={
  id:string;billNo:string;date:string;time:number;total:number;payment:string;paymentMethods?:string[];
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
  const rows=useMemo(()=>sales.filter(x=>(x.billNo+" "+x.queueNo).toLowerCase().includes(q.toLowerCase())),[sales,q]);

  async function refundSaleUi(s:Sale){
    const methods=s.payment==="split"?(s.paymentMethods||[]):[s.payment],hasPromptPay=methods.includes("promptpay");
    let manualReference="";
    if(hasPromptPay){
      if(!window.confirm("บิลนี้มี PromptPay โปรดยืนยันว่าคุณได้คืนเงินจริงส่วน PromptPay ให้ลูกค้าผ่านช่องทางภายนอกแล้ว"))return;
      manualReference=window.prompt("เลขอ้างอิงการคืนเงิน PromptPay / หมายเหตุ")||"";
      if(!manualReference.trim())return;
    }
    const reason=window.prompt("เหตุผลในการ Refund เต็มจำนวน")||"";
    if(!window.confirm("ยืนยัน Refund เต็มจำนวน ฿"+s.total.toFixed(0)+" ? ระบบจะตัดสินการคืนสต็อกจากสถานะการผลิต"))return;
    setBusy(true);setMsg("");
    try{
      const r=await api<any>("/api/pos/refund",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({requestKey:crypto.randomUUID(),saleId:s.id,reason,manualConfirmed:hasPromptPay,manualReference})});
      setDetail(null);
      setMsg("Refund ถูกบันทึกแล้ว · "+(r.stockRestored?"คืนสต็อกแล้วเพราะยังไม่เริ่มผลิต":"ไม่คืนสต็อกเพราะวัตถุดิบถูกใช้/ออเดอร์ดำเนินการแล้ว"));
      await load();
    }catch(e:any){
      setMsg(e.message==="refund_closed_day"?"วันนี้ถูก Close Day แล้ว ไม่อนุญาตให้แก้ย้อนหลัง":e.message==="promptpay_manual_refund_required"?"ต้องคืนเงินจริงส่วน PromptPay ภายนอกระบบก่อนยืนยัน":e.message==="manual_refund_reference_required"?"ต้องกรอกเลขอ้างอิงการคืนเงิน PromptPay":e.message==="refund_multi_sale_order_not_supported"?"ออเดอร์นี้มีหลาย sale ยังไม่รองรับ Refund อัตโนมัติ":e.message==="refund_payment_not_supported"?"ช่องทางชำระเงินของบิลนี้ยังไม่รองรับ Refund":e.message==="use_void_before_production"?"บิลเงินสดยังไม่เริ่มผลิต ให้ใช้ VOID เพื่อคืนสต็อกอัตโนมัติ":e.message);
    }finally{setBusy(false)}
  }

  async function voidCash(s:Sale,reasonInput?:string){
    const reason=reasonInput??window.prompt("เหตุผลในการยกเลิกบิลเงินสด (ทำได้ก่อนเริ่มผลิตเท่านั้น)");
    if(reason===null)return false;
    setBusy(true);setMsg("");
    try{
      await api("/api/pos/void",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({requestKey:crypto.randomUUID(),saleId:s.id,reason})});
      setDetail(null);
      setMsg("ยกเลิกบิลสำเร็จ · คืน Stock แล้ว");
      await load();
      return true;
    }catch(e:any){
      setMsg(e.message==="void_after_production_started"?"เริ่มผลิตแล้ว ไม่สามารถยกเลิกและคืน Stock อัตโนมัติ":e.message==="non_cash_void_requires_refund"?"บิลไม่ใช่เงินสด ต้องใช้ขั้นตอน Refund":e.message==="void_multi_sale_order_not_supported"?"ออเดอร์นี้มีหลายบิล/รายการเพิ่ม ไม่รองรับการยกเลิกอัตโนมัติ":e.message);
      return false;
    }finally{setBusy(false)}
  }

  async function editCashOrder(s:Sale){
    if(s.payment!=="cash"||s.status!=="paid")return;
    if(s.productionStarted){
      setMsg("ออเดอร์นี้เริ่มผลิตแล้ว จึงไม่สามารถแก้รายการแบบคืน Stock อัตโนมัติได้ · หากลูกค้าเปลี่ยนใจให้ใช้ Refund ตามสถานะจริง");
      return;
    }
    if(!s.items.length||s.items.some(i=>!i.id)){
      setMsg("ข้อมูลเมนูของบิลนี้ไม่ครบ จึงไม่สามารถโหลดกลับไปแก้ไขอัตโนมัติได้");
      return;
    }
    if(!window.confirm("แก้ไข "+s.queueNo+" ?\nระบบจะยกเลิกบิลเดิม คืน Stock และนำรายการทั้งหมดกลับไปหน้า POS เพื่อให้เพิ่ม/ลด/เปลี่ยนเมนูแล้วคิดเงินใหม่"))return;
    const ok=await voidCash(s,"ลูกค้าขอแก้ไขรายการก่อนเริ่มผลิต");
    if(!ok)return;
    cart.replaceItems(s.items.map(i=>({key:i.id+"::"+i.variant,id:i.id,name:i.name,variant:i.variant,price:i.price,qty:i.qty})));
    try{sessionStorage.setItem("field-pos-edit-cash-v1",JSON.stringify({heldCash:s.total,fromBill:s.billNo,fromQueue:s.queueNo}))}catch{}
    router.push("/pos");
  }

  return <section className="flex h-full flex-col p-5 md:p-7">
    <header className="mb-5"><p className="gold m-0 text-[10px] font-bold tracking-[.3em]">TRANSACTIONS</p><h1 className="mt-1 text-2xl font-semibold">ORDERS</h1></header>
    {msg&&<div className="mb-4 flex items-start justify-between gap-3 rounded-2xl border border-slate-300 bg-white p-3 text-sm"><span>{msg}</span><button onClick={()=>setMsg("")}><X size={16}/></button></div>}
    <div className="glass mb-4 flex items-center gap-3 rounded-full px-4 py-3"><Search size={18} className="text-slate-500"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="ค้นหา Order ID / Queue" className="w-full bg-transparent outline-none"/></div>

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
      <div onClick={e=>e.stopPropagation()} className="glass card soft-scroll max-h-[90vh] w-full max-w-lg overflow-auto p-6">
        <SaleReceipt sale={detail}/>
        <div className="flex items-start justify-between gap-3"><div><p className="gold text-[10px] tracking-[.25em]">{detail.billNo}</p><h3 className="mt-1 text-xl">{detail.queueNo}</h3></div><button onClick={()=>setDetail(null)}><X/></button></div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-slate-100 px-3 py-1 uppercase">{detail.status}</span>{detail.productionStarted?<span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">เริ่มผลิตแล้ว</span>:detail.status==="paid"?<span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">ยังแก้ก่อนผลิตได้</span>:null}</div>
        <div className="mt-4 space-y-2">{detail.items.map((i,n)=><div key={n} className="flex justify-between gap-3 rounded-2xl bg-slate-50 p-3"><span><b>{i.name}</b><small className="block text-slate-500">{i.variant} ×{i.qty} · ฿{i.price.toFixed(0)}/แก้ว</small></span><b className="shrink-0">฿{(i.price*i.qty).toFixed(0)}</b></div>)}</div>
        <div className="mt-5 flex justify-between border-t border-slate-200 pt-4 text-lg"><b>Total</b><b className="gold">฿{detail.total.toFixed(0)}</b></div>

        {session.user.role==="admin"&&detail.payment==="cash"&&detail.status==="paid"&&!detail.productionStarted&&<button disabled={busy} onClick={()=>editCashOrder(detail)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#d4af37] py-3 text-sm font-black text-black disabled:opacity-50"><Pencil size={16}/>{busy?"กำลังบันทึก...":"แก้ไข / ลด / เปลี่ยนเมนู"}</button>}
        {session.user.role==="admin"&&detail.payment==="cash"&&detail.status==="paid"&&<button disabled={busy} onClick={()=>voidCash(detail)} className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-red-400/30 py-3 text-sm font-semibold text-red-600 disabled:opacity-40"><Ban size={16}/>VOID CASH SALE + RESTORE STOCK / ยกเลิกบิลเงินสด</button>}
        {session.user.role==="admin"&&["cash","promptpay","split"].includes(detail.payment)&&detail.status==="paid"&&<button disabled={busy} onClick={()=>refundSaleUi(detail)} className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-400/30 py-3 text-sm font-semibold text-amber-800 disabled:opacity-40"><RotateCcw size={16}/>FULL REFUND / คืนเงินเต็มจำนวน</button>}
        <button onClick={()=>window.print()} className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-300 py-3 text-sm font-semibold"><Printer size={16}/>พิมพ์ใบเสร็จ</button>
      </div>
    </div>}
  </section>;
}
