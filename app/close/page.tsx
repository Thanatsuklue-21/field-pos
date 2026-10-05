"use client";
import {useEffect,useState} from "react";
import AuthGate from "@/components/auth-gate";
import {api,type Session} from "@/lib/api-client";

type Close={id:string;date:string;revenue:number;cogs:number;expenses:number;purchaseSpend?:number;totalCashOut?:number;grossProfit:number;operatingProfit:number;cash:number;promptpay:number;other:number;openingCash?:number;cashPaidOut?:number;expectedCash?:number;countedCash?:number;cashVariance?:number;orders:number;cups:number;time:number};
type Shift={id:string;date:string;status:"open"|"closed";openingCash:number;openedAt:number;openedBy:string;closedAt?:number;cashVariance?:number};
type CloseData={closes:Close[];shift:Shift|null;businessDate:string};

export default function CloseDay(){return <AuthGate>{s=><View session={s}/>}</AuthGate>}

function View({session}:{session:Session}){
  const [rows,setRows]=useState<Close[]>([]),[shift,setShift]=useState<Shift|null>(null),[businessDate,setBusinessDate]=useState(""),[msg,setMsg]=useState(""),[busy,setBusy]=useState(false),[openingCash,setOpeningCash]=useState("0"),[countedCash,setCountedCash]=useState("");
  const load=()=>api<CloseData>("/api/close-day").then(x=>{setRows(x.closes||[]);setShift(x.shift||null);setBusinessDate(x.businessDate||"")});
  useEffect(()=>{load().catch(()=>{})},[]);

  async function openShift(){
    const opening=Number(openingCash||0);
    if(!Number.isFinite(opening)||opening<0){setMsg("เงินตั้งต้นต้องไม่ติดลบ");return}
    if(!window.confirm("ยืนยันเปิดกะด้วยเงินตั้งต้น ฿"+opening.toLocaleString()+" ? หลังเปิดแล้วจำนวนนี้จะถูกล็อกสำหรับการกระทบยอดวันนี้"))return;
    setBusy(true);setMsg("");
    try{const r=await api<any>("/api/cash-shift/open",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({openingCash:opening})});setShift(r.shift);setMsg("เปิดกะแล้ว · เงินตั้งต้น ฿"+Number(r.shift.openingCash).toLocaleString()+" ถูกล็อกแล้ว");await load()}
    catch(e:any){setMsg(e.message==="cash_shift_already_opened"?"วันนี้เปิดกะไปแล้ว กรุณารีเฟรช":e.message==="day_already_closed"?"วันนี้ถูกปิดวันแล้ว":e.message)}
    finally{setBusy(false)}
  }

  async function close(){
    const counted=Number(countedCash);
    if(!shift||shift.status!=="open"){setMsg("กรุณาเปิดกะและล็อกเงินตั้งต้นก่อนปิดวัน");return}
    if(!countedCash.trim()||!Number.isFinite(counted)||counted<0){setMsg("กรุณากรอกเงินสดที่นับได้จริง");return}
    if(!window.confirm("ยืนยันปิดวัน? ระบบจะใช้เงินตั้งต้นที่ล็อกไว้ ฿"+Number(shift.openingCash).toLocaleString()+" และคำนวณเงินสดขาด/เกิน"))return;
    setBusy(true);setMsg("");
    try{const r=await api<any>("/api/close-day",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({countedCash:counted})});const v=Number(r.close.cashVariance||0);setMsg("ปิดวันสำเร็จ · เงินสด "+(v===0?"ตรงพอดี":v>0?"เกิน ฿"+v.toLocaleString():"ขาด ฿"+Math.abs(v).toLocaleString()));setCountedCash("");await load()}
    catch(e:any){setMsg(e.message==="day_already_closed"?"วันนี้ถูกปิดวันแล้ว":e.message==="close_day_pending_payments"?"ยังมี Split/Payment ที่ค้างอยู่ กรุณาจัดการให้เสร็จก่อนปิดวัน":e.message==="close_day_open_orders"?"ยังมีออเดอร์ที่ยังไม่ได้ส่งมอบ กรุณาปิดคิวให้ครบก่อนปิดวัน":e.message==="counted_cash_required"?"กรุณากรอกเงินสดที่นับได้จริง":e.message)}
    finally{setBusy(false)}
  }

  return <section className="soft-scroll h-full overflow-auto p-3 sm:p-5 md:p-7">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="gold m-0 text-[10px] font-bold tracking-[.3em]">DAILY CONTROL</p><h1 className="mt-1 text-xl font-semibold sm:text-2xl">CASH SHIFT / CLOSE DAY</h1><p className="mt-1 text-xs text-slate-500">{businessDate||"วันนี้"} · ล็อกเงินตั้งต้นตอนเปิดกะ แล้วนับเงินจริงตอนปิดวัน</p></div>{session.user.role==="admin"&&<button disabled={busy||!shift||shift.status!=="open"} onClick={close} className="min-h-11 rounded-full bg-[#d4af37] px-5 text-sm font-bold text-black disabled:opacity-40">{busy?"กำลังบันทึก...":"CLOSE TODAY"}</button>}</header>

    {session.user.role==="admin"&&<div className="glass card mt-4 p-4 sm:p-5">{!shift?<><div className="flex items-start justify-between gap-3"><div><b>1. เปิดกะ / OPEN SHIFT</b><p className="mt-1 text-xs text-slate-500">นับเงินทอนตั้งต้นในลิ้นชักก่อนเริ่มขาย จำนวนนี้จะล็อกและแก้ย้อนหลังจากหน้าปิดวันไม่ได้</p></div><span className="rounded-full bg-amber-100 px-3 py-1 text-[10px] font-bold text-amber-800">NOT OPEN</span></div><div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]"><input inputMode="decimal" value={openingCash} onChange={e=>setOpeningCash(e.target.value)} className="min-h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4" placeholder="เงินตั้งต้น เช่น 500"/><button disabled={busy} onClick={openShift} className="min-h-12 rounded-2xl bg-[#d4af37] px-5 font-bold text-black disabled:opacity-40">OPEN CASH SHIFT</button></div></>:<><div className="flex flex-wrap items-start justify-between gap-3"><div><b>{shift.status==="open"?"กะเปิดอยู่":"กะวันนี้ปิดแล้ว"}</b><p className="mt-1 text-xs text-slate-500">เปิดเมื่อ {new Date(shift.openedAt).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})}</p></div><div className="text-right"><small className="text-slate-500">เงินตั้งต้นที่ล็อก</small><div className="text-2xl font-semibold text-[#765b08]">฿{Number(shift.openingCash).toLocaleString()}</div></div></div>{shift.status==="open"&&<div className="mt-4 border-t border-slate-200 pt-4"><label className="text-sm"><span className="text-slate-500">2. เงินสดที่นับได้จริงก่อนปิดวัน</span><input inputMode="decimal" value={countedCash} onChange={e=>setCountedCash(e.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" placeholder="จำนวนเงินสดจริง"/></label><p className="mt-2 text-xs text-slate-500">ระบบไม่แสดง Expected Cash ก่อนกดยืนยัน เพื่อให้การนับเป็นอิสระจากยอดในระบบ · Expected Cash = เงินตั้งต้น + ยอดขายเงินสด − ค่าใช้จ่ายที่จ่ายสดจากลิ้นชัก</p></div>}</>}</div>}

    {msg&&<div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3 text-sm">{msg}</div>}
    <div className="mt-5 grid gap-3">{rows.map(x=><div key={x.id} className="glass card p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><small className="text-slate-500">{x.date}</small><div className="mt-1 text-2xl font-semibold gold">฿{x.revenue.toLocaleString()}</div><small className="text-slate-500">{x.orders} orders · {x.cups} cups</small></div><div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4"><div><small className="text-slate-500">Opening Cash</small><div>฿{Number(x.openingCash||0).toLocaleString()}</div></div><div><small className="text-slate-500">Cash Sales</small><div>฿{x.cash.toLocaleString()}</div></div><div><small className="text-slate-500">Cash Paid Out</small><div className="text-red-600">−฿{Number(x.cashPaidOut||0).toLocaleString()}</div></div><div><small className="text-slate-500">Expected Drawer</small><div>฿{Number(x.expectedCash??x.cash).toLocaleString()}</div></div><div><small className="text-slate-500">Counted Cash</small><div>฿{Number(x.countedCash??x.cash).toLocaleString()}</div></div><div><small className="text-slate-500">Cash Variance</small><div className={Number(x.cashVariance||0)===0?"text-emerald-700":Number(x.cashVariance||0)>0?"text-amber-700":"text-red-600"}>{Number(x.cashVariance||0)>0?"+":""}฿{Number(x.cashVariance||0).toLocaleString()}</div></div><div><small className="text-slate-500">PromptPay</small><div>฿{x.promptpay.toLocaleString()}</div></div><div><small className="text-slate-500">COGS</small><div>฿{x.cogs.toLocaleString()}</div></div><div><small className="text-slate-500">Operating Expenses</small><div>฿{x.expenses.toLocaleString()}</div></div><div><small className="text-slate-500">Purchase Spend</small><div>฿{Number(x.purchaseSpend||0).toLocaleString()}</div></div><div><small className="text-slate-500">Gross Profit</small><div>฿{x.grossProfit.toLocaleString()}</div></div><div><small className="text-slate-500">Operating Profit</small><div className={x.operatingProfit>=0?"text-emerald-700":"text-red-600"}>฿{x.operatingProfit.toLocaleString()}</div></div></div></div></div>)}</div>
  </section>
}
