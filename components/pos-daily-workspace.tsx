"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import Link from "next/link";
import {BellRing,Bot,Boxes,CheckCircle2,ClipboardList,ListOrdered,ReceiptText,RefreshCw,ShieldCheck,X} from "lucide-react";
import {api,type Bootstrap,type Session} from "@/lib/api-client";
import {prepareExpenseIntent,readExpenseIntent,sendExpenseIntent,type ExpenseIntent} from "@/lib/expense-recovery";
import {prepareCashShiftOpenIntent,readCashShiftOpenIntent,sendCashShiftOpenIntent,type CashShiftOpenIntent} from "@/lib/cash-shift-open-recovery";
import {chooseWorkspaceNextAction} from "@/lib/workspace-guidance.mjs";
import {orderStatusLabel,paymentSummaryLabel,saleStatusLabel} from "@/lib/operator-labels.mjs";
import {useQueueActionRecovery} from "@/lib/use-queue-action-recovery";

type WorkspaceTab="queue"|"orders"|"stock"|"expense"|"status";
type QueueOrder={
  id:string;queueNo:string;pagerNo:number;status:string;time:number;
  items:Array<{name:string;qty:number;readyQty?:number;calledQty?:number}>;
};
type Sale={
  id:string;billNo?:string;date:string;time:number;total:number;payment:string;paymentMethods?:string[];
  status:string;queueNo?:string;itemCount:number;orderStatus?:string|null;
  items?:Array<{id:string;name:string;variant?:string;qty:number;price:number}>;
};
type Readiness={
  status:"READY"|"WARN"|"BLOCKED";score:number;
  summary:{total:number;ready:number;warn:number;blocked:number};
  checks:Array<{id:string;label:string;status:"READY"|"WARN"|"BLOCKED";message:string}>;
  nextActions:Array<{priority:"P0"|"P1"|"P2";checkId:string;label:string}>;
};
type ControlAnalysis={level:string;metrics?:Record<string,number>;readiness?:Readiness};
type ExpenseRow={id:string;date:string;time:number;category:string;description:string;amount:number;paymentMethod?:string};
type ExpenseData={
  expenses:ExpenseRow[];businessDate:string;
  shift:{id:string;date:string;status:"open"|"closed";openingCash:number}|null;
  drawerSnapshot:{openingCash:number;cashSales:number;cashIn:number;cashPaidOut:number;cashOut:number;availableCash:number}|null;
};
const newExpenseRequestKey=()=>`expense:${typeof crypto!=="undefined"&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+"-"+Math.random().toString(36).slice(2)}`;

const n=(value:any)=>Number(value)||0;
const money=(value:any)=>new Intl.NumberFormat("th-TH",{minimumFractionDigits:0,maximumFractionDigits:2}).format(n(value));
const readinessLabel=(value:string)=>value==="READY"?"พร้อม":value==="WARN"?"มีจุดต้องดู":"ต้องแก้ก่อน";
const checkStatusLabel=(value:string)=>value==="READY"?"พร้อม":value==="WARN"?"เตือน":"ต้องแก้";
const queueOrderReady=(order:QueueOrder)=>(order.items||[]).length>0&&(order.items||[]).every(item=>n(item.readyQty)>=n(item.qty));
const queueOrderCalled=(order:QueueOrder)=>(order.items||[]).length>0&&(order.items||[]).every(item=>n(item.calledQty)>=n(item.qty));
function queueActionError(code:string){
  return code==="fifo_violation"?"ต้องทำคิวก่อนหน้าให้เสร็จก่อน":
    code==="order_not_ready"?"ยังทำเครื่องดื่มไม่ครบ จึงยังเรียกลูกค้าไม่ได้":
    code==="order_not_complete"?"ยังเรียกลูกค้าไม่ครบ จึงยังบันทึกว่าส่งมอบไม่ได้":
    code==="pending_queue_action_exists"?"มีปุ่มคิวก่อนหน้าที่ยังไม่ทราบผล · ระบบจะตรวจรายการเดิมก่อน":
    code==="queue_action_ack_unknown"||code==="queue_action_result_unknown"||code==="network_unavailable"||code==="offline_write_blocked"?"ยังไม่ทราบผลของปุ่มก่อนหน้า · ไม่ต้องกดซ้ำ ระบบจะตรวจรายการเดิม":
    code==="queue_action_recovery_unavailable"?"ระบบป้องกันการกดซ้ำใช้งานไม่ได้ · ปิดปุ่มคิวชั่วคราว":
    code==="queue_action_busy"?"กำลังตรวจปุ่มคิวก่อนหน้า":
    "ทำรายการคิวไม่สำเร็จ · เปิดโหมดทำเครื่องดื่มเพื่อตรวจ";
}

export default function PosDailyWorkspace({
  session,bootstrap,open,online,onClose
}:{
  session:Session;bootstrap:Bootstrap|null;open:boolean;online:boolean;onClose:()=>void
}){
  const canQueue=session.user.role==="admin"||session.user.permissions?.queue===true;
  const canOrder=session.user.role==="admin"||session.user.permissions?.order===true;
  const canStock=session.user.role==="admin"||session.user.permissions?.stock===true;
  const canExpense=session.user.role==="admin"||session.user.permissions?.report===true;
  const canStatus=session.user.role==="admin";
  const tabs=useMemo(()=>[
    canQueue&&"queue",canOrder&&"orders",canStock&&"stock",canExpense&&"expense",canStatus&&"status"
  ].filter(Boolean) as WorkspaceTab[],[canQueue,canOrder,canStock,canExpense,canStatus]);

  const [tab,setTab]=useState<WorkspaceTab>(tabs[0]||"orders");
  const [queue,setQueue]=useState<QueueOrder[]>([]);
  const [sales,setSales]=useState<Sale[]>([]);
  const [control,setControl]=useState<ControlAnalysis|null>(null);
  const [expenseData,setExpenseData]=useState<ExpenseData|null>(null);
  const [expenseAmount,setExpenseAmount]=useState("");
  const [expenseCategory,setExpenseCategory]=useState("OTHER");
  const [expenseDescription,setExpenseDescription]=useState("");
  const [expensePaymentMethod,setExpensePaymentMethod]=useState("cash");
  const [expenseRiskConfirmed,setExpenseRiskConfirmed]=useState(false);
  const [pendingExpense,setPendingExpense]=useState<ExpenseIntent|null>(null);
  const [expenseRecoveryBlocked,setExpenseRecoveryBlocked]=useState(false);
  const [expenseFeedback,setExpenseFeedback]=useState("");
  const [openingCash,setOpeningCash]=useState("0");
  const [pendingOpenShift,setPendingOpenShift]=useState<CashShiftOpenIntent|null>(null);
  const [startDayRecoveryBlocked,setStartDayRecoveryBlocked]=useState(false);
  const [startDayFeedback,setStartDayFeedback]=useState("");
  const expenseSavingRef=useRef(false);
  const startDaySavingRef=useRef(false);
  const autoRouteRef=useRef(false);
  const manualTabRef=useRef(false);
  const dialogRef=useRef<HTMLElement|null>(null);
  const closeButtonRef=useRef<HTMLButtonElement|null>(null);
  const startDayCardRef=useRef<HTMLDivElement|null>(null);
  const openingCashRef=useRef<HTMLInputElement|null>(null);
  const [busy,setBusy]=useState(false);
  const [workspaceReady,setWorkspaceReady]=useState(false);
  const [message,setMessage]=useState("");
  const [queueFeedback,setQueueFeedback]=useState("");

  useEffect(()=>{
    if(!tabs.includes(tab)&&tabs[0])setTab(tabs[0]);
  },[tabs.join("|"),tab]);

  const {
    pending:pendingQueueAction,
    blocked:queueRecoveryBlocked,
    recovering:queueRecoveryBusy,
    locked:queueActionLocked,
    send:sendQueueAction,
    recover:recoverQueueAction
  }=useQueueActionRecovery({
    session,
    enabled:open&&canQueue&&online,
    onRecovered:result=>{
      if(Array.isArray(result?.orders))setQueue(result.orders);
      setQueueFeedback("ตรวจปุ่มคิวก่อนหน้าแล้ว · ระบบไม่ทำรายการซ้ำ");
    },
    onRecoveryError:error=>setQueueFeedback(queueActionError(error?.message||"queue_action_result_unknown"))
  });

  async function runQueueTailAction(order:QueueOrder,action:"call"|"return"){
    if(!online||queueActionLocked||busy)return;
    setQueueFeedback("");
    try{
      const result=await sendQueueAction({requestKey:crypto.randomUUID(),orderId:order.id,action});
      if(Array.isArray(result?.orders))setQueue(result.orders);
      setQueueFeedback(action==="call"?"เรียกลูกค้าแล้ว · รอส่งมอบเมื่อรับเครื่องดื่ม":"บันทึกส่งมอบแล้ว · ไปคิวถัดไปได้");
    }catch(error:any){
      setQueueFeedback(queueActionError(error?.message||"queue_action_result_unknown"));
    }
  }


  useEffect(()=>{
    if(!open)return;
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const frame=requestAnimationFrame(()=>closeButtonRef.current?.focus());
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){event.preventDefault();onClose();return}
      if(event.key!=="Tab"||!dialogRef.current)return;
      const focusable=Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
      )).filter(node=>node.offsetParent!==null);
      if(!focusable.length){event.preventDefault();return}
      const first=focusable[0],last=focusable[focusable.length-1],active=document.activeElement;
      if(event.shiftKey&&active===first){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&active===last){event.preventDefault();first.focus()}
    };
    document.addEventListener("keydown",onKey);
    return()=>{
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown",onKey);
      previous?.focus();
    };
  },[open]);

  async function refresh(){
    if(!online){
      setMessage("เน็ตหลุด · ยังดูสัญญาณสต็อกจากข้อมูลล่าสุดได้ แต่คิว ออเดอร์ และสถานะระบบต้องรอเชื่อมต่อ");
      return;
    }
    setBusy(true);setMessage("");
    try{
      const jobs:Array<{key:"queue"|"orders"|"expense"|"status";promise:Promise<any>}>= [];
      if(canQueue)jobs.push({key:"queue",promise:api<any>("/api/pos/queue")});
      if(canOrder)jobs.push({key:"orders",promise:api<any>("/api/pos/history")});
      if(canExpense)jobs.push({key:"expense",promise:api<any>("/api/expenses")});
      if(canStatus)jobs.push({key:"status",promise:api<any>("/api/control-center")});
      const results=await Promise.allSettled(jobs.map(x=>x.promise));
      results.forEach((result,index)=>{
        if(result.status!=="fulfilled")return;
        const key=jobs[index].key,value=result.value;
        if(key==="queue")setQueue(Array.isArray(value.orders)?value.orders:[]);
        if(key==="orders")setSales(Array.isArray(value.sales)?value.sales:[]);
        if(key==="expense")setExpenseData({
          expenses:Array.isArray(value.expenses)?value.expenses:[],
          businessDate:String(value.businessDate||""),
          shift:value.shift||null,
          drawerSnapshot:value.drawerSnapshot||null
        });
        if(key==="status")setControl(value.analysis||null);
      });
      if(results.some(x=>x.status==="rejected"))setMessage("บางข้อมูลโหลดไม่ได้ แต่หน้า POS และตะกร้ายังใช้งานต่อได้ตามปกติ");
    }catch{
      setMessage("โหลดงานร้านไม่สำเร็จ · หน้า POS ยังใช้งานต่อได้ตามปกติ");
    }finally{setBusy(false)}
  }

  useEffect(()=>{
    if(!open){
      setWorkspaceReady(false);
      return;
    }
    let active=true;
    setWorkspaceReady(false);
    refresh().catch(()=>{}).finally(()=>{if(active)setWorkspaceReady(true)});
    if(canExpense){
      try{
        setPendingExpense(readExpenseIntent(session.user.id));
        setExpenseRecoveryBlocked(false);
      }catch{
        setExpenseRecoveryBlocked(true);
        setExpenseFeedback("อ่านข้อมูลค่าใช้จ่ายค้างไม่ได้ · ระบบปิดรายจ่ายด่วนชั่วคราวเพื่อป้องกันยอดซ้ำ");
      }
    }
    return()=>{active=false};
  },[open]);

  useEffect(()=>{
    if(!open)return;
    const refreshOnFocus=()=>refresh().catch(()=>{});
    window.addEventListener("focus",refreshOnFocus);
    window.addEventListener("online",refreshOnFocus);
    return()=>{
      window.removeEventListener("focus",refreshOnFocus);
      window.removeEventListener("online",refreshOnFocus);
    };
  },[open,online,session.csrf]);

  function startDayError(code:string){
    const map:Record<string,string>={
      invalid_request_key:"รหัสกันรายการซ้ำไม่ถูกต้อง",
      invalid_date:"วันทำการไม่ถูกต้อง · รีเฟรชก่อนเปิดร้าน",
      invalid_opening_cash:"เงินตั้งต้นต้องไม่ติดลบและไม่เกิน 2 ตำแหน่งทศนิยม",
      business_date_changed:"วันทำการเปลี่ยนแล้ว · รายการเดิมไม่ได้ถูกสร้างใหม่ กรุณารีเฟรชแล้วเปิดวันใหม่",
      cash_shift_already_opened:"วันนี้เปิดร้านแล้ว · ระบบจะโหลดข้อมูลล่าสุด",
      day_already_closed:"วันนี้ปิดยอดแล้ว · ไม่สามารถเปิดร้านซ้ำได้",
      pending_cash_shift_open_exists:"มีคำสั่งเปิดร้านเดิมที่ยังไม่ทราบผล · ต้องตรวจรายการเดิมก่อน",
      cash_shift_open_ack_unknown:"ระบบกลางยังยืนยันการเปิดร้านเดิมไม่ครบ · ระบบเก็บรายการเดิมไว้ ห้ามเปิดซ้ำ",
      cash_shift_open_recovery_unavailable:"อ่าน/บันทึกข้อมูลป้องกันการเปิดร้านซ้ำไม่ได้ · ระบบปิดปุ่มเปิดร้านชั่วคราว",
      network_unavailable:"เน็ตขาดการเชื่อมต่อ · ยังไม่ทราบว่าเปิดร้านสำเร็จหรือไม่ ระบบเก็บรายการเดิมไว้และจะตรวจซ้ำ",
      offline_write_blocked:"ออฟไลน์อยู่ · ต้องเชื่อมต่อก่อนเปิดร้าน"
    };
    return map[code]||"ยังยืนยันการเปิดร้านไม่ได้ · ระบบเก็บรายการเดิมไว้เพื่อป้องกันเปิดซ้ำ";
  }

  async function submitStartDayIntent(intent:CashShiftOpenIntent,recovery=false){
    if(startDaySavingRef.current)return false;
    startDaySavingRef.current=true;setStartDayFeedback("");
    try{
      const result=await sendCashShiftOpenIntent(intent,body=>api<any>("/api/cash-shift/open",{
        method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)
      }));
      setPendingOpenShift(null);setStartDayRecoveryBlocked(false);
      setStartDayFeedback((recovery?"ตรวจรายการเปิดร้านเดิมสำเร็จ · ":"")+"ร้านเปิดแล้ว · เงินตั้งต้น ฿"+money(result.shift?.openingCash)+" ถูกล็อกแล้ว");
      await refresh();
      return true;
    }catch(error:any){
      try{setPendingOpenShift(readCashShiftOpenIntent(session.user.id));setStartDayRecoveryBlocked(false)}
      catch{setStartDayRecoveryBlocked(true)}
      setStartDayFeedback(startDayError(error?.message));
      await refresh().catch(()=>{});
      return false;
    }finally{startDaySavingRef.current=false}
  }

  async function openStartDay(){
    if(!canStatus||!online||startDayRecoveryBlocked||startDaySavingRef.current)return;
    let existing:CashShiftOpenIntent|null=null;
    try{existing=readCashShiftOpenIntent(session.user.id)}
    catch{setStartDayRecoveryBlocked(true);setStartDayFeedback(startDayError("cash_shift_open_recovery_unavailable"));return}
    if(existing){setPendingOpenShift(existing);await submitStartDayIntent(existing,true);return}
    const date=String(expenseData?.businessDate||"");
    const amount=Number(openingCash);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){setStartDayFeedback("ยังไม่ได้วันทำการล่าสุด · รีเฟรชก่อนเปิดร้าน");return}
    if(!Number.isFinite(amount)||amount<0||amount>1e7||Math.abs(amount*100-Math.round(amount*100))>1e-7){setStartDayFeedback(startDayError("invalid_opening_cash"));return}
    if(!window.confirm("ยืนยันเปิดร้านด้วยเงินตั้งต้น ฿"+money(amount)+" ? หลังยืนยันจำนวนนี้จะถูกล็อกสำหรับการกระทบยอดวันนี้"))return;
    try{
      const intent=prepareCashShiftOpenIntent(session.user.id,{requestKey:crypto.randomUUID(),date,openingCash:amount});
      setPendingOpenShift(intent);await submitStartDayIntent(intent,false);
    }catch(error:any){setStartDayFeedback(startDayError(error?.message))}
  }

  function quickExpenseError(code:string){
    const map:Record<string,string>={
      day_closed:"ปิดยอดวันนี้แล้ว ไม่สามารถเพิ่มค่าใช้จ่ายได้",
      cash_shift_not_open:"ยังไม่ได้เปิดกะเงินสด · เปิดกะก่อนหรือเลือกโอน/อื่น ๆ",
      drawer_cash_shortage:"เงินในลิ้นชักตามระบบไม่พอ · รีเฟรชและตรวจยอดจริง",
      high_risk_confirmation_required:"รายจ่ายเงินสดตั้งแต่ ฿500 ต้องยืนยันรายการมูลค่าสูง",
      expense_reason_required:"รายจ่ายเงินสดมูลค่าสูงต้องระบุเหตุผลอย่างน้อย 2 ตัวอักษร",
      request_key_conflict:"ข้อมูลรายการเดิมไม่ตรงกัน · ระบบล็อกรายการไว้ ห้ามสร้างยอดใหม่",
      network_unavailable:"ยังไม่ทราบว่าระบบกลางบันทึกสำเร็จหรือไม่ · ระบบเก็บรายการเดิมไว้และจะตรวจซ้ำ",
      offline_write_blocked:"เน็ตหลุด · ระบบยังไม่ส่งรายการและเก็บรายการเดิมไว้",
      expense_ack_unknown:"ระบบกลางยังยืนยันรายการเดิมไม่ครบ · ระบบเก็บรายการเดิมไว้และจะตรวจซ้ำ",
      expense_recovery_unavailable:"อ่าน/บันทึกข้อมูลรายการค้างไม่ได้ · ระบบปิดรายจ่ายด่วนชั่วคราว",
      pending_expense_exists:"มีค่าใช้จ่ายเดิมที่ยังไม่ทราบผล · ตรวจรายการเดิมก่อน",
      invalid_request_key:"รหัสกันรายการซ้ำไม่ถูกต้อง",
      invalid_expense_payment_method:"ช่องทางการจ่ายไม่ถูกต้อง",
      invalid_expense:"ข้อมูลค่าใช้จ่ายไม่ถูกต้อง"
    };
    return map[code]||"ยังยืนยันค่าใช้จ่ายไม่ได้ · ระบบเก็บรายการเดิมไว้ กรุณาตรวจรายการก่อน";
  }

  async function submitQuickExpense(recovered?:ExpenseIntent){
    if(!canExpense||expenseSavingRef.current||expenseRecoveryBlocked)return;
    const amount=Number(expenseAmount)||0;
    if(!recovered&&!pendingExpense&&!canSaveExpense)return;
    expenseSavingRef.current=true;
    setBusy(true);setExpenseFeedback("");
    try{
      const intent=recovered||pendingExpense||prepareExpenseIntent(session.user.id,{
        requestKey:newExpenseRequestKey(),date:String(expenseData?.businessDate||""),amount,
        category:expenseCategory,description:expenseDescription.trim().slice(0,240),
        paymentMethod:expensePaymentMethod,riskConfirmed:expenseRiskConfirmed
      });
      setPendingExpense(intent);
      const result=await sendExpenseIntent(intent,body=>api<any>("/api/expenses",{
        method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)
      }));
      setPendingExpense(null);setExpenseRecoveryBlocked(false);
      setExpenseAmount("");setExpenseDescription("");setExpensePaymentMethod("cash");setExpenseRiskConfirmed(false);
      setExpenseFeedback((result.replayed?"ตรวจพบว่ารายการเดิมบันทึกแล้ว · ไม่สร้างซ้ำ":"บันทึกค่าใช้จ่ายแล้ว")+(result.availableCash!==null&&result.availableCash!==undefined?" · เงินในลิ้นชัก ฿"+money(result.availableCash):""));
      await refresh();
    }catch(error:any){
      setExpenseFeedback(quickExpenseError(error?.message));
      try{setPendingExpense(readExpenseIntent(session.user.id))}
      catch{setExpenseRecoveryBlocked(true)}
      await refresh().catch(()=>{});
    }finally{expenseSavingRef.current=false;setBusy(false)}
  }

  useEffect(()=>{
    if(!open||!canStatus)return;
    let active=true;
    const recover=()=>{
      if(!active||!online||startDaySavingRef.current)return;
      let intent:CashShiftOpenIntent|null=null;
      try{intent=readCashShiftOpenIntent(session.user.id);setStartDayRecoveryBlocked(false)}
      catch{setStartDayRecoveryBlocked(true);setStartDayFeedback(startDayError("cash_shift_open_recovery_unavailable"));return}
      if(!intent){setPendingOpenShift(null);return}
      setPendingOpenShift(intent);
      submitStartDayIntent(intent,true).catch(()=>{});
    };
    const visible=()=>{if(document.visibilityState==="visible")recover()};
    recover();
    window.addEventListener("online",recover);window.addEventListener("focus",recover);document.addEventListener("visibilitychange",visible);
    return()=>{active=false;window.removeEventListener("online",recover);window.removeEventListener("focus",recover);document.removeEventListener("visibilitychange",visible)};
  },[open,canStatus,online,session.user.id,session.csrf]);

  useEffect(()=>{
    if(!open||!canExpense)return;
    let active=true;
    const recover=()=>{
      if(!active||typeof navigator!=="undefined"&&!navigator.onLine)return;
      try{
        const intent=readExpenseIntent(session.user.id);
        if(intent&&!expenseSavingRef.current)submitQuickExpense(intent).catch(()=>{});
      }catch{
        setExpenseRecoveryBlocked(true);
        setExpenseFeedback("อ่านข้อมูลค่าใช้จ่ายค้างไม่ได้ · ระบบปิดรายจ่ายด่วนชั่วคราว");
      }
    };
    const visible=()=>{if(document.visibilityState==="visible")recover()};
    recover();
    window.addEventListener("online",recover);window.addEventListener("focus",recover);document.addEventListener("visibilitychange",visible);
    return()=>{active=false;window.removeEventListener("online",recover);window.removeEventListener("focus",recover);document.removeEventListener("visibilitychange",visible)};
  },[open,canExpense,session.user.id,session.csrf]);

  const stockRows=useMemo(()=>{
    const rows:Array<{key:string;name:string;variant:string;level:"out"|"low";detail:string}>=[];
    for(const menu of bootstrap?.menu||[]){
      for(const variant of menu.variants||[]){
        if(!variant.available){
          const missing=(variant.missingIngredients||[]).map(x=>x.name).join(", ");
          rows.push({
            key:menu.id+"|"+variant.label,name:menu.name,variant:variant.label,level:"out",
            detail:missing?("ขาด "+missing):(variant.reason||"ทำเมนูนี้ไม่ได้")
          });
        }else if(variant.lowStock){
          rows.push({
            key:menu.id+"|"+variant.label,name:menu.name,variant:variant.label,level:"low",
            detail:"ทำได้ประมาณ "+variant.maxServings+" แก้ว"
          });
        }
      }
    }
    return rows.slice(0,12);
  },[bootstrap?.revision]);

  const queueSorted=queue.slice().sort((a,b)=>n(a.time)-n(b.time));
  const productionHead=queueSorted.find(order=>!queueOrderCalled(order))||null;
  const queueRows=queueSorted.slice(0,6);
  const orderRows=sales.slice(0,7);
  const latestOrder=orderRows[0]||null;
  const expenseRows=(expenseData?.expenses||[]).filter(row=>!expenseData?.businessDate||row.date===expenseData.businessDate).slice(0,5);
  const expenseAmountNumber=Number(expenseAmount)||0;
  const expenseIsCash=expensePaymentMethod==="cash";
  const drawerCash=Number(expenseData?.drawerSnapshot?.availableCash||0);
  const cashShiftReady=!!expenseData?.shift&&expenseData.shift.status==="open";
  const cashTooLarge=expenseIsCash&&expenseAmountNumber>drawerCash;
  const highRiskExpense=expenseIsCash&&expenseAmountNumber>=500;
  const canSaveExpense=!!expenseData?.businessDate&&expenseAmountNumber>0&&(!expenseIsCash||(cashShiftReady&&!cashTooLarge))&&(!highRiskExpense||(expenseRiskConfirmed&&expenseDescription.trim().length>=2));
  const outCount=stockRows.filter(x=>x.level==="out").length;
  const lowCount=stockRows.filter(x=>x.level==="low").length;
  const readiness=control?.readiness||null;
  const nextAction=chooseWorkspaceNextAction({
    canExpense,pendingExpense:!!pendingExpense,expenseRecoveryBlocked,
    canQueue,queueCount:queueRows.length,firstQueue:queueRows[0]?.queueNo||"",
    canStock,outCount,lowCount,
    canStatus,blockedCount:Number(readiness?.summary.blocked||0),
    canOrder,latestOrderLabel:String(latestOrder?.queueNo||latestOrder?.billNo||""),
    canStartDay:canStatus,
    businessDateKnown:!!expenseData?.businessDate,
    shiftStatus:String(expenseData?.shift?.status||""),
    pendingOpenShift:!!pendingOpenShift,
    startDayRecoveryBlocked
  });

  useEffect(()=>{
    if(!open){
      autoRouteRef.current=false;
      manualTabRef.current=false;
      return;
    }
    if(!workspaceReady||autoRouteRef.current||manualTabRef.current)return;
    if(nextAction.tab&&tabs.includes(nextAction.tab as WorkspaceTab)){
      setTab(nextAction.tab as WorkspaceTab);
    }
    autoRouteRef.current=true;
  },[open,workspaceReady,nextAction.tab,tabs.join("|")]);

  if(!open)return null;

  const meta:Array<{key:WorkspaceTab;label:string;icon:any;allowed:boolean;count?:number}>=[
    {key:"queue",label:"คิว",icon:ListOrdered,allowed:canQueue,count:queue.length},
    {key:"orders",label:"ออเดอร์",icon:ClipboardList,allowed:canOrder,count:sales.length},
    {key:"stock",label:"สต็อก",icon:Boxes,allowed:canStock,count:outCount+lowCount},
    {key:"expense",label:"รายจ่าย",icon:ReceiptText,allowed:canExpense,count:pendingExpense?1:0},
    {key:"status",label:"สถานะ",icon:ShieldCheck,allowed:canStatus,count:readiness?.summary.blocked||0}
  ];

  return <div className="fixed inset-0 z-[90] bg-black/25 backdrop-blur-[2px]" onClick={onClose}>
    <aside
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="งานร้าน FIELD"
      onClick={e=>e.stopPropagation()}
      className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-slate-200 bg-[#f6f7f8] shadow-2xl sm:w-[520px]"
    >
      <header className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-4 sm:px-5">
        <div>
          <p className="m-0 text-[10px] font-black tracking-[.22em] text-[#765b08]">FIELD · งานวันนี้</p>
          <h2 className="mt-1 text-xl font-black text-slate-900">งานร้าน</h2>
          <p className="mt-1 text-xs text-slate-500">เช็กงานหลักโดยไม่ออกจากหน้า POS · งานแก้ไขเชิงลึกค่อยเปิดหน้าเต็ม</p>
        </div>
        <div className="flex gap-1">
          <button type="button" onClick={()=>{
            onClose();
            window.dispatchEvent(new CustomEvent("field:ai-ask",{detail:{message:"ช่วยตรวจงานร้านตอนนี้และบอกสิ่งที่ควรทำต่อ"}}));
          }} aria-label="ถามผู้ช่วยเรื่องงานร้าน" className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white">
            <Bot size={18}/>
          </button>
          <button disabled={busy||!online} onClick={()=>refresh()} aria-label="รีเฟรชงานร้าน" className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white disabled:opacity-40">
            <RefreshCw size={17} className={busy?"animate-spin":""}/>
          </button>
          <button ref={closeButtonRef} onClick={onClose} aria-label="ปิดงานร้าน" className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white">
            <X size={18}/>
          </button>
        </div>
      </header>

      {canStatus&&expenseData?.businessDate&&<div className="border-b border-slate-200 bg-white px-3 py-3 sm:px-4">
        {!expenseData.shift?<div ref={startDayCardRef} className="rounded-2xl border border-[#d4af37]/50 bg-[#fff8dc] p-3">
          <div className="flex items-start justify-between gap-3"><div><b className="text-sm">เริ่มงานวันนี้</b><p className="mt-1 text-xs text-slate-600">ใส่เงินสดตั้งต้นครั้งเดียว แล้วรับออเดอร์ต่อจากหน้า POS ได้เลย</p></div><span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-800">ยังไม่เปิดร้าน</span></div>
          {(pendingOpenShift||startDayRecoveryBlocked)&&<div className={"mt-3 rounded-xl border p-2 text-xs "+(startDayRecoveryBlocked?"border-red-300 bg-red-50 text-red-800":"border-amber-300 bg-amber-50 text-amber-900")}><b>{startDayRecoveryBlocked?"อ่านรายการเปิดร้านค้างไม่ได้":"มีคำสั่งเปิดร้านเดิมรอยืนยัน"}</b><p className="mt-1">{startDayRecoveryBlocked?"ระบบปิดปุ่มเปิดร้านชั่วคราวเพื่อป้องกันยอดเงินตั้งต้นซ้ำ":"ระบบจะตรวจรายการเปิดร้านเดิมเท่านั้น · ห้ามเปลี่ยนเงินตั้งต้นหรือสร้างรายการใหม่"}</p></div>}
          <div className="mt-3 grid grid-cols-[1fr_auto] gap-2"><input ref={openingCashRef} aria-label="เงินสดตั้งต้น" inputMode="decimal" disabled={!!pendingOpenShift||startDayRecoveryBlocked} value={openingCash} onChange={e=>setOpeningCash(e.target.value)} placeholder="เช่น 500" className="min-h-12 rounded-xl border border-slate-300 bg-white px-3 text-base font-bold disabled:text-slate-400"/><button type="button" disabled={!online||startDaySavingRef.current||startDayRecoveryBlocked} onClick={openStartDay} className="min-h-12 rounded-xl bg-[#1F4D3A] px-4 text-sm font-black text-white disabled:opacity-40">{pendingOpenShift?"ตรวจผลเดิม":"เปิดร้านวันนี้"}</button></div>
          <button type="button" disabled={!!pendingOpenShift||startDayRecoveryBlocked} onClick={()=>setOpeningCash("0")} className="mt-2 min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 disabled:opacity-40">ไม่มีเงินทอน · ใช้ ฿0</button>
          {startDayFeedback&&<p className="mt-2 rounded-xl bg-white/70 px-3 py-2 text-xs text-slate-700">{startDayFeedback}</p>}
        </div>:<div className={"rounded-2xl border p-3 "+(expenseData.shift.status==="open"?"border-emerald-200 bg-emerald-50":"border-slate-200 bg-slate-100")}><div className="flex items-start justify-between gap-3"><div><b className="text-sm">{expenseData.shift.status==="open"?"ร้านเปิดแล้ว":"วันนี้ปิดยอดแล้ว"}</b><p className="mt-1 text-xs text-slate-600">{expenseData.shift.status==="open"?"เงินตั้งต้น ฿"+money(expenseData.shift.openingCash)+" ถูกล็อกแล้ว · รับออเดอร์ต่อได้":"วันทำการนี้ปิดแล้ว ระบบไม่เปิดซ้ำ"}</p></div><span className={"rounded-full px-2 py-1 text-[10px] font-bold "+(expenseData.shift.status==="open"?"bg-emerald-200 text-emerald-900":"bg-slate-200 text-slate-700")}>{expenseData.shift.status==="open"?"พร้อมขาย":"ปิดแล้ว"}</span></div></div>}
      </div>}

      <div className={"grid gap-1 border-b border-slate-200 bg-white p-2 "+(meta.filter(x=>x.allowed).length>=5?"grid-cols-5":"grid-cols-4")}>
        {meta.filter(x=>x.allowed).map(({key,label,icon:Icon,count})=><button
          key={key}
          onClick={()=>{manualTabRef.current=true;setTab(key)}}
          className={"relative flex min-h-12 flex-col items-center justify-center rounded-xl px-1 text-[10px] font-bold "+(tab===key?"bg-[#d4af37]/20 text-[#6f5510]":"text-slate-600 hover:bg-slate-100")}
        >
          <Icon size={17}/><span className="mt-0.5">{label}</span>
          {Number(count)>0&&<span className="absolute right-2 top-1 rounded-full bg-slate-900 px-1.5 text-[9px] text-white">{count}</span>}
        </button>)}
      </div>

      {message&&<div className="mx-3 mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">{message}</div>}

      <div role="status" aria-live="polite" className={"mx-3 mt-3 rounded-2xl border p-3 "+(
        nextAction.tone==="critical"?"border-red-200 bg-red-50":
        nextAction.tone==="work"?"border-[#d4af37]/50 bg-[#fff8dc]":
        nextAction.tone==="warn"?"border-amber-200 bg-amber-50":
        "border-emerald-200 bg-emerald-50"
      )}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 text-[10px] font-black tracking-[.14em] text-slate-500">แนะนำตอนนี้</p>
            <b className="mt-1 block text-sm text-slate-900">{nextAction.label}</b>
            <p className="mt-1 text-xs leading-5 text-slate-600">{nextAction.detail}</p>
          </div>
          {nextAction.action==="start_day"?<button type="button" onClick={()=>{
            startDayCardRef.current?.scrollIntoView({behavior:"smooth",block:"nearest"});
            requestAnimationFrame(()=>openingCashRef.current?.focus());
          }} className="min-h-11 shrink-0 rounded-xl bg-[#1F4D3A] px-3 text-xs font-bold text-white">{pendingOpenShift?"ตรวจรายการเดิม":"เริ่มงาน"}</button>:nextAction.tab?<button type="button" onClick={()=>{manualTabRef.current=true;setTab(nextAction.tab as WorkspaceTab)}} className="min-h-11 shrink-0 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-800">ไปตรงนี้</button>:null}
        </div>
      </div>

      <div className="soft-scroll min-h-0 flex-1 overflow-auto p-3 sm:p-4">
        {tab==="queue"&&canQueue&&<div className="space-y-2">
          {(pendingQueueAction||queueRecoveryBlocked||queueFeedback)&&<div role="status" aria-live="polite" aria-atomic="true" className={"rounded-2xl border p-3 text-xs "+(pendingQueueAction||queueRecoveryBlocked?"border-amber-300 bg-amber-50 text-amber-950":"border-emerald-200 bg-emerald-50 text-emerald-800")}>
            <div className="flex items-center justify-between gap-2"><div><b>{queueRecoveryBlocked?"ปุ่มคิวถูกพักชั่วคราว":pendingQueueAction?"กำลังตรวจปุ่มคิวก่อนหน้า":"คิวอัปเดตแล้ว"}</b><p className="mt-1">{queueRecoveryBlocked?"ระบบป้องกันการกดซ้ำอ่านข้อมูลไม่ได้ · เปิดโหมดทำเครื่องดื่มเพื่อตรวจ":pendingQueueAction?"ไม่ต้องกดซ้ำ · ระบบจะใช้คำสั่งเดิมจนกว่าจะรู้ผล":queueFeedback}</p></div>{pendingQueueAction&&<button type="button" disabled={queueRecoveryBusy||busy||!online} onClick={()=>recoverQueueAction()} className="min-h-11 shrink-0 rounded-xl bg-amber-900 px-3 font-bold text-white disabled:opacity-40">ตรวจรายการเดิม</button>}</div>
          </div>}
          {queueRows.length===0?<Empty text={!online?"เน็ตหลุด · ยังดึงคิวล่าสุดจากระบบกลางไม่ได้":"ไม่มีคิวที่กำลังทำ"}/>:queueRows.map(order=>{
            const total=(order.items||[]).reduce((s,x)=>s+n(x.qty),0);
            const ready=(order.items||[]).reduce((s,x)=>s+Math.min(n(x.qty),n(x.readyQty)),0);
            const called=(order.items||[]).reduce((s,x)=>s+Math.min(n(x.qty),n(x.calledQty)),0);
            const readyAll=queueOrderReady(order),calledAll=queueOrderCalled(order),isProductionHead=productionHead?.id===order.id;
            return <div key={order.id} className={"rounded-2xl border bg-white p-3 "+(isProductionHead?"border-[#d4af37]/60":"border-slate-200")}>
              <div className="flex items-center justify-between gap-3">
                <div><b className="text-base">{order.queueNo}</b><span className="ml-2 text-xs text-slate-500">บัตร {order.pagerNo||"—"}</span></div>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-700">{orderStatusLabel(order.status)}</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                <Metric label="ทั้งหมด" value={total}/><Metric label="ทำแล้ว" value={ready}/><Metric label="เรียกแล้ว" value={called}/>
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-slate-500">{(order.items||[]).map(x=>x.name+" ×"+x.qty).join(" · ")}</p>
              {calledAll?<button type="button" disabled={!online||busy||queueActionLocked} onClick={()=>runQueueTailAction(order,"return")} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#1F4D3A] px-4 text-sm font-black text-white disabled:opacity-40"><CheckCircle2 size={17}/>ลูกค้ารับแล้ว</button>:
                isProductionHead&&readyAll?<button type="button" disabled={!online||busy||queueActionLocked} onClick={()=>runQueueTailAction(order,"call")} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#d4af37] px-4 text-sm font-black text-black disabled:opacity-40"><BellRing size={17}/>เรียกบัตร {order.pagerNo||order.queueNo}</button>:
                isProductionHead?<Link href="/queue" className="mt-3 flex min-h-12 w-full items-center justify-center rounded-xl border border-[#d4af37]/60 bg-[#fffaf0] px-4 text-sm font-black text-[#6f5510]">ทำคิวนี้ต่อ</Link>:
                <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-center text-[11px] text-slate-500">รอคิวก่อนหน้า · ระบบเรียงลำดับให้แล้ว</p>}
            </div>;
          })}
          <FullLink href="/queue" label="เปิดโหมดทำเครื่องดื่ม / ดูคิวเต็ม"/>
        </div>}

        {tab==="orders"&&canOrder&&<div className="space-y-2">
          {latestOrder&&<details className="overflow-hidden rounded-2xl border border-[#d4af37]/40 bg-[#fffaf0]">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-bold text-[#6f5510]">
              <span>ใบเสร็จล่าสุด · {latestOrder.queueNo||latestOrder.billNo||"บิล"}</span><span>฿{money(latestOrder.total)}</span>
            </summary>
            <div className="border-t border-[#d4af37]/25 bg-white p-3">
              <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                <span>{latestOrder.date||"—"} · {latestOrder.billNo||latestOrder.queueNo||"บิล"}</span>
                <span>{paymentSummaryLabel(latestOrder.payment,latestOrder.paymentMethods)||"—"}</span>
              </div>
              <div className="mt-3 space-y-2">
                {(latestOrder.items||[]).length===0?<p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">ไม่มีรายละเอียดเมนูในข้อมูลบิลนี้</p>:(latestOrder.items||[]).map((item,index)=><div key={item.id+"|"+item.variant+"|"+index} className="flex items-start justify-between gap-3 rounded-xl bg-slate-50 p-3 text-xs">
                  <div className="min-w-0"><b className="block text-slate-900">{item.name}</b>{item.variant&&<span className="mt-1 block text-[10px] text-slate-500">{item.variant}</span>}<span className="mt-1 block text-[10px] text-slate-500">{item.qty} × ฿{money(item.price)}</span></div>
                  <b className="shrink-0 text-[#765b08]">฿{money(Number(item.price)*Number(item.qty))}</b>
                </div>)}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3"><span className="text-sm font-semibold">ยอดชำระ</span><b className="text-lg text-[#765b08]">฿{money(latestOrder.total)}</b></div>
              <p className="mt-2 text-[10px] text-slate-500">ดูบิลได้ตรงนี้โดยไม่ออกจากหน้า POS · หากต้อง Refund/VOID ให้เปิดประวัติเต็มด้านล่าง</p>
            </div>
          </details>}
          {orderRows.length===0?<Empty text="ยังไม่มีออเดอร์ล่าสุด"/>:orderRows.map(sale=><div key={sale.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3">
            <div className="min-w-0">
              <div><b>{sale.queueNo||sale.billNo||"บิล"}</b><span className="ml-2 text-[10px] text-slate-500">{paymentSummaryLabel(sale.payment,sale.paymentMethods)}</span></div>
              <p className="mt-1 truncate text-xs text-slate-500">{sale.itemCount} รายการ · {saleStatusLabel(sale.status)}{sale.orderStatus?" · "+orderStatusLabel(sale.orderStatus):""}</p>
            </div>
            <b className="shrink-0 text-[#765b08]">฿{money(sale.total)}</b>
          </div>)}
          <FullLink href="/orders" label="เปิดประวัติ / คืนเงิน / ยกเลิกบิล"/>
        </div>}

        {tab==="stock"&&canStock&&<div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <StatusCard label="ทำไม่ได้" value={outCount} level="danger"/>
            <StatusCard label="ใกล้หมด" value={lowCount} level="warn"/>
          </div>
          {stockRows.length===0?<Empty text="เมนูที่เปิดขายยังไม่พบสัญญาณสต็อกต่ำ"/>:stockRows.map(row=><div key={row.key} className={"rounded-2xl border p-3 "+(row.level==="out"?"border-red-200 bg-red-50":"border-amber-200 bg-amber-50")}>
            <div className="flex items-start justify-between gap-2">
              <div><b className="text-sm">{row.name}</b><p className="mt-0.5 text-[11px] text-slate-500">{row.variant}</p></div>
              <span className={"rounded-full px-2 py-1 text-[9px] font-black "+(row.level==="out"?"bg-red-100 text-red-700":"bg-amber-100 text-amber-800")}>{row.level==="out"?"พักขาย":"LOW"}</span>
            </div>
            <p className="mt-2 text-xs text-slate-700">{row.detail}</p>
          </div>)}
          <FullLink href="/stock" label="เปิด Stock / รับเข้า / นับจริง"/>
        </div>}

        {tab==="expense"&&canExpense&&<div className="space-y-3">
          {expenseFeedback&&<div role="status" className={"rounded-xl border p-3 text-xs font-semibold "+(pendingExpense||expenseRecoveryBlocked?"border-amber-200 bg-amber-50 text-amber-900":"border-emerald-200 bg-emerald-50 text-emerald-800")}>{expenseFeedback}</div>}
          {pendingExpense&&<div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <b>มีค่าใช้จ่ายเดิมรอยืนยัน</b><p className="mt-1">ระบบจะตรวจรายการเดิมเท่านั้น · ห้ามสร้างยอดใหม่จนกว่าระบบกลางจะยืนยันผล</p>
          </div>}
          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-3"><div><b className="text-sm">รายจ่ายด่วน</b><p className="mt-1 text-[11px] text-slate-500">บันทึกรายจ่ายประจำวันด้วยกลไกป้องกันยอดซ้ำเดียวกับหน้าค่าใช้จ่าย</p></div><Link href="/expenses" className="min-h-11 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600">หน้าเต็ม</Link></div>
            <div className="mt-3 grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1">
              {([["cash","เงินสด"],["bank","โอน"],["other","อื่น ๆ"]] as const).map(([value,label])=><button type="button" key={value} disabled={busy||!!pendingExpense||expenseRecoveryBlocked} onClick={()=>{setExpensePaymentMethod(value);setExpenseRiskConfirmed(false)}} className={"min-h-11 rounded-xl text-xs font-bold "+(expensePaymentMethod===value?"bg-white shadow-sm":"text-slate-600")}>{label}</button>)}
            </div>
            {expenseIsCash&&<div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs"><Metric label="เงินในลิ้นชัก" value={drawerCash}/><div className={"rounded-xl p-2 "+(cashTooLarge?"bg-red-50 text-red-700":"bg-slate-50")}><b className="block text-base">฿{money(drawerCash-expenseAmountNumber)}</b><span className="text-[10px]">หลังจ่าย</span></div></div>}
            {expenseIsCash&&!cashShiftReady&&<p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">ยังไม่เปิดกะเงินสด · เลือกโอน/อื่น ๆ หรือเปิดกะก่อน</p>}
            <div className="mt-3 grid gap-2">
              <select disabled={busy||!!pendingExpense||expenseRecoveryBlocked} aria-label="หมวดค่าใช้จ่ายด่วน" value={expenseCategory} onChange={e=>setExpenseCategory(e.target.value)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <option value="OTHER">อื่น ๆ</option><option value="UTILITY">ค่าน้ำ/ไฟ</option><option value="MAINTENANCE">ซ่อมบำรุง</option><option value="PACKAGING">บรรจุภัณฑ์ฉุกเฉิน</option><option value="MARKETING">การตลาด</option><option value="TRANSPORT">เดินทาง/ขนส่ง</option>
              </select>
              <input disabled={busy||!!pendingExpense||expenseRecoveryBlocked} inputMode="decimal" aria-label="จำนวนเงินค่าใช้จ่ายด่วน" value={expenseAmount} onChange={e=>{setExpenseAmount(e.target.value);setExpenseRiskConfirmed(false)}} placeholder="จำนวนเงิน" className="min-h-11 rounded-xl border border-slate-200 px-3 text-base font-semibold"/>
              <input disabled={busy||!!pendingExpense||expenseRecoveryBlocked} maxLength={240} aria-label="รายละเอียดค่าใช้จ่ายด่วน" value={expenseDescription} onChange={e=>setExpenseDescription(e.target.value)} placeholder="รายละเอียด / เหตุผล" className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm"/>
            </div>
            {cashTooLarge&&<p className="mt-2 rounded-xl border border-red-200 bg-red-50 p-2 text-[11px] font-semibold text-red-700">เงินในลิ้นชักตามระบบไม่พอ · ระบบปิดปุ่มบันทึก</p>}
            {highRiskExpense&&<label className="mt-2 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-2 text-[11px] text-red-700"><input disabled={busy||!!pendingExpense} type="checkbox" checked={expenseRiskConfirmed} onChange={e=>setExpenseRiskConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4"/><span>ยืนยันรายจ่ายเงินสดตั้งแต่ ฿500 และระบุเหตุผลอย่างน้อย 2 ตัวอักษร</span></label>}
            <button type="button" disabled={busy||expenseRecoveryBlocked||(!pendingExpense&&!canSaveExpense)} onClick={()=>submitQuickExpense()} className="mt-3 min-h-12 w-full rounded-xl bg-[#d4af37] text-sm font-black text-black disabled:opacity-40">{busy?"กำลังตรวจ...":pendingExpense?"ตรวจผลรายการเดิม":"ยืนยันค่าใช้จ่าย"}</button>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3"><b className="text-sm">ล่าสุดวันนี้</b><div className="mt-2 space-y-2">{expenseRows.length===0?<p className="text-xs text-slate-500">ยังไม่มีค่าใช้จ่าย</p>:expenseRows.map(row=><div key={row.id} className="flex items-center justify-between gap-3 border-t border-slate-100 pt-2 text-xs"><span className="min-w-0 truncate">{row.description||row.category}</span><b className="shrink-0 text-[#765b08]">฿{money(row.amount)}</b></div>)}</div></div>
        </div>}

        {tab==="status"&&canStatus&&<div className="space-y-3">
          {!readiness?<Empty text={!online?"เน็ตหลุด · ต้องเชื่อมต่อเพื่อดูความพร้อมระบบ":"ยังไม่มีข้อมูลความพร้อมระบบ"}/>:<>
            <div className={"rounded-2xl border p-4 "+(readiness.status==="READY"?"border-emerald-200 bg-emerald-50":readiness.status==="WARN"?"border-amber-200 bg-amber-50":"border-red-200 bg-red-50")}>
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-[10px] font-black tracking-[.15em] text-slate-500">ความพร้อมระบบ</p><b className="mt-1 block text-lg">{readinessLabel(readiness.status)}</b></div>
                <div className="text-right"><b className="text-2xl">{readiness.score}</b><span className="text-xs text-slate-500">/100</span></div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center"><Metric label="พร้อม" value={readiness.summary.ready}/><Metric label="เตือน" value={readiness.summary.warn}/><Metric label="บล็อก" value={readiness.summary.blocked}/></div>
            </div>
            <div className="space-y-2">{readiness.checks.map(check=><div key={check.id} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3">
              <div><b className="text-sm">{check.label}</b><p className="mt-1 text-xs text-slate-500">{check.message}</p></div>
              <span className={"rounded-full px-2 py-1 text-[9px] font-black "+(check.status==="READY"?"bg-emerald-100 text-emerald-700":check.status==="WARN"?"bg-amber-100 text-amber-800":"bg-red-100 text-red-700")}>{checkStatusLabel(check.status)}</span>
            </div>)}</div>
          </>}
          <FullLink href="/control" label="ตรวจระบบแบบละเอียด"/>
        </div>}
      </div>
    </aside>
  </div>;
}

function Empty({text}:{text:string}){return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-center text-xs text-slate-500">{text}</div>}
function Metric({label,value}:{label:string;value:number}){return <div className="rounded-xl bg-slate-50 p-2"><b className="block text-base">{value}</b><span className="text-[10px] text-slate-500">{label}</span></div>}
function StatusCard({label,value,level}:{label:string;value:number;level:"danger"|"warn"}){return <div className={"rounded-2xl border p-3 "+(level==="danger"?"border-red-200 bg-red-50":"border-amber-200 bg-amber-50")}><b className="text-2xl">{value}</b><p className="mt-1 text-xs text-slate-600">{label}</p></div>}
function FullLink({href,label}:{href:string;label:string}){return <Link href={href} className="flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700">{label}</Link>}
