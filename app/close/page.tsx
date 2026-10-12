"use client";
import {useEffect,useState} from "react";
import AuthGate from "@/components/auth-gate";
import {api,type Session} from "@/lib/api-client";

type Close={id:string;date:string;revenue:number;cogs:number;expenses:number;purchaseSpend?:number;totalCashOut?:number;grossProfit:number;operatingProfit:number;cash:number;promptpay:number;bank?:number;card?:number;other:number;openingCash?:number;cashIn?:number;cashPaidOut?:number;cashOut?:number;expectedCash?:number;countedCash?:number;cashVariance?:number;orders:number;cups:number;time:number};
type Shift={id:string;date:string;status:"open"|"closed";openingCash:number;openedAt:number;openedBy:string;closedAt?:number;cashVariance?:number};
type Movement={id:string;shiftId:string;date:string;type:"CASH_IN"|"CASH_OUT";amount:number;reason:string;time:number;createdBy:string};
type CloseData={closes:Close[];shift:Shift|null;businessDate:string;cashMovements:Movement[]};

export default function CloseDay(){return <AuthGate>{s=><View session={s}/>}</AuthGate>}

function View({session}:{session:Session}){
  const [rows,setRows]=useState<Close[]>([]),[shift,setShift]=useState<Shift|null>(null),[businessDate,setBusinessDate]=useState(""),[movements,setMovements]=useState<Movement[]>([]),[msg,setMsg]=useState(""),[busy,setBusy]=useState(false),[openingCash,setOpeningCash]=useState("0"),[firstCount,setFirstCount]=useState(""),[secondCount,setSecondCount]=useState(""),[review,setReview]=useState<any|null>(null),[varianceReason,setVarianceReason]=useState(""),[confirmVariance,setConfirmVariance]=useState(false),[movementType,setMovementType]=useState<"CASH_IN"|"CASH_OUT">("CASH_OUT"),[movementAmount,setMovementAmount]=useState(""),[movementReason,setMovementReason]=useState("");
  const load=()=>api<CloseData>("/api/close-day").then(x=>{setRows(x.closes||[]);setShift(x.shift||null);setBusinessDate(x.businessDate||"");setMovements(x.cashMovements||[]) });
  useEffect(()=>{load().catch(()=>{})},[]);

  async function openShift(){
    const opening=Number(openingCash||0);
    if(!Number.isFinite(opening)||opening<0){setMsg("เงินตั้งต้นต้องไม่ติดลบ");return}
    if(!window.confirm("ยืนยันเปิดร้านด้วยเงินตั้งต้น ฿"+opening.toLocaleString()+" ? หลังเปิดแล้วจำนวนนี้จะถูกล็อกสำหรับการกระทบยอดวันนี้"))return;
    setBusy(true);setMsg("");
    try{const r=await api<any>("/api/cash-shift/open",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({openingCash:opening})});setShift(r.shift);setMsg("เปิดร้านแล้ว · เงินตั้งต้น ฿"+Number(r.shift.openingCash).toLocaleString()+" ถูกล็อกแล้ว");await load()}
    catch(e:any){setMsg(e.message==="cash_shift_already_opened"?"วันนี้เปิดร้านไปแล้ว กรุณารีเฟรช":e.message==="day_already_closed"?"วันนี้ถูกปิดวันแล้ว":e.message)}
    finally{setBusy(false)}
  }

  async function addMovement(){
    const amount=Number(movementAmount);
    if(!shift||shift.status!=="open"){setMsg("ต้องเปิดร้านก่อนบันทึกเงินเข้า/ออกลิ้นชัก");return}
    if(!Number.isFinite(amount)||amount<=0){setMsg("กรุณากรอกจำนวนเงินที่ถูกต้อง");return}
    if(movementReason.trim().length<2){setMsg("กรุณาระบุเหตุผล");return}
    let riskConfirmed=false;
    if(movementType==="CASH_OUT"&&amount>=500){
      riskConfirmed=window.confirm("ยืนยันนำเงินสดออก ฿"+amount.toLocaleString()+" ? รายการนี้เป็น High-Risk Action และจะถูกบันทึก Audit Log");
      if(!riskConfirmed)return;
    }
    setBusy(true);setMsg("");
    try{
      await api("/api/cash-shift/movements",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({type:movementType,amount,reason:movementReason.trim(),riskConfirmed})});
      setMovementAmount("");setMovementReason("");setMsg(movementType==="CASH_IN"?"บันทึกเติมเงินสดเข้าลิ้นชักแล้ว":"บันทึกนำเงินสดออกจากลิ้นชักแล้ว");await load();
    }catch(e:any){setMsg(e.message==="drawer_cash_shortage"?"เงินสดตามระบบไม่พอสำหรับนำออกจำนวนนี้":e.message==="cash_shift_not_open"?"ต้องเปิดร้านก่อนบันทึกเงินเข้า/ออก":e.message)}
    finally{setBusy(false)}
  }

  async function reviewCash(){
    const first=Number(firstCount),second=Number(secondCount);
    if(!shift||shift.status!=="open"){setMsg("กรุณาเปิดร้านและล็อกเงินตั้งต้นก่อนปิดวัน");return}
    if(!firstCount.trim()||!Number.isFinite(first)||first<0){setMsg("กรุณากรอกยอดนับรอบที่ 1");return}
    if(!secondCount.trim()||!Number.isFinite(second)||second<0){setMsg("กรุณากรอกยอดนับรอบที่ 2");return}
    setBusy(true);setMsg("");setReview(null);setVarianceReason("");setConfirmVariance(false);
    try{
      const r=await api<any>("/api/close-day/review",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({firstCount:first,secondCount:second})});
      setReview(r.review);
      const v=Number(r.review.variance||0);
      setMsg(v===0?"AI ตรวจแล้ว · เงินสดตรงพอดี":r.review.summary||"AI พบส่วนต่าง กรุณาตรวจสอบก่อนปิดวัน");
    }catch(e:any){
      if(e.message==="cash_recount_mismatch"){
        setSecondCount("");setMsg("ยอดนับรอบ 1 และรอบ 2 ไม่ตรงกัน · กรุณานับรอบ 2 ใหม่โดยไม่ดูยอดระบบ");
      }else setMsg(e.message==="close_day_pending_payments"?"ยังมี Payment ค้าง ต้องจัดการก่อน":e.message==="close_day_open_orders"?"ยังมีออเดอร์ที่ยังไม่ส่งมอบ":e.message==="cash_shift_not_open"?"ยังไม่ได้เปิดกะเงินสด":e.message);
    }finally{setBusy(false)}
  }

  async function close(){
    if(!review){setMsg("กรุณานับเงิน 2 รอบและให้ AI ตรวจสอบก่อนปิดวัน");return}
    const counted=Number(review.countedCash);
    if(review.variance!==0&&varianceReason.trim().length<2){setMsg("เงินขาด/เกินต้องระบุเหตุผลก่อนปิดวัน");return}
    if(review.ownerConfirmRequired&&!confirmVariance){setMsg("ส่วนต่างสูง ต้องติ๊กยืนยันโดยเจ้าของก่อนปิดวัน");return}
    if(!window.confirm("ยืนยันปิดวันตามผลตรวจ AI? "+(review.variance===0?"เงินสดตรงพอดี":review.summary)))return;
    setBusy(true);setMsg("");
    try{
      const r=await api<any>("/api/close-day",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({countedCash:counted,reviewId:review.id,varianceReason:varianceReason.trim(),confirmVariance})});
      const v=Number(r.close.cashVariance||0);
      setMsg("ปิดวันสำเร็จ · เงินสด "+(v===0?"ตรงพอดี":v>0?"เกิน ฿"+v.toLocaleString():"ขาด ฿"+Math.abs(v).toLocaleString()));
      setFirstCount("");setSecondCount("");setReview(null);setVarianceReason("");setConfirmVariance(false);await load();
    }catch(e:any){
      const map:Record<string,string>={
        day_already_closed:"วันนี้ถูกปิดวันแล้ว",
        close_day_pending_payments:"ยังมี Payment ที่ค้างอยู่",
        close_day_open_orders:"ยังมีออเดอร์ที่ยังไม่ได้ส่งมอบ",
        close_day_review_required:"ต้องผ่านการตรวจ 2 รอบก่อน",
        close_day_review_expired:"ผลตรวจหมดอายุ กรุณานับใหม่",
        close_day_review_stale:"ข้อมูลการเงินเปลี่ยนหลังตรวจ กรุณานับและตรวจใหม่",
        close_day_review_count_changed:"ยอดนับเปลี่ยนจากผลตรวจ กรุณาตรวจใหม่",
        cash_variance_reason_required:"เงินขาด/เกินต้องระบุเหตุผล",
        cash_variance_owner_confirmation_required:"ส่วนต่างสูง ต้องยืนยันโดยเจ้าของ"
      };
      if(["close_day_review_expired","close_day_review_stale","close_day_review_count_changed"].includes(e.message))setReview(null);
      setMsg(map[e.message]||e.message);
    }finally{setBusy(false)}
  }

  return <section className="soft-scroll h-full overflow-auto p-3 sm:p-5 md:p-7">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="gold m-0 text-[10px] font-bold tracking-[.3em]">DAILY CONTROL</p><h1 className="mt-1 text-xl font-semibold sm:text-2xl">OPEN / CLOSE DAY</h1><p className="mt-1 text-xs text-slate-500">{businessDate||"วันนี้"} · เปิดร้านด้วยเงินทอนตั้งต้น แล้วนับเงินจริงก่อนปิดร้าน</p></div>{session.user.role==="admin"&&<button disabled={busy||!shift||shift.status!=="open"} onClick={close} className="min-h-11 rounded-full bg-[#d4af37] px-5 text-sm font-bold text-black disabled:opacity-40">{busy?"กำลังบันทึก...":"ปิดร้านวันนี้"}</button>}</header>

    {session.user.role==="admin"&&<div className="glass card mt-4 p-4 sm:p-5">{!shift?<><div className="flex items-start justify-between gap-3"><div><b>1. เปิดร้าน / เงินทอนตั้งต้น</b><p className="mt-1 text-xs text-slate-500">ใส่เงินทอนตั้งต้นก่อนเริ่มขาย · ร้านทำงานคนเดียวจึงเปิดรอบเงินสดครั้งเดียวต่อวัน</p></div><span className="rounded-full bg-amber-100 px-3 py-1 text-[10px] font-bold text-amber-800">ยังไม่เปิดร้าน</span></div><div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]"><input inputMode="decimal" value={openingCash} onChange={e=>setOpeningCash(e.target.value)} className="min-h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4" placeholder="เงินตั้งต้น เช่น 500"/><button type="button" disabled={busy} onClick={()=>setOpeningCash("0")} className="min-h-12 rounded-2xl border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 disabled:opacity-40">ไม่มีเงินทอน · ฿0</button><button disabled={busy} onClick={openShift} className="min-h-12 rounded-2xl bg-[#d4af37] px-5 font-bold text-black disabled:opacity-40">เปิดร้านวันนี้</button></div></>:<><div className="flex flex-wrap items-start justify-between gap-3"><div><b>{shift.status==="open"?"ร้านเปิดอยู่":"วันนี้ปิดร้านแล้ว"}</b><p className="mt-1 text-xs text-slate-500">เปิดเมื่อ {new Date(shift.openedAt).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})}</p></div><div className="text-right"><small className="text-slate-500">เงินตั้งต้นที่ล็อก</small><div className="text-2xl font-semibold text-[#765b08]">฿{Number(shift.openingCash).toLocaleString()}</div></div></div>{shift.status==="open"&&<div className="mt-4 border-t border-slate-200 pt-4"><div className="flex items-start justify-between gap-3"><div><b>2. นับเงินสดแบบ Blind Count 2 รอบ</b><p className="mt-1 text-xs text-slate-500">ระบบยังไม่แสดง Expected Cash จนกว่านับ 2 รอบตรงกัน เพื่อลดทั้งการกรอกผิดและการปรับตัวเลขตามระบบ · เงินสดที่นับได้จริงต้องนับใหม่อย่างอิสระทั้ง 2 รอบ · Expected Cash = เงินตั้งต้น + ยอดขายเงินสด + เงินเติมเข้า − ค่าใช้จ่ายเงินสด − เงินนำออก</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold">{review?"ตรวจแล้ว":"รอตรวจ"}</span></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="text-sm"><span className="text-slate-500">รอบที่ 1</span><input inputMode="decimal" value={firstCount} onChange={e=>{setFirstCount(e.target.value);setReview(null)}} className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" placeholder="นับเงินจริงรอบแรก"/></label><label className="text-sm"><span className="text-slate-500">รอบที่ 2 · นับใหม่อีกครั้ง</span><input inputMode="decimal" value={secondCount} onChange={e=>{setSecondCount(e.target.value);setReview(null)}} className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" placeholder="นับเงินจริงรอบสอง"/></label></div><button type="button" onClick={reviewCash} disabled={busy||!firstCount.trim()||!secondCount.trim()} className="mt-3 min-h-11 rounded-2xl border border-[#d4af37] bg-[#d4af37]/10 px-4 text-sm font-bold text-[#6f5510] disabled:opacity-40">AI ตรวจความถูกต้องก่อนปิดวัน</button>{review&&<div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4"><div className="grid gap-2 sm:grid-cols-3"><div><small className="text-slate-500">Expected Cash</small><div className="text-xl font-semibold">฿{Number(review.expectedCash).toLocaleString()}</div></div><div><small className="text-slate-500">นับจริง</small><div className="text-xl font-semibold">฿{Number(review.countedCash).toLocaleString()}</div></div><div><small className="text-slate-500">ส่วนต่าง</small><div className={"text-xl font-semibold "+(Number(review.variance)===0?"text-emerald-700":Number(review.variance)>0?"text-amber-700":"text-red-600")}>{Number(review.variance)>0?"+":""}฿{Number(review.variance).toLocaleString()}</div></div></div><div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm"><b>AI Assessment · {review.level}</b><div className="mt-1 text-slate-600">{review.summary}</div>{Array.isArray(review.evidence)&&review.evidence.length>0&&<div className="mt-2 text-xs text-slate-500">ตรวจประกอบจาก {review.evidence.map((x:any)=>x.code).join(" · ")}</div>}</div>{Number(review.variance)!==0&&<label className="mt-3 block text-sm"><span className="text-slate-500">เหตุผลเงินขาด/เกิน</span><input value={varianceReason} onChange={e=>setVarianceReason(e.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" placeholder="เช่น นับผิดรอบแรก / ทอนผิด / เงินออกยังไม่ได้บันทึก / ต้องตรวจเพิ่ม"/></label>}{review.ownerConfirmRequired&&<label className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><input type="checkbox" checked={confirmVariance} onChange={e=>setConfirmVariance(e.target.checked)} className="mt-1"/><span>ฉันเป็นเจ้าของและยืนยันว่าตรวจส่วนต่างนี้แล้ว ระบบจะเก็บเหตุผลและ Audit Log ถาวร</span></label>}</div>}</div>}</>}</div>}

    {session.user.role==="admin"&&shift?.status==="open"&&<div className="glass card mt-4 p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><b>เงินสดเข้า/ออกลิ้นชักระหว่างวัน</b><p className="mt-1 text-xs text-slate-500">ใช้เฉพาะเงินที่ไม่ใช่ยอดขายและไม่ใช่ค่าใช้จ่าย เช่น เติมเงินทอนเพิ่ม หรือนำเงินสดส่วนเกินออกไปเก็บ</p></div><div className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold text-slate-600">{movements.length} รายการวันนี้</div></div><div className="mt-4 grid gap-2 sm:grid-cols-[140px_1fr_1.5fr_auto]"><select value={movementType} onChange={e=>setMovementType(e.target.value as "CASH_IN"|"CASH_OUT")} className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3"><option value="CASH_OUT">นำเงินออก</option><option value="CASH_IN">เติมเงินเข้า</option></select><input inputMode="decimal" value={movementAmount} onChange={e=>setMovementAmount(e.target.value)} placeholder="จำนวนเงิน" className="min-h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3"/><input value={movementReason} onChange={e=>setMovementReason(e.target.value)} placeholder="เหตุผล เช่น เก็บเงินสดส่วนเกิน / เติมเงินทอน" className="min-h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3"/><button disabled={busy||!(Number(movementAmount)>0)||movementReason.trim().length<2} onClick={addMovement} className="min-h-11 rounded-2xl bg-[#d4af37] px-4 text-sm font-bold text-black disabled:opacity-40">บันทึก</button></div>{movements.length>0&&<div className="mt-4 space-y-2">{movements.map(x=><div key={x.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm"><div><b className={x.type==="CASH_IN"?"text-emerald-700":"text-red-600"}>{x.type==="CASH_IN"?"เติมเข้า":"นำออก"} ฿{x.amount.toLocaleString()}</b><div className="text-xs text-slate-500">{x.reason}</div></div><small className="text-slate-400">{new Date(x.time).toLocaleTimeString("th-TH",{timeZone:"Asia/Bangkok",hour:"2-digit",minute:"2-digit"})}</small></div>)}</div>}</div>}

    {msg&&<div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3 text-sm">{msg}</div>}
    <div className="mt-5 grid gap-3">{rows.map(x=><div key={x.id} className="glass card p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><small className="text-slate-500">{x.date}</small><div className="mt-1 text-2xl font-semibold gold">฿{x.revenue.toLocaleString()}</div><small className="text-slate-500">{x.orders} orders · {x.cups} cups</small></div><div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4"><div><small className="text-slate-500">Opening Cash</small><div>฿{Number(x.openingCash||0).toLocaleString()}</div></div><div><small className="text-slate-500">Cash Sales</small><div>฿{x.cash.toLocaleString()}</div></div><div><small className="text-slate-500">Cash In</small><div className="text-emerald-700">+฿{Number(x.cashIn||0).toLocaleString()}</div></div><div><small className="text-slate-500">Cash Paid Out</small><div className="text-red-600">−฿{Number(x.cashPaidOut||0).toLocaleString()}</div></div><div><small className="text-slate-500">Cash Out</small><div className="text-red-600">−฿{Number(x.cashOut||0).toLocaleString()}</div></div><div><small className="text-slate-500">Expected Drawer</small><div>฿{Number(x.expectedCash??x.cash).toLocaleString()}</div></div><div><small className="text-slate-500">Counted Cash</small><div>฿{Number(x.countedCash??x.cash).toLocaleString()}</div></div><div><small className="text-slate-500">Cash Variance</small><div className={Number(x.cashVariance||0)===0?"text-emerald-700":Number(x.cashVariance||0)>0?"text-amber-700":"text-red-600"}>{Number(x.cashVariance||0)>0?"+":""}฿{Number(x.cashVariance||0).toLocaleString()}</div></div><div><small className="text-slate-500">PromptPay</small><div>฿{x.promptpay.toLocaleString()}</div></div><div><small className="text-slate-500">โอนธนาคาร</small><div>฿{Number(x.bank||0).toLocaleString()}</div></div><div><small className="text-slate-500">บัตร</small><div>฿{Number(x.card||0).toLocaleString()}</div></div><div><small className="text-slate-500">COGS</small><div>฿{x.cogs.toLocaleString()}</div></div><div><small className="text-slate-500">Operating Expenses</small><div>฿{x.expenses.toLocaleString()}</div></div><div><small className="text-slate-500">Purchase Spend</small><div>฿{Number(x.purchaseSpend||0).toLocaleString()}</div></div><div><small className="text-slate-500">Gross Profit</small><div>฿{x.grossProfit.toLocaleString()}</div></div><div><small className="text-slate-500">Operating Profit</small><div className={x.operatingProfit>=0?"text-emerald-700":"text-red-600"}>฿{x.operatingProfit.toLocaleString()}</div></div></div></div></div>)}</div>
  </section>
}
