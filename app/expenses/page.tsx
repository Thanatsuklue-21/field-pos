"use client";
import {useEffect,useState} from "react";
import {Plus,Trash2,X} from "lucide-react";
import AuthGate from "@/components/auth-gate";
import {api,type Session} from "@/lib/api-client";

type E={id:string;date:string;time:number;category:string;description:string;amount:number;paymentMethod?:string;sourceType?:string;createdBy?:string};
const paymentLabel=(v?:string)=>v==="cash"?"เงินสด":v==="bank"?"โอน/ธนาคาร":v==="noncash"?"ไม่ใช่เงินสด":v==="other"?"อื่น ๆ":"ไม่ระบุ";

export default function Expenses(){return <AuthGate>{s=><View session={s}/>}</AuthGate>}

function View({session}:{session:Session}){
  const [rows,setRows]=useState<E[]>([]),[open,setOpen]=useState(false),[amount,setAmount]=useState(""),[category,setCategory]=useState("OTHER"),[description,setDescription]=useState(""),[paymentMethod,setPaymentMethod]=useState("cash"),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const load=()=>api<{expenses:E[]}>("/api/expenses").then(x=>setRows(x.expenses));
  useEffect(()=>{load().catch(()=>{})},[]);
  async function save(){
    setBusy(true);setError("");
    try{
      await api("/api/expenses",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({amount:Number(amount),category,description,paymentMethod})});
      setOpen(false);setAmount("");setDescription("");setPaymentMethod("cash");await load();
    }catch(e:any){setError(e.message==="day_closed"?"ปิดยอดวันนี้แล้ว ไม่สามารถแก้ไขค่าใช้จ่ายได้":e.message)}
    finally{setBusy(false)}
  }
  async function del(row:E){
    if(session.user.role!=="admin")return;
    setError("");
    try{await api("/api/expenses/"+encodeURIComponent(row.id),{method:"DELETE",headers:{"X-CSRF-Token":session.csrf}});await load()}
    catch(e:any){setError(e.message==="day_closed"?"รายการของวันที่ปิดยอดแล้ว ไม่สามารถลบได้":e.message==="system_expense_read_only"?"รายการนี้มาจาก Stock/Purchase/Waste ต้องแก้จากต้นทาง ไม่สามารถลบจากค่าใช้จ่ายโดยตรง":e.message)}
  }
  const purchase=rows.filter(x=>x.category==="PURCHASE").reduce((s,x)=>s+x.amount,0),operating=rows.filter(x=>x.category!=="PURCHASE").reduce((s,x)=>s+x.amount,0),cashOut=rows.filter(x=>x.paymentMethod==="cash").reduce((s,x)=>s+x.amount,0),total=purchase+operating;
  return <section className="soft-scroll h-full overflow-auto p-3 sm:p-5 md:p-7">
    <header className="mb-4 flex items-end justify-between gap-3"><div><p className="gold m-0 text-[10px] font-bold tracking-[.3em]">COST CONTROL</p><h1 className="mt-1 text-xl font-semibold sm:text-2xl">EXPENSES</h1><p className="mt-1 text-xs text-slate-500">แยกเงินสดหน้าร้านออกจากโอน/ธนาคาร เพื่อปิดยอดลิ้นชักให้ตรง</p></div><button onClick={()=>setOpen(true)} className="flex min-h-11 items-center gap-2 rounded-full bg-[#d4af37] px-4 text-sm font-bold text-black"><Plus size={16}/>เพิ่ม</button></header>
    {error&&<p role="alert" className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4"><div className="glass card p-4"><small className="text-slate-500">Operating Expenses</small><div className="mt-1 text-xl">฿{operating.toLocaleString()}</div></div><div className="glass card p-4"><small className="text-slate-500">Purchase Spend</small><div className="mt-1 text-xl">฿{purchase.toLocaleString()}</div></div><div className="glass card p-4"><small className="text-slate-500">จ่ายสดจากลิ้นชัก</small><div className="mt-1 text-xl text-red-600">฿{cashOut.toLocaleString()}</div></div><div className="glass card p-4"><small className="text-slate-500">Cash Out ทั้งหมด</small><div className="mt-1 text-xl gold">฿{total.toLocaleString()}</div></div></div>
    <div className="glass card soft-scroll overflow-auto p-2"><table className="w-full min-w-[720px] text-sm"><thead className="sticky top-0 bg-slate-50 text-left text-[10px] uppercase tracking-widest text-slate-500"><tr><th className="p-4">Date</th><th>Category</th><th>Description</th><th>Payment</th><th>Amount</th><th></th></tr></thead><tbody>{rows.map(x=>{const system=String(x.sourceType||"").startsWith("STOCK_")||["PURCHASE","WASTE"].includes(String(x.category||"").toUpperCase());return <tr key={x.id} className="border-t border-slate-100"><td className="p-4">{x.date}</td><td>{x.category}</td><td className="text-slate-600">{x.description||"—"}</td><td>{paymentLabel(x.paymentMethod)}</td><td className="gold">฿{x.amount.toLocaleString(undefined,{maximumFractionDigits:2})}</td><td>{session.user.role==="admin"&&!system&&<button onClick={()=>del(x)} className="text-red-600"><Trash2 size={15}/></button>}</td></tr>})}</tbody></table></div>
    {open&&<div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-3"><div className="glass card w-full max-w-md p-5 sm:p-6"><div className="flex justify-between"><div><h3 className="text-xl">เพิ่มค่าใช้จ่าย</h3><p className="mt-1 text-xs text-slate-500">ถ้าจ่ายจากเงินในลิ้นชัก เลือก “เงินสด” เพื่อให้ Close Day หักอัตโนมัติ</p></div><button onClick={()=>setOpen(false)}><X/></button></div><div className="mt-5 grid gap-3"><select value={category} onChange={e=>setCategory(e.target.value)} className="rounded-2xl border border-slate-200 bg-white px-4 py-3"><option value="OTHER">อื่น ๆ</option><option value="UTILITY">ค่าน้ำ/ไฟ/สาธารณูปโภค</option><option value="MAINTENANCE">ซ่อมบำรุง</option><option value="PACKAGING">บรรจุภัณฑ์ฉุกเฉิน</option><option value="MARKETING">การตลาด</option><option value="TRANSPORT">เดินทาง/ขนส่ง</option></select><select value={paymentMethod} onChange={e=>setPaymentMethod(e.target.value)} className="rounded-2xl border border-slate-200 bg-white px-4 py-3"><option value="cash">เงินสดจากลิ้นชัก</option><option value="bank">โอน/บัญชีธนาคาร</option><option value="other">ช่องทางอื่น</option></select><input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="จำนวนเงิน" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none"/><input value={description} onChange={e=>setDescription(e.target.value)} placeholder="รายละเอียด เช่น ค่าจอดรถ / ซื้อน้ำแข็งฉุกเฉิน" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none"/><button disabled={busy||!(Number(amount)>0)} onClick={save} className="min-h-12 rounded-full bg-[#d4af37] font-bold text-black disabled:opacity-40">SAVE</button></div></div></div>}
  </section>
}
