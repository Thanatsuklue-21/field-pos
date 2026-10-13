"use client";
import {useEffect,useState} from "react";
import {Plus,Trash2,X} from "lucide-react";
import AuthGate from "@/components/auth-gate";
import {api,type Session} from "@/lib/api-client";

type E={id:string;date:string;time:number;category:string;description:string;amount:number;paymentMethod?:string;sourceType?:string;createdBy?:string;requestKey?:string};
type Shift={id:string;date:string;status:"open"|"closed";openingCash:number};
type DrawerSnapshot={openingCash:number;cashSales:number;cashIn:number;cashPaidOut:number;cashOut:number;availableCash:number};
type ExpenseData={expenses:E[];businessDate:string;shift:Shift|null;drawerSnapshot:DrawerSnapshot|null};

const paymentLabel=(v?:string)=>v==="cash"?"เงินสด":v==="bank"?"โอน/ธนาคาร":v==="noncash"?"ไม่ใช่เงินสด":v==="other"?"อื่น ๆ":"ไม่ระบุ";
const newRequestKey=()=>`expense:${typeof crypto!=="undefined"&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+"-"+Math.random().toString(36).slice(2)}`;

export default function Expenses(){return <AuthGate>{s=><View session={s}/>}</AuthGate>}

function View({session}:{session:Session}){
  const [rows,setRows]=useState<E[]>([]),[businessDate,setBusinessDate]=useState(""),[shift,setShift]=useState<Shift|null>(null),[drawerSnapshot,setDrawerSnapshot]=useState<DrawerSnapshot|null>(null),[open,setOpen]=useState(false),[amount,setAmount]=useState(""),[category,setCategory]=useState("OTHER"),[description,setDescription]=useState(""),[paymentMethod,setPaymentMethod]=useState("cash"),[requestKey,setRequestKey]=useState(""),[riskConfirmed,setRiskConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const load=()=>api<ExpenseData>("/api/expenses").then(x=>{setRows(x.expenses||[]);setBusinessDate(x.businessDate||"");setShift(x.shift||null);setDrawerSnapshot(x.drawerSnapshot||null)});
  useEffect(()=>{load().catch(()=>{})},[]);
  useEffect(()=>{
    if(!open)return;
    const onKey=(e:KeyboardEvent)=>{if(e.key==="Escape"&&!busy)setOpen(false)};
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[open,busy]);

  const amountNumber=Number(amount)||0;
  const isCash=paymentMethod==="cash";
  const currentDrawerCash=Number(drawerSnapshot?.availableCash||0);
  const cashShiftReady=!!shift&&shift.status==="open";
  const cashTooLarge=isCash&&amountNumber>currentDrawerCash;
  const highRisk=isCash&&amountNumber>=500;
  const afterDrawerCash=currentDrawerCash-amountNumber;
  const canSave=amountNumber>0&&(!isCash||(cashShiftReady&&!cashTooLarge))&&(!highRisk||(riskConfirmed&&description.trim().length>=2));

  function openCreate(){
    setAmount("");setCategory("OTHER");setDescription("");setPaymentMethod("cash");setRiskConfirmed(false);setRequestKey(newRequestKey());setError("");setNotice("");setOpen(true);
  }
  function closeCreate(){if(!busy)setOpen(false)}

  async function save(){
    const key=requestKey||newRequestKey();
    if(!requestKey)setRequestKey(key);
    setBusy(true);setError("");setNotice("");
    try{
      const r=await api<any>("/api/expenses",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({amount:amountNumber,category,description:description.trim(),paymentMethod,requestKey:key,riskConfirmed})});
      setOpen(false);setAmount("");setDescription("");setPaymentMethod("cash");setRiskConfirmed(false);setRequestKey("");
      setNotice((r.replayed?"รายการนี้ถูกบันทึกไว้แล้ว · ระบบไม่สร้างซ้ำ":"บันทึกค่าใช้จ่ายแล้ว")+(r.availableCash!==null&&r.availableCash!==undefined?" · เงินในลิ้นชักคงเหลือตามระบบ ฿"+Number(r.availableCash).toLocaleString():""));
      await load();
    }catch(e:any){
      const map:Record<string,string>={
        day_closed:"ปิดยอดวันนี้แล้ว ไม่สามารถแก้ไขค่าใช้จ่ายได้",
        cash_shift_not_open:"ยังไม่ได้เปิด Cash Shift วันนี้ · หากจ่ายจากลิ้นชักต้องเปิดร้านก่อน หรือเลือกโอน/ธนาคาร",
        drawer_cash_shortage:"ยอดเงินในลิ้นชักตามระบบไม่พอสำหรับค่าใช้จ่ายนี้ · กรุณารีเฟรชและตรวจยอดจริง",
        high_risk_confirmation_required:"ค่าใช้จ่ายเงินสดตั้งแต่ ฿500 ต้องยืนยัน High-Risk Action ก่อน",
        expense_reason_required:"รายการเงินสดมูลค่าสูงต้องระบุเหตุผลอย่างน้อย 2 ตัวอักษร",
        request_key_conflict:"คำขอบันทึกรายการนี้ถูกใช้กับข้อมูลอื่นแล้ว · กรุณาปิดหน้าต่างและเริ่มรายการใหม่",
        invalid_request_key:"รหัสกันรายการซ้ำไม่ถูกต้อง · กรุณาปิดหน้าต่างและลองใหม่",
        invalid_expense_payment_method:"ช่องทางการจ่ายไม่ถูกต้อง",
        invalid_expense:"จำนวนเงินหรือข้อมูลค่าใช้จ่ายไม่ถูกต้อง"
      };
      setError(map[e.message]||e.message);
      await load().catch(()=>{});
    }finally{setBusy(false)}
  }

  async function del(row:E){
    if(session.user.role!=="admin")return;
    if(!window.confirm(`ยืนยันลบค่าใช้จ่าย ฿${row.amount.toLocaleString()} · ${row.description||row.category} ?\nระบบจะเก็บ Audit Log การลบไว้`))return;
    setError("");setNotice("");
    try{
      await api("/api/expenses/"+encodeURIComponent(row.id),{method:"DELETE",headers:{"X-CSRF-Token":session.csrf}});
      setNotice("ลบรายการค่าใช้จ่ายแล้ว · Audit Log ถูกบันทึก");
      await load();
    }catch(e:any){
      setError(e.message==="day_closed"?"รายการของวันที่ปิดยอดแล้ว ไม่สามารถลบได้":e.message==="system_expense_read_only"?"รายการนี้มาจาก Stock/Purchase/Waste ต้องแก้จากต้นทาง ไม่สามารถลบจากค่าใช้จ่ายโดยตรง":e.message);
    }
  }

  const purchase=rows.filter(x=>x.category==="PURCHASE").reduce((s,x)=>s+x.amount,0),operating=rows.filter(x=>x.category!=="PURCHASE").reduce((s,x)=>s+x.amount,0),cashOut=rows.filter(x=>x.paymentMethod==="cash").reduce((s,x)=>s+x.amount,0),total=purchase+operating;

  return <section className="soft-scroll h-full overflow-auto p-3 sm:p-5 md:p-7">
    <header className="mb-4 flex items-end justify-between gap-3"><div><p className="gold m-0 text-[10px] font-bold tracking-[.3em]">COST CONTROL</p><h1 className="mt-1 text-xl font-semibold sm:text-2xl">EXPENSES</h1><p className="mt-1 text-xs text-slate-500">แยกเงินสดหน้าร้านออกจากโอน/ธนาคาร · รายการเงินสดตรวจยอดลิ้นชักจาก Server ก่อนบันทึก</p></div><button onClick={openCreate} className="flex min-h-11 items-center gap-2 rounded-full bg-[#d4af37] px-4 text-sm font-bold text-black"><Plus size={16}/>เพิ่ม</button></header>

    {error&&<p role="alert" className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice&&<p role="status" className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

    <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
      <div className="glass card p-4"><small className="text-slate-500">Operating Expenses</small><div className="mt-1 text-xl">฿{operating.toLocaleString()}</div></div>
      <div className="glass card p-4"><small className="text-slate-500">Purchase Spend</small><div className="mt-1 text-xl">฿{purchase.toLocaleString()}</div></div>
      <div className="glass card p-4"><small className="text-slate-500">จ่ายสดจากลิ้นชัก</small><div className="mt-1 text-xl text-red-600">฿{cashOut.toLocaleString()}</div></div>
      <div className="glass card p-4"><small className="text-slate-500">Cash Out ทั้งหมด</small><div className="mt-1 text-xl gold">฿{total.toLocaleString()}</div></div>
      <div className="glass card col-span-2 p-4 lg:col-span-1"><small className="text-slate-500">ลิ้นชักตามระบบ · {businessDate||"วันนี้"}</small><div className={"mt-1 text-xl "+(cashShiftReady?"text-slate-900":"text-amber-700")}>{cashShiftReady?"฿"+currentDrawerCash.toLocaleString():"ยังไม่เปิดร้าน"}</div></div>
    </div>

    <div className="glass card soft-scroll overflow-auto p-2"><table className="w-full min-w-[720px] text-sm"><thead className="sticky top-0 bg-slate-50 text-left text-[10px] uppercase tracking-widest text-slate-500"><tr><th className="p-4">Date</th><th>Category</th><th>Description</th><th>Payment</th><th>Amount</th><th></th></tr></thead><tbody>{rows.map(x=>{const system=String(x.sourceType||"").startsWith("STOCK_")||["PURCHASE","WASTE"].includes(String(x.category||"").toUpperCase());return <tr key={x.id} className="border-t border-slate-100"><td className="p-4">{x.date}</td><td>{x.category}</td><td className="text-slate-600">{x.description||"—"}</td><td>{paymentLabel(x.paymentMethod)}</td><td className="gold">฿{x.amount.toLocaleString(undefined,{maximumFractionDigits:2})}</td><td>{session.user.role==="admin"&&!system&&<button aria-label="ลบค่าใช้จ่าย" onClick={()=>del(x)} className="grid h-10 w-10 place-items-center rounded-xl text-red-600 hover:bg-red-50"><Trash2 size={15}/></button>}</td></tr>})}</tbody></table></div>

    {open&&<div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onClick={closeCreate}><div role="dialog" aria-modal="true" aria-labelledby="expense-dialog-title" onClick={e=>e.stopPropagation()} className="w-full max-w-lg rounded-t-[28px] bg-white p-4 shadow-2xl sm:rounded-[28px] sm:p-5">
      <div className="flex items-start justify-between gap-3"><div><p className="m-0 text-[10px] font-black tracking-[.2em] text-[#765b08]">GUIDED EXPENSE CONTROL</p><h2 id="expense-dialog-title" className="mt-1 text-xl font-bold">เพิ่มค่าใช้จ่าย</h2><p className="mt-1 text-xs text-slate-500">เลือกช่องทางให้ตรงกับเงินจริง · ถ้าเป็นเงินสด Server จะตรวจยอดลิ้นชักซ้ำตอนกดยืนยัน</p></div><button disabled={busy} aria-label="ปิดหน้าต่างค่าใช้จ่าย" onClick={closeCreate} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white disabled:opacity-40"><X size={18}/></button></div>

      <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-slate-100 p-1">
        <button type="button" onClick={()=>{setPaymentMethod("cash");setRiskConfirmed(false)}} className={"min-h-11 rounded-xl text-xs font-bold "+(paymentMethod==="cash"?"bg-white text-red-600 shadow-sm":"text-slate-600")}>เงินสดจากลิ้นชัก</button>
        <button type="button" onClick={()=>{setPaymentMethod("bank");setRiskConfirmed(false)}} className={"min-h-11 rounded-xl text-xs font-bold "+(paymentMethod==="bank"?"bg-white text-slate-900 shadow-sm":"text-slate-600")}>โอน/ธนาคาร</button>
        <button type="button" onClick={()=>{setPaymentMethod("other");setRiskConfirmed(false)}} className={"min-h-11 rounded-xl text-xs font-bold "+(paymentMethod==="other"?"bg-white text-slate-900 shadow-sm":"text-slate-600")}>อื่น ๆ</button>
      </div>

      {isCash&&<div className="mt-4">
        {!cashShiftReady?<div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><b>ยังไม่เปิด Cash Shift</b><div className="mt-1 text-xs">ไม่อนุญาตให้บันทึกค่าใช้จ่ายจากลิ้นชักจนกว่าจะเปิดร้าน หากจ่ายจากบัญชีให้เลือก “โอน/ธนาคาร”</div></div>:<div className="grid grid-cols-2 gap-2 text-center"><div className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><small className="text-slate-500">ก่อนจ่าย</small><div className="mt-1 text-lg font-semibold">฿{currentDrawerCash.toLocaleString()}</div></div><div className={"rounded-2xl border p-3 "+(cashTooLarge?"border-red-200 bg-red-50":"border-slate-200 bg-slate-50")}><small className="text-slate-500">หลังจ่าย</small><div className={"mt-1 text-lg font-semibold "+(cashTooLarge?"text-red-600":"text-slate-900")}>฿{afterDrawerCash.toLocaleString()}</div></div></div>}
      </div>}

      <div className="mt-4 grid gap-3">
        <select value={category} onChange={e=>setCategory(e.target.value)} className="min-h-12 rounded-2xl border border-slate-200 bg-white px-4"><option value="OTHER">อื่น ๆ</option><option value="UTILITY">ค่าน้ำ/ไฟ/สาธารณูปโภค</option><option value="MAINTENANCE">ซ่อมบำรุง</option><option value="PACKAGING">บรรจุภัณฑ์ฉุกเฉิน</option><option value="MARKETING">การตลาด</option><option value="TRANSPORT">เดินทาง/ขนส่ง</option></select>
        <label className="text-sm"><span className="font-semibold text-slate-700">จำนวนเงิน</span><input autoFocus inputMode="decimal" value={amount} onChange={e=>{setAmount(e.target.value);setRiskConfirmed(false)}} placeholder="0" className="mt-2 min-h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-lg font-semibold outline-none"/></label>
        {cashTooLarge&&<div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">เงินในลิ้นชักตามระบบไม่พอ · ปุ่มบันทึกถูกปิดเพื่อกันยอดติดลบ</div>}
        <label className="text-sm"><span className="font-semibold text-slate-700">รายละเอียด / เหตุผล</span><input value={description} onChange={e=>setDescription(e.target.value)} placeholder="เช่น ค่าจอดรถ / ซื้อบรรจุภัณฑ์ฉุกเฉิน" className="mt-2 min-h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 outline-none"/></label>
        {highRisk&&<label className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><input type="checkbox" checked={riskConfirmed} onChange={e=>setRiskConfirmed(e.target.checked)} className="mt-1 h-4 w-4"/><span><b>High-Risk Cash Expense</b><br/><span className="text-xs">ยืนยันค่าใช้จ่ายเงินสดตั้งแต่ ฿500 ขึ้นไป และเข้าใจว่าจำนวนเงิน เหตุผล ผู้ทำรายการ และ request key จะถูกบันทึกใน Audit Log</span></span></label>}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" disabled={busy} onClick={closeCreate} className="min-h-12 rounded-2xl border border-slate-300 bg-white text-sm font-bold text-slate-700 disabled:opacity-40">ยกเลิก</button><button disabled={busy||!canSave} onClick={save} className="min-h-12 rounded-2xl bg-[#d4af37] text-sm font-bold text-black disabled:opacity-40">{busy?"กำลังบันทึก...":"ยืนยันค่าใช้จ่าย"}</button></div>
      <p className="mt-3 text-center text-[10px] text-slate-400">กันบันทึกซ้ำด้วย request key เดิม หากเน็ตสะดุดให้กดรายการเดิมซ้ำได้อย่างปลอดภัย</p>
    </div></div>}
  </section>
}
