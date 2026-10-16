"use client";
import {useEffect,useRef,useState} from "react";
import {Plus,Trash2,X} from "lucide-react";
import AuthGate from "@/components/auth-gate";
import ModalFocus from "@/components/modal-focus";
import {api,type Session} from "@/lib/api-client";
import {readExpenseIntent,prepareExpenseIntent,sendExpenseIntent,type ExpenseIntent} from "@/lib/expense-recovery";
import {prepareExpenseDeleteIntent,readExpenseDeleteIntent,sendExpenseDeleteIntent,type ExpenseDeleteIntent} from "@/lib/expense-delete-recovery";

type E={id:string;date:string;time:number;category:string;description:string;amount:number;paymentMethod?:string;sourceType?:string;createdBy?:string;requestKey?:string};
type Shift={id:string;date:string;status:"open"|"closed";openingCash:number};
type DrawerSnapshot={openingCash:number;cashSales:number;cashIn:number;cashPaidOut:number;cashOut:number;availableCash:number};
type ExpenseData={expenses:E[];businessDate:string;shift:Shift|null;drawerSnapshot:DrawerSnapshot|null};

const paymentLabel=(v?:string)=>v==="cash"?"เงินสด":v==="bank"?"โอน/ธนาคาร":v==="noncash"?"ไม่ใช่เงินสด":v==="other"?"อื่น ๆ":"ไม่ระบุ";
const newRequestKey=()=>`expense:${typeof crypto!=="undefined"&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+"-"+Math.random().toString(36).slice(2)}`;

export default function Expenses(){return <AuthGate>{s=><View session={s}/>}</AuthGate>}

function View({session}:{session:Session}){
  const [rows,setRows]=useState<E[]>([]),[businessDate,setBusinessDate]=useState(""),[shift,setShift]=useState<Shift|null>(null),[drawerSnapshot,setDrawerSnapshot]=useState<DrawerSnapshot|null>(null),[open,setOpen]=useState(false),[amount,setAmount]=useState(""),[category,setCategory]=useState("OTHER"),[description,setDescription]=useState(""),[paymentMethod,setPaymentMethod]=useState("cash"),[requestKey,setRequestKey]=useState(""),[riskConfirmed,setRiskConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [pending,setPending]=useState<ExpenseIntent|null>(null),[recoveryBlocked,setRecoveryBlocked]=useState(false),[pendingDelete,setPendingDelete]=useState<ExpenseDeleteIntent|null>(null),[deleteRecoveryBlocked,setDeleteRecoveryBlocked]=useState(false);
  const savingRef=useRef(false),deleteSavingRef=useRef(false);
  const load=()=>api<ExpenseData>("/api/expenses").then(x=>{setRows(x.expenses||[]);setBusinessDate(x.businessDate||"");setShift(x.shift||null);setDrawerSnapshot(x.drawerSnapshot||null)});
  useEffect(()=>{
    load().catch(()=>{});
    try{setPending(readExpenseIntent(session.user.id))}catch{setRecoveryBlocked(true);setError("อ่านรายการค้างไม่ได้ · ยังไม่ส่งค่าใช้จ่ายใหม่ กรุณาตรวจพื้นที่เก็บข้อมูลและให้เจ้าของร้านตรวจรายการเดิม")}
    try{setPendingDelete(readExpenseDeleteIntent(session.user.id))}catch{setDeleteRecoveryBlocked(true);setError("อ่านสถานะการลบรายการเดิมไม่ได้ · ห้ามลบหรือเพิ่มรายการใหม่จนกว่าจะตรวจ recovery storage ได้")}
  },[session.user.id]);
  useEffect(()=>{
    let disposed=false,retryTimer:number|undefined;
    const reconnect=()=>{
      if(disposed)return;
      const writeSettling=savingRef.current||(session.user.role==="admin"&&deleteSavingRef.current);
      if(writeSettling){
        if(retryTimer===undefined)retryTimer=window.setTimeout(()=>{retryTimer=undefined;reconnect()},100);
        return;
      }
      try{const intent=readExpenseIntent(session.user.id);if(intent)save(intent).catch(()=>{})}catch{setRecoveryBlocked(true)}
      if(session.user.role==="admin"){
        try{const intent=readExpenseDeleteIntent(session.user.id);if(intent)recoverDelete(intent).catch(()=>{})}catch{setDeleteRecoveryBlocked(true)}
      }
    };
    const visible=()=>{if(document.visibilityState==="visible")reconnect()};
    reconnect();
    window.addEventListener("online",reconnect);
    window.addEventListener("focus",reconnect);
    document.addEventListener("visibilitychange",visible);
    return()=>{
      disposed=true;
      if(retryTimer!==undefined)window.clearTimeout(retryTimer);
      window.removeEventListener("online",reconnect);
      window.removeEventListener("focus",reconnect);
      document.removeEventListener("visibilitychange",visible);
    };
  },[session.user.id,session.user.role,session.csrf]);
  const amountNumber=Number(amount)||0;
  const isCash=paymentMethod==="cash";
  const currentDrawerCash=Number(drawerSnapshot?.availableCash||0);
  const cashShiftReady=!!shift&&shift.status==="open";
  const cashTooLarge=isCash&&amountNumber>currentDrawerCash;
  const highRisk=isCash&&amountNumber>=500;
  const afterDrawerCash=currentDrawerCash-amountNumber;
  const canSave=!!businessDate&&amountNumber>0&&(!isCash||(cashShiftReady&&!cashTooLarge))&&(!highRisk||(riskConfirmed&&description.trim().length>=2));

  function openCreate(){
    if(recoveryBlocked||deleteRecoveryBlocked||pendingDelete)return;
    if(pending){
      setAmount(String(pending.body.amount));setCategory(pending.body.category);setDescription(pending.body.description);setPaymentMethod(pending.body.paymentMethod);setRiskConfirmed(pending.body.riskConfirmed);setRequestKey(pending.body.requestKey);setOpen(true);return;
    }
    setAmount("");setCategory("OTHER");setDescription("");setPaymentMethod("cash");setRiskConfirmed(false);setRequestKey(newRequestKey());setError("");setNotice("");setOpen(true);
  }
  function closeCreate(){if(!busy)setOpen(false)}

  async function save(recovered?:ExpenseIntent){
    if(savingRef.current||recoveryBlocked)return;
    if(!recovered&&!pending&&!canSave)return;
    savingRef.current=true;
    const key=recovered?.body.requestKey||pending?.body.requestKey||requestKey||newRequestKey();
    if(!requestKey)setRequestKey(key);
    setBusy(true);setError("");setNotice("");
    try{
      const intent=recovered||pending||prepareExpenseIntent(session.user.id,{amount:amountNumber,date:businessDate,category,description:description.trim().slice(0,240),paymentMethod,requestKey:key,riskConfirmed});
      setPending(intent);
      const r=await sendExpenseIntent(intent,body=>api<any>("/api/expenses",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)}));
      setPending(null);
      setOpen(false);setAmount("");setDescription("");setPaymentMethod("cash");setRiskConfirmed(false);setRequestKey("");
      setNotice((r.replayed?"รายการนี้ถูกบันทึกไว้แล้ว · ระบบไม่สร้างซ้ำ":"บันทึกค่าใช้จ่ายแล้ว")+(r.availableCash!==null&&r.availableCash!==undefined?" · เงินในลิ้นชักคงเหลือตามระบบ ฿"+Number(r.availableCash).toLocaleString():""));
      await load().catch(()=>setNotice("บันทึกค่าใช้จ่ายแล้ว · โหลดรายการล่าสุดไม่ได้ กรุณารีเฟรช"));
    }catch(e:any){
      const map:Record<string,string>={
        day_closed:"ปิดยอดวันนี้แล้ว ไม่สามารถแก้ไขค่าใช้จ่ายได้",
        cash_shift_not_open:"ยังไม่ได้เปิดกะเงินสดวันนี้ · หากจ่ายจากลิ้นชักต้องเปิดร้านก่อน หรือเลือกโอน/ธนาคาร",
        drawer_cash_shortage:"ยอดเงินในลิ้นชักตามระบบไม่พอสำหรับค่าใช้จ่ายนี้ · กรุณารีเฟรชและตรวจยอดจริง",
        high_risk_confirmation_required:"ค่าใช้จ่ายเงินสดตั้งแต่ ฿500 ต้องยืนยันรายการมูลค่าสูงก่อน",
        expense_reason_required:"รายการเงินสดมูลค่าสูงต้องระบุเหตุผลอย่างน้อย 2 ตัวอักษร",
        request_key_conflict:"พบข้อมูลรายการเดิมไม่ตรงกัน · ระบบยังเก็บรายการไว้ ห้ามเริ่มยอดใหม่ กรุณาให้เจ้าของร้านตรวจประวัติค่าใช้จ่าย",
        network_unavailable:"ยังไม่ทราบผลการบันทึก · ระบบเก็บรายการเดิมไว้แล้ว กรุณาอย่าสร้างรายการใหม่ ระบบจะตรวจให้อัตโนมัติเมื่ออินเทอร์เน็ตกลับมา",
        offline_write_blocked:"ยังไม่ได้ส่งรายการเพราะออฟไลน์ · ระบบเก็บรายการเดิมไว้และจะตรวจเมื่อกลับมาออนไลน์",
        expense_ack_unknown:"ยังยืนยันผลการบันทึกไม่ได้ · ระบบเก็บรายการเดิมไว้ ตรวจรายการเดิมอีกครั้งโดยไม่สร้างยอดใหม่",
        expense_recovery_unavailable:"พื้นที่เก็บรายการค้างใช้ไม่ได้ · ระบบหยุดส่งรายการใหม่ กรุณาให้เจ้าของร้านตรวจรายการก่อน",
        pending_expense_exists:"มีค่าใช้จ่ายเดิมที่ยังไม่ทราบผล · ตรวจรายการเดิมก่อนเริ่มรายการใหม่",
        invalid_request_key:"รหัสกันรายการซ้ำไม่ถูกต้อง · กรุณาปิดหน้าต่างและลองใหม่",
        invalid_expense_payment_method:"ช่องทางการจ่ายไม่ถูกต้อง",
        invalid_expense:"จำนวนเงินหรือข้อมูลค่าใช้จ่ายไม่ถูกต้อง"
      };
      setError(map[e.message]||"บันทึกยังไม่สำเร็จ · ระบบเก็บรายการเดิมไว้ กรุณาตรวจรายการหรือให้เจ้าของร้านช่วย");
      try{setPending(readExpenseIntent(session.user.id))}catch{setRecoveryBlocked(true)}
      await load().catch(()=>{});
    }finally{savingRef.current=false;setBusy(false)}
  }

  function deleteError(code:string){
    const map:Record<string,string>={
      day_closed:"รายการของวันที่ปิดยอดแล้ว ไม่สามารถลบได้",
      system_expense_read_only:"รายการนี้มาจาก Stock/Purchase/Waste ต้องแก้จากต้นทาง ไม่สามารถลบจากค่าใช้จ่ายโดยตรง",
      expense_target_changed:"ข้อมูลรายการเปลี่ยนจากตอนที่ยืนยันลบ · ระบบไม่ได้ลบ กรุณารีเฟรชและตรวจใหม่",
      expense_not_found:"ไม่พบรายการที่จะลบ · ระบบไม่ได้สร้างคำสั่งลบซ้ำ กรุณารีเฟรชประวัติ",
      request_key_conflict:"Request เดิมไม่ตรงกับข้อมูลการลบ · ระบบเก็บรายการไว้ ห้ามสร้างคำสั่งลบใหม่",
      network_unavailable:"ยังไม่ทราบว่ารายจ่ายถูกลบแล้วหรือไม่ · ระบบเก็บ Request เดิมไว้และจะตรวจซ้ำ ห้ามกดลบอีกครั้ง",
      offline_write_blocked:"ยังไม่ได้ส่งคำสั่งลบเพราะออฟไลน์ · ระบบเก็บ Request เดิมไว้และจะตรวจเมื่อออนไลน์",
      expense_delete_ack_unknown:"Server ยังไม่ยืนยันผลการลบครบถ้วน · ระบบเก็บ Request เดิมไว้ ห้ามกดลบซ้ำ",
      expense_delete_recovery_unavailable:"อ่าน/บันทึก recovery การลบไม่ได้ · ระบบหยุดการแก้ไขค่าใช้จ่ายเพื่อป้องกันบัญชีคลาดเคลื่อน",
      pending_expense_delete_exists:"มีคำสั่งลบเดิมที่ยังไม่ทราบผล · ต้องตรวจ Request เดิมก่อน",
      invalid_expense_delete:"ข้อมูลรายการที่จะลบไม่ถูกต้อง"
    };
    return map[code]||"ยังยืนยันผลการลบไม่ได้ · กรุณาตรวจรายการเดิมและให้เจ้าของร้านช่วย";
  }

  async function recoverDelete(intent:ExpenseDeleteIntent){
    if(deleteSavingRef.current||deleteRecoveryBlocked||session.user.role!=="admin")return false;
    deleteSavingRef.current=true;setBusy(true);setError("");setNotice("");
    try{
      const r=await sendExpenseDeleteIntent(intent,body=>api<any>("/api/expenses/"+encodeURIComponent(body.expenseId),{
        method:"DELETE",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)
      }));
      setPendingDelete(null);setDeleteRecoveryBlocked(false);
      setNotice((r.replayed?"ตรวจพบว่ารายการเดิมถูกลบไปแล้ว · ระบบไม่ลบซ้ำ":"ลบรายการค่าใช้จ่ายแล้ว")+" · Audit Log ถูกบันทึก");
      await load().catch(()=>setNotice("ยืนยันการลบแล้ว · โหลดรายการล่าสุดไม่ได้ กรุณารีเฟรช"));
      return true;
    }catch(e:any){
      try{setPendingDelete(readExpenseDeleteIntent(session.user.id))}
      catch{setDeleteRecoveryBlocked(true)}
      setError(deleteError(e.message));
      await load().catch(()=>{});
      return false;
    }finally{deleteSavingRef.current=false;setBusy(false)}
  }

  async function del(row:E){
    if(session.user.role!=="admin"||deleteRecoveryBlocked)return;
    if(pendingDelete){setError("มีคำสั่งลบเดิมที่ยังไม่ทราบผล · ตรวจรายการเดิมก่อน ห้ามลบรายการใหม่");return}
    if(!window.confirm(`ยืนยันลบค่าใช้จ่าย ฿${row.amount.toLocaleString()} · ${row.description||row.category} ?\nระบบจะเก็บ Audit Log การลบไว้`))return;
    setError("");setNotice("");
    try{
      const intent=prepareExpenseDeleteIntent(session.user.id,{requestKey:`expense-delete:${crypto.randomUUID()}`,expenseId:row.id,date:row.date,expectedAmount:Number(row.amount)});
      setPendingDelete(intent);
      await recoverDelete(intent);
    }catch(e:any){
      setError(deleteError(e.message));
      if(e.message==="expense_delete_recovery_unavailable")setDeleteRecoveryBlocked(true);
      try{setPendingDelete(readExpenseDeleteIntent(session.user.id))}catch{setDeleteRecoveryBlocked(true)}
    }
  }

  const purchase=rows.filter(x=>x.category==="PURCHASE").reduce((s,x)=>s+x.amount,0),operating=rows.filter(x=>x.category!=="PURCHASE").reduce((s,x)=>s+x.amount,0),cashOut=rows.filter(x=>x.paymentMethod==="cash").reduce((s,x)=>s+x.amount,0),total=purchase+operating;

  return <section className="soft-scroll h-full overflow-auto p-3 sm:p-5 md:p-7">
    <header className="mb-4 flex items-end justify-between gap-3"><div><p className="gold m-0 text-[10px] font-bold tracking-[.3em]">COST CONTROL</p><h1 className="mt-1 text-xl font-semibold sm:text-2xl">ค่าใช้จ่าย</h1><p className="mt-1 text-xs text-slate-500">แยกเงินสดหน้าร้านออกจากโอน/ธนาคาร · รายการเงินสดตรวจยอดลิ้นชักจาก Server ก่อนบันทึก</p></div><button disabled={busy||recoveryBlocked||deleteRecoveryBlocked||!!pendingDelete} onClick={openCreate} className="flex min-h-11 items-center gap-2 rounded-full bg-[#d4af37] px-4 text-sm font-bold text-black"><Plus size={16}/>{pending?"ตรวจรายการค้าง":"เพิ่ม"}</button></header>

    {error&&<p role="alert" className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {pending&&<div role="status" className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><b>มีค่าใช้จ่าย ฿{pending.body.amount.toLocaleString()} ที่ยังต้องยืนยันผล</b><p className="mt-1">{pending.body.description||pending.body.category} · {paymentLabel(pending.body.paymentMethod)} · อย่าสร้างรายการใหม่ ระบบจะใช้รายการเดิมตรวจผล</p><button disabled={busy||recoveryBlocked} onClick={()=>save(pending)} className="mt-2 min-h-11 rounded-xl border border-amber-300 bg-white px-4 font-bold disabled:opacity-40">{busy?"กำลังตรวจรายการเดิม...":"ตรวจผลรายการเดิม"}</button></div>}
    {pendingDelete&&<div role="status" className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-900"><b>ยังไม่ทราบว่ารายจ่าย ฿{pendingDelete.body.expectedAmount.toLocaleString()} ถูกลบแล้วหรือไม่</b><p className="mt-1">วันที่ {pendingDelete.body.date} · Request …{pendingDelete.body.requestKey.slice(-8)} · ระบบล็อกการเพิ่ม/ลบค่าใช้จ่ายใหม่จนกว่าจะยืนยันผลเดิม</p><button disabled={busy||deleteRecoveryBlocked} onClick={()=>recoverDelete(pendingDelete)} className="mt-2 min-h-11 rounded-xl border border-red-300 bg-white px-4 font-bold disabled:opacity-40">{busy?"กำลังตรวจผลการลบ...":"ตรวจผลการลบเดิม"}</button></div>}
    {deleteRecoveryBlocked&&<p role="alert" className="mb-3 rounded-2xl border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-800">Recovery การลบค่าใช้จ่ายอ่านไม่ได้ · ระบบหยุดการเพิ่ม/ลบรายการเพื่อป้องกันบัญชีคลาดเคลื่อน กรุณาให้เจ้าของร้านตรวจเครื่องนี้</p>}
    {notice&&<p role="status" className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

    <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
      <div className="glass card p-4"><small className="text-slate-500">Operating Expenses</small><div className="mt-1 text-xl">฿{operating.toLocaleString()}</div></div>
      <div className="glass card p-4"><small className="text-slate-500">Purchase Spend</small><div className="mt-1 text-xl">฿{purchase.toLocaleString()}</div></div>
      <div className="glass card p-4"><small className="text-slate-500">จ่ายสดจากลิ้นชัก</small><div className="mt-1 text-xl text-red-600">฿{cashOut.toLocaleString()}</div></div>
      <div className="glass card p-4"><small className="text-slate-500">Cash Out ทั้งหมด</small><div className="mt-1 text-xl gold">฿{total.toLocaleString()}</div></div>
      <div className="glass card col-span-2 p-4 lg:col-span-1"><small className="text-slate-500">ลิ้นชักตามระบบ · {businessDate||"วันนี้"}</small><div className={"mt-1 text-xl "+(cashShiftReady?"text-slate-900":"text-amber-700")}>{cashShiftReady?"฿"+currentDrawerCash.toLocaleString():"ยังไม่เปิดร้าน"}</div></div>
    </div>

    <div className="glass card soft-scroll overflow-auto p-2"><table className="w-full min-w-[720px] text-sm"><thead className="sticky top-0 bg-slate-50 text-left text-[10px] uppercase tracking-widest text-slate-500"><tr><th className="p-4">Date</th><th>Category</th><th>Description</th><th>Payment</th><th>Amount</th><th></th></tr></thead><tbody>{rows.map(x=>{const system=String(x.sourceType||"").startsWith("STOCK_")||["PURCHASE","WASTE"].includes(String(x.category||"").toUpperCase());return <tr key={x.id} className="border-t border-slate-100"><td className="p-4">{x.date}</td><td>{x.category}</td><td className="text-slate-600">{x.description||"—"}</td><td>{paymentLabel(x.paymentMethod)}</td><td className="gold">฿{x.amount.toLocaleString(undefined,{maximumFractionDigits:2})}</td><td>{session.user.role==="admin"&&!system&&<button aria-label="ลบค่าใช้จ่าย" disabled={busy||!!pending||recoveryBlocked||!!pendingDelete||deleteRecoveryBlocked} onClick={()=>del(x)} className="grid h-11 w-11 place-items-center rounded-xl text-red-600 hover:bg-red-50"><Trash2 size={15}/></button>}</td></tr>})}</tbody></table></div>

    {open&&<div className="field-modal-overlay fixed inset-0 z-[80] flex items-end justify-center bg-black/35 backdrop-blur-[2px] sm:items-center" onMouseDown={closeCreate}><ModalFocus labelId="expense-dialog-title" onEscape={busy?undefined:closeCreate} className="field-modal-panel soft-scroll w-full max-w-lg overflow-y-auto rounded-t-[28px] bg-white p-4 shadow-2xl sm:rounded-[28px] sm:p-5"><div onMouseDown={e=>e.stopPropagation()}>
      <div className="flex items-start justify-between gap-3"><div><p className="m-0 text-[10px] font-black tracking-[.2em] text-[#765b08]">GUIDED EXPENSE CONTROL</p><h2 id="expense-dialog-title" className="mt-1 text-xl font-bold">{pending?"ตรวจค่าใช้จ่ายเดิม":"เพิ่มค่าใช้จ่าย"}</h2><p className="mt-1 text-xs text-slate-500">เลือกช่องทางให้ตรงกับเงินจริง · ถ้าเป็นเงินสด ระบบจะตรวจยอดลิ้นชักซ้ำตอนกดยืนยัน</p></div><button disabled={busy} aria-label="ปิดหน้าต่างค่าใช้จ่าย" onClick={closeCreate} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white disabled:opacity-40"><X size={18}/></button></div>

      {pending&&<p role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">กำลังรอยืนยันรายการเดิม · ระบบเก็บข้อมูลไว้แล้ว กรุณาตรวจผลโดยไม่สร้างรายการใหม่ ยอดลิ้นชักอาจรวมรายการนี้แล้วจึงยังไม่คำนวณหักซ้ำ</p>}
      {error&&<p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-slate-100 p-1">
        <button type="button" disabled={busy||!!pending} onClick={()=>{setPaymentMethod("cash");setRiskConfirmed(false)}} className={"min-h-11 rounded-xl text-xs font-bold "+(paymentMethod==="cash"?"bg-white text-red-600 shadow-sm":"text-slate-600")}>เงินสดจากลิ้นชัก</button>
        <button type="button" disabled={busy||!!pending} onClick={()=>{setPaymentMethod("bank");setRiskConfirmed(false)}} className={"min-h-11 rounded-xl text-xs font-bold "+(paymentMethod==="bank"?"bg-white text-slate-900 shadow-sm":"text-slate-600")}>โอน/ธนาคาร</button>
        <button type="button" disabled={busy||!!pending} onClick={()=>{setPaymentMethod("other");setRiskConfirmed(false)}} className={"min-h-11 rounded-xl text-xs font-bold "+(paymentMethod==="other"?"bg-white text-slate-900 shadow-sm":"text-slate-600")}>อื่น ๆ</button>
      </div>

      {isCash&&!pending&&<div className="mt-4">
        {!cashShiftReady?<div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><b>ยังไม่เปิดกะเงินสด</b><div className="mt-1 text-xs">ไม่อนุญาตให้บันทึกค่าใช้จ่ายจากลิ้นชักจนกว่าจะเปิดร้าน หากจ่ายจากบัญชีให้เลือก “โอน/ธนาคาร”</div></div>:<div className="grid grid-cols-2 gap-2 text-center"><div className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><small className="text-slate-500">ก่อนจ่าย</small><div className="mt-1 text-lg font-semibold">฿{currentDrawerCash.toLocaleString()}</div></div><div className={"rounded-2xl border p-3 "+(cashTooLarge?"border-red-200 bg-red-50":"border-slate-200 bg-slate-50")}><small className="text-slate-500">หลังจ่าย</small><div className={"mt-1 text-lg font-semibold "+(cashTooLarge?"text-red-600":"text-slate-900")}>฿{afterDrawerCash.toLocaleString()}</div></div></div>}
      </div>}

      <div className="mt-4 grid gap-3">
        <select disabled={busy||!!pending} aria-label="หมวดค่าใช้จ่าย" value={category} onChange={e=>setCategory(e.target.value)} className="min-h-12 rounded-2xl border border-slate-200 bg-white px-4"><option value="OTHER">อื่น ๆ</option><option value="UTILITY">ค่าน้ำ/ไฟ/สาธารณูปโภค</option><option value="MAINTENANCE">ซ่อมบำรุง</option><option value="PACKAGING">บรรจุภัณฑ์ฉุกเฉิน</option><option value="MARKETING">การตลาด</option><option value="TRANSPORT">เดินทาง/ขนส่ง</option></select>
        <label className="text-sm"><span className="font-semibold text-slate-700">จำนวนเงิน</span><input disabled={busy||!!pending} autoFocus inputMode="decimal" value={amount} onChange={e=>{setAmount(e.target.value);setRiskConfirmed(false)}} placeholder="0" className="mt-2 min-h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-lg font-semibold outline-none"/></label>
        {cashTooLarge&&!pending&&<div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">เงินในลิ้นชักตามระบบไม่พอ · ปุ่มบันทึกถูกปิดเพื่อกันยอดติดลบ</div>}
        <label className="text-sm"><span className="font-semibold text-slate-700">รายละเอียด / เหตุผล</span><input disabled={busy||!!pending} maxLength={240} value={description} onChange={e=>setDescription(e.target.value)} placeholder="เช่น ค่าจอดรถ / ซื้อบรรจุภัณฑ์ฉุกเฉิน" className="mt-2 min-h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 outline-none"/></label>
        {highRisk&&<label className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><input disabled={busy||!!pending} type="checkbox" checked={riskConfirmed} onChange={e=>setRiskConfirmed(e.target.checked)} className="mt-1 h-4 w-4"/><span><b>ยืนยันรายจ่ายเงินสดมูลค่าสูง</b><br/><span className="text-xs">ยืนยันค่าใช้จ่ายเงินสดตั้งแต่ ฿500 ขึ้นไป และเข้าใจว่าจำนวนเงิน เหตุผล ผู้ทำรายการ จะถูกเก็บในประวัติระบบ</span></span></label>}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" disabled={busy} onClick={closeCreate} className="min-h-12 rounded-2xl border border-slate-300 bg-white text-sm font-bold text-slate-700 disabled:opacity-40">{pending?"ปิดหน้าต่าง · เก็บรายการไว้":"ยกเลิก"}</button><button disabled={busy||recoveryBlocked||(!pending&&!canSave)} onClick={()=>save()} className="min-h-12 rounded-2xl bg-[#d4af37] text-sm font-bold text-black disabled:opacity-40">{busy?"กำลังตรวจและบันทึก...":pending?"ตรวจผลรายการเดิม":"ยืนยันค่าใช้จ่าย"}</button></div>
      <p className="mt-3 text-center text-[10px] text-slate-400">หากยังไม่ทราบผล ระบบจะเก็บข้อมูลเดิมไว้จนตรวจยืนยันได้ แม้ปิดหน้าต่างหรือโหลดหน้าใหม่</p>
    </div></ModalFocus></div>}
  </section>
}
