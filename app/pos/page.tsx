"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import {ArrowRight,CheckCircle2,ClipboardList,Clock3,Minus,Plus,Search,Trash2,WalletCards,X} from "lucide-react";
import AuthGate from "@/components/auth-gate";
import {api,type Bootstrap,type MenuItem,type RevisionUnchanged,type Session} from "@/lib/api-client";
import {cacheGet,cachePut} from "@/lib/offline-db";
import {applyOfflineCashToBootstrap,getOfflineCashSummary,queueOfflineCashSale,syncOfflineCashSales,type OfflineCashSummary} from "@/lib/offline-sales";
import {additionalServingsAvailable,additionalServingsForVariant,cartAvailability} from "@/lib/domain/availability.mjs";
import {planCartChange} from "@/lib/domain/cart-change-policy.mjs";
import {moveOneUnitToVariant,quickAddVariant,shortVariantLabel} from "@/lib/domain/quick-order.mjs";
import {useCartStore} from "@/stores/cart-store";
import {useHeldCartStore} from "@/stores/held-cart-store";
import {writeQueueSnapshotCache} from "@/lib/queue-cache";
import ModalFocus from "@/components/modal-focus";
import {formatBaht} from "@/lib/domain/money.mjs";
import {cashierNextAction} from "@/lib/cashier-guidance.mjs";
import {availableMenusFirst} from "@/lib/order-screen.mjs";
import {chooseWorkspaceNextAction} from "@/lib/workspace-guidance.mjs";
import {readExpenseIntent} from "@/lib/expense-recovery";
import {readCashShiftOpenIntent} from "@/lib/cash-shift-open-recovery";

const loadPosDailyWorkspace=()=>import("@/components/pos-daily-workspace");
const PosDailyWorkspace=dynamic(loadPosDailyWorkspace,{
  ssr:false,
  loading:()=> <div role="status" aria-live="polite" className="fixed inset-0 z-[90] grid place-items-center bg-black/20"><div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-xl">กำลังเปิดงานร้าน…</div></div>
});

type CartItems=ReturnType<typeof useCartStore.getState>["items"];

// Thai voice confirmation for transfers, so a solo operator making a drink
// hears that the money arrived. Silent where speech is unavailable.
function announcePayment(total:number){
  try{
    if(!Number.isFinite(total)||typeof window==="undefined"||!("speechSynthesis" in window))return;
    const baht=Number.isInteger(total)?String(total):total.toFixed(2);
    const u=new SpeechSynthesisUtterance("ได้รับเงิน "+baht+" บาท เรียบร้อยแล้ว");
    u.lang="th-TH";u.rate=1;
    window.speechSynthesis.cancel();window.speechSynthesis.speak(u);
  }catch{}
}

// Ticks once a second on its own so the whole POS does not re-render.
function ParkedElapsed({since}:{since:number}){
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{const t=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(t)},[]);
  const sec=Math.max(0,Math.floor((now-Number(since||now))/1000));
  return <span className="tabular-nums">{Math.floor(sec/60)}:{String(sec%60).padStart(2,"0")}</span>;
}

// Light confirmation tick where the platform supports it (Android/Chrome).
// iOS Safari ignores navigator.vibrate; the visual bump still confirms the tap.
function tapHaptic(){try{navigator.vibrate?.(8)}catch{}}

const OFFLINE_QR_KEY="field-pos-promptpay-qr-id-v1";
async function renderLocalPromptPayQr(id:string,total:number){
  const [{buildPromptPayPayload},QR]=await Promise.all([import("@/lib/promptpay-payload.mjs"),import("qrcode")]);
  const satang=Math.round(Number(total)*100);
  return (QR as any).default?(QR as any).default.toDataURL(buildPromptPayPayload(id,satang),{margin:1,width:320}):(QR as any).toDataURL(buildPromptPayPayload(id,satang),{margin:1,width:320});
}

export default function Pos(){return <AuthGate preloadPath="/api/pos/bootstrap">{s=><PosView session={s}/>}</AuthGate>}

function localDate(){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}
function localTime(ts:number){
  return new Intl.DateTimeFormat("th-TH",{timeZone:"Asia/Bangkok",hour:"2-digit",minute:"2-digit"}).format(new Date(ts));
}

const BOOTSTRAP_CACHE_MAX_AGE_MS=36*60*60*1000;
const PENDING_KEY="field-pos-pending-promptpay-v1";
type PendingPrompt={requestKey:string;payRequestKey?:string;sessionId?:string;date:string;cart:{id:string;variant:string;qty:number}[];paymentReference:string;total:number;customerId:string|null;pointsRedeemed?:number;createdAt:number;checkoutMode?:"full"|"split_bill";targetOrderId?:string|null;parked?:boolean;parkedAt?:number};
const pendingRead=():PendingPrompt|null=>{try{return JSON.parse(localStorage.getItem(PENDING_KEY)||"null")}catch{return null}};
const pendingWrite=(p:PendingPrompt)=>localStorage.setItem(PENDING_KEY,JSON.stringify(p));
const pendingClear=()=>localStorage.removeItem(PENDING_KEY);
const samePending=(p:PendingPrompt,total:number,cart:{id:string;variant:string;qty:number}[],customerId:string,pointsRedeemed:number,targetOrderId?:string|null)=>p.total===total&&p.customerId===(customerId||null)&&Number(p.pointsRedeemed||0)===pointsRedeemed&&String(p.targetOrderId||"")===String(targetOrderId||"")&&JSON.stringify(p.cart)===JSON.stringify(cart);

const CASH_PENDING_KEY="field-pos-pending-cash-v1";
type PendingCash={body:any;createdAt:number};
const cashPendingRead=():PendingCash|null=>{try{return JSON.parse(localStorage.getItem(CASH_PENDING_KEY)||"null")}catch{return null}};
const cashPendingWrite=(p:PendingCash)=>localStorage.setItem(CASH_PENDING_KEY,JSON.stringify(p));
const cashPendingClear=()=>localStorage.removeItem(CASH_PENDING_KEY);
const sameCashPending=(p:PendingCash,total:number,cart:{id:string;variant:string;qty:number}[],customerId:string,received:number,pointsRedeemed:number,targetOrderId?:string|null)=>Number(p.body?.received)===received&&Number(p.body?.total??total)===total&&(p.body?.customerId||null)===(customerId||null)&&Number(p.body?.pointsRedeemed||0)===pointsRedeemed&&String(p.body?.targetOrderId||"")===String(targetOrderId||"")&&JSON.stringify(p.body?.cart||[])===JSON.stringify(cart);

type LastSale={queueNo:string;pager:number;billNo?:string;total:number;received:number;change:number;payment:"cash"|"promptpay"|"bank"|"card"|"delivery";recovered?:boolean;offline?:boolean};
type SplitGroup={orderId:string;queueNo:string;pager:number;createdAt:number};
const SPLIT_GROUP_KEY="field-pos-split-group-v1";
const splitGroupRead=():SplitGroup|null=>{try{return JSON.parse(sessionStorage.getItem(SPLIT_GROUP_KEY)||"null")}catch{return null}};
const splitGroupWrite=(g:SplitGroup)=>sessionStorage.setItem(SPLIT_GROUP_KEY,JSON.stringify(g));
const splitGroupClear=()=>sessionStorage.removeItem(SPLIT_GROUP_KEY);

const sellable=(x:MenuItem)=>!!x.enabled&&Number(x.price)>0&&Array.isArray(x.variants)&&x.variants.length>0;
function orderOptionLabel(label:string){
  const raw=String(label||"").trim(),v=raw.toLowerCase().replace(/\s+/g,"");
  if(["100%","normal","ปกติ","หวานปกติ"].includes(v))return "หวานปกติ (100%)";
  if(["50%","less","lesssweet","หวานน้อย"].includes(v))return "หวานน้อย (50%)";
  if(["0%","no","nosweet","ไม่หวาน"].includes(v))return "ไม่หวาน (0%)";
  if(!raw||v==="standard")return "สูตรมาตรฐาน";
  return raw;
}

function PosView({session}:{session:Session}){
  const router=useRouter();
  const [data,setData]=useState<Bootstrap|null>(null);
  const [q,setQ]=useState("");
  const [cat,setCat]=useState("ทั้งหมด");
  const [selected,setSelected]=useState<MenuItem|null>(null);
  // Last quick-added cup of a multi-sweetness drink: a one-tap strip above the
  // cart bar lets the operator switch its sweetness without opening any sheet.
  const [lastQuick,setLastQuick]=useState<{key:string;id:string;name:string;variant:string;at:number}|null>(null);
  const [payOpen,setPayOpen]=useState(false);
  const [paymentReviewOpen,setPaymentReviewOpen]=useState(false);
  const [otherPaymentOpen,setOtherPaymentOpen]=useState(false);
  const [orderOptionsOpen,setOrderOptionsOpen]=useState(false);
  const [heldOpen,setHeldOpen]=useState(false);
  const [heldDeleteConfirmId,setHeldDeleteConfirmId]=useState<string|null>(null);
  const [workspaceOpen,setWorkspaceOpen]=useState(false);
  const [workspaceMounted,setWorkspaceMounted]=useState(false);
  const [workspaceRequestedTab,setWorkspaceRequestedTab]=useState<"queue"|"orders"|"stock"|"expense"|"status"|null>(null);
  const [method,setMethod]=useState<"cash"|"promptpay"|"bank"|"card"|"delivery">("cash");
  const [deliveryPlatform,setDeliveryPlatform]=useState<"grab"|"lineman"|"other_delivery">("grab");
  const [received,setReceived]=useState("");
  const [manualPaymentReference,setManualPaymentReference]=useState("");
  const [busy,setBusy]=useState(false);
  const [result,setResult]=useState("");
  const [notice,setNotice]=useState("");
  const [lastSale,setLastSale]=useState<LastSale|null>(null);
  const [prompt,setPrompt]=useState<any|null>(null);
  const [promptConfig,setPromptConfig]=useState<any|null>(null);
  // Offline PromptPay (owner-approved 2026-11-16): QR rendered on this device from
  // the cached public receiving number; sale recorded UNVERIFIED until the server
  // matches it to a bank notification.
  const [offlineQrId,setOfflineQrId]=useState<string|null>(null);
  const [offlineQr,setOfflineQr]=useState<{total:number;key:string;url:string}|null>(null);
  // Instant QR (owner-approved 2026-11-16): the identical QR drawn locally while the
  // server opens the charge. Display only; payment is still confirmed server-side.
  const [qrPreview,setQrPreview]=useState<{total:number;url:string}|null>(null);
  const qrPreviewRef=useRef<typeof qrPreview>(null);qrPreviewRef.current=qrPreview;
  // Own-account PromptPay: two-step manual confirm when the bank notification does not arrive.
  const [directConfirmArmed,setDirectConfirmArmed]=useState(false);
  const [directConfirmBusy,setDirectConfirmBusy]=useState(false);
  // Parked PromptPay (waiting for the bank while the next order is taken).
  const [parkedStatus,setParkedStatus]=useState<any|null>(null);
  const [parkedOpen,setParkedOpen]=useState(false);
  const [parkedBusy,setParkedBusy]=useState(false);
  const [,setParkedTick]=useState(0);
  useEffect(()=>{
    if(!directConfirmArmed)return;
    // Keep both confirm buttons above the sticky payment footer on small phones.
    const id=window.setTimeout(()=>document.querySelector('[data-direct-confirm-panel]')?.scrollIntoView({block:"center",behavior:"smooth"}),30);
    return()=>window.clearTimeout(id);
  },[directConfirmArmed]);
  const [customers,setCustomers]=useState<any[]>([]);
  const [customerId,setCustomerId]=useState("");
  const [loyalty,setLoyalty]=useState({pointsSpend:0,pointsRedeemValue:0});
  const [pointsRedeemed,setPointsRedeemed]=useState(0);
  const [splitBill,setSplitBill]=useState(false);
  const [splitSelection,setSplitSelection]=useState<Record<string,number>>({});
  const [splitGroup,setSplitGroup]=useState<SplitGroup|null>(null);
  const [online,setOnline]=useState(true);
  const [offlineStats,setOfflineStats]=useState<OfflineCashSummary>({pending:0,needsReview:0,total:0});
  const [offlineStorageError,setOfflineStorageError]=useState(false);
  const [workspaceSignals,setWorkspaceSignals]=useState({pendingExpense:false,expenseRecoveryBlocked:false,pendingOpenShift:false,startDayRecoveryBlocked:false});
  const revisionRef=useRef<number|null>(null);
  const offlineSyncRef=useRef(false);
  const cashReconcileRef=useRef(false);
  const promptReconcileRef=useRef(false);
  const checkoutInFlightRef=useRef(false);
  const cartCheckInFlightRef=useRef(false);
  // When the in-memory stock projection was last confirmed by a bootstrap read.
  const projectionAtRef=useRef(0);
  const cart=useCartStore();
  const heldBills=useHeldCartStore();

  useEffect(()=>{
    const connection=(navigator as Navigator&{connection?:{saveData?:boolean;effectiveType?:string}}).connection;
    const constrained=!!connection?.saveData||["slow-2g","2g"].includes(String(connection?.effectiveType||""));
    if(constrained)return;
    const warm=()=>{void loadPosDailyWorkspace()};
    const idleWindow=window as typeof window&{requestIdleCallback?:(callback:()=>void,options?:{timeout:number})=>number;cancelIdleCallback?:(id:number)=>void};
    if(idleWindow.requestIdleCallback){
      const id=idleWindow.requestIdleCallback(warm,{timeout:3500});
      return()=>idleWindow.cancelIdleCallback?.(id);
    }
    const timer=window.setTimeout(warm,2500);
    return()=>window.clearTimeout(timer);
  },[]);

  const acceptBootstrap=(next:Bootstrap|RevisionUnchanged,confirmed=true)=>{
    // An "unchanged" answer still confirms the current projection is fresh.
    if(confirmed)projectionAtRef.current=Date.now();
    if(next?.unchanged===true)return false;
    revisionRef.current=Math.max(revisionRef.current||0,Number(next.revision)||0);
    setData(prev=>!prev||next.revision>=prev.revision?next:prev);
    return true;
  };
  const load=(force=false)=>api<Bootstrap|RevisionUnchanged>("/api/pos/bootstrap",!force&&revisionRef.current!==null?{headers:{"X-Field-Revision":String(revisionRef.current)}}:{}).then(acceptBootstrap);
  const loadCustomers=()=>api<any>("/api/customers").then(x=>{setCustomers(x.customers||[]);setLoyalty({pointsSpend:Number(x.loyalty?.pointsSpend)||0,pointsRedeemValue:Number(x.loyalty?.pointsRedeemValue)||0})}).catch(()=>{});

  useEffect(()=>{
    let active=true;
    const savedGroup=splitGroupRead();if(savedGroup?.orderId)setSplitGroup(savedGroup);

    // Render the last known sellable catalog immediately, then revalidate from Cloud.
    // acceptBootstrap is revision-aware, so a late cache read cannot overwrite newer server data.
    cacheGet<Bootstrap>("/api/pos/bootstrap",BOOTSTRAP_CACHE_MAX_AGE_MS)
      .then(cached=>{if(active&&cached)acceptBootstrap(cached,false)})
      .catch(()=>{});
    load(true).catch(()=>{});

    // Keep the critical path limited to cached catalog + authoritative bootstrap.
    // CRM is optional for the first sale: run it only when the browser is idle.
    // Opening payment still triggers an immediate fetch if this idle work has not run.
    const idleWindow=window as typeof window&{requestIdleCallback?:(callback:()=>void,options?:{timeout:number})=>number;cancelIdleCallback?:(id:number)=>void};
    let customerTimer:number|undefined;
    let customerIdle:number|undefined;
    if(idleWindow.requestIdleCallback)customerIdle=idleWindow.requestIdleCallback(()=>{void loadCustomers()},{timeout:5000});
    else customerTimer=window.setTimeout(()=>{void loadCustomers()},3000);
    recoverCashCheckout().then(()=>recoverPending()).catch(()=>{});
    return()=>{
      active=false;
      if(customerIdle!==undefined)idleWindow.cancelIdleCallback?.(customerIdle);
      if(customerTimer!==undefined)window.clearTimeout(customerTimer);
    };
  },[]);

  useEffect(()=>{
    if((paymentReviewOpen||payOpen)&&customers.length===0)loadCustomers().catch(()=>{});
    if((paymentReviewOpen||payOpen)&&promptConfig===null){
      loadPromptConfig();
    }
  },[paymentReviewOpen,payOpen,customers.length,promptConfig]);

  const promptConfigLoadingRef=useRef(false);
  function loadPromptConfig(){
    if(promptConfigLoadingRef.current)return;
    promptConfigLoadingRef.current=true;
    api<any>("/api/payments/promptpay/config").then(cfg=>{
      setPromptConfig(cfg);
      try{
        if(cfg?.provider==="direct"&&cfg?.ready===true&&/^\d{10,13}$/.test(String(cfg.offlineQrId||""))){
          localStorage.setItem(OFFLINE_QR_KEY,JSON.stringify({provider:"direct",id:String(cfg.offlineQrId),savedAt:Date.now()}));
          setOfflineQrId(String(cfg.offlineQrId));
          // Load the QR renderer once while online so the service worker caches it for offline use.
          renderLocalPromptPayQr(String(cfg.offlineQrId),1).catch(()=>{});
        }else if(cfg&&cfg.provider&&cfg.provider!=="direct"){localStorage.removeItem(OFFLINE_QR_KEY);setOfflineQrId(null)}
      }catch{}
    }).catch(()=>setPromptConfig({ready:false,configured:false})).finally(()=>{promptConfigLoadingRef.current=false});
  }
  useEffect(()=>{
    try{const cached=JSON.parse(localStorage.getItem(OFFLINE_QR_KEY)||"null");if(cached?.provider==="direct"&&/^\d{10,13}$/.test(String(cached.id||"")))setOfflineQrId(String(cached.id))}catch{}
    if(typeof navigator!=="undefined"&&!navigator.onLine)return;
    const t=window.setTimeout(()=>loadPromptConfig(),2500);
    return()=>window.clearTimeout(t);
  },[]);


  useEffect(()=>{
    let initial=true;
    const idleWindow=window as typeof window&{requestIdleCallback?:(callback:()=>void,options?:{timeout:number})=>number;cancelIdleCallback?:(id:number)=>void};
    let maintenanceTimer:number|undefined;
    let maintenanceIdle:number|undefined;
    const runMaintenance=()=>{
      refreshOfflineStats().catch(()=>{});
      if(typeof navigator==="undefined"||navigator.onLine)syncOfflineQueue().catch(()=>{});
    };
    const scheduleInitialMaintenance=()=>{
      if(idleWindow.requestIdleCallback)maintenanceIdle=idleWindow.requestIdleCallback(runMaintenance,{timeout:5000});
      else maintenanceTimer=window.setTimeout(runMaintenance,3000);
    };
    const networkChanged=()=>{
      const next=typeof navigator==="undefined"||navigator.onLine;
      setOnline(next);
      if(initial){
        initial=false;
        scheduleInitialMaintenance();
      }else{
        refreshOfflineStats().catch(()=>{});
        if(next)syncOfflineQueue().catch(()=>{});
      }
      if(next)recoverCashCheckout().then(()=>recoverPending()).catch(()=>{});
    };
    const resume=()=>{if(document.visibilityState==="visible")networkChanged()};
    networkChanged();
    window.addEventListener("online",networkChanged);
    window.addEventListener("offline",networkChanged);
    window.addEventListener("focus",networkChanged);
    window.addEventListener("pageshow",networkChanged);
    document.addEventListener("visibilitychange",resume);
    return()=>{
      window.removeEventListener("online",networkChanged);
      window.removeEventListener("offline",networkChanged);
      window.removeEventListener("focus",networkChanged);
      window.removeEventListener("pageshow",networkChanged);
      document.removeEventListener("visibilitychange",resume);
      if(maintenanceIdle!==undefined)idleWindow.cancelIdleCallback?.(maintenanceIdle);
      if(maintenanceTimer!==undefined)window.clearTimeout(maintenanceTimer);
    };
  },[]);

  useEffect(()=>{
    if(workspaceOpen)return;
    const readSignals=()=>{
      const canExpense=session.user.role==="admin"||session.user.permissions?.report===true;
      const canStartDay=session.user.role==="admin";
      let pendingExpense=false,expenseRecoveryBlocked=false,pendingOpenShift=false,startDayRecoveryBlocked=false;
      if(canExpense){
        try{pendingExpense=!!readExpenseIntent(session.user.id)}
        catch{expenseRecoveryBlocked=true}
      }
      if(canStartDay){
        try{pendingOpenShift=!!readCashShiftOpenIntent(session.user.id)}
        catch{startDayRecoveryBlocked=true}
      }
      setWorkspaceSignals({pendingExpense,expenseRecoveryBlocked,pendingOpenShift,startDayRecoveryBlocked});
    };
    readSignals();
    const onFocus=()=>readSignals(),onStorage=()=>readSignals();
    window.addEventListener("focus",onFocus);
    window.addEventListener("storage",onStorage);
    return()=>{window.removeEventListener("focus",onFocus);window.removeEventListener("storage",onStorage)};
  },[workspaceOpen,session.user.id,session.user.role,session.user.permissions?.report]);

  useEffect(()=>{
    if(!online||method!=="promptpay"||!payOpen)return;
    // Never reconcile while checkout itself is still opening this QR: two concurrent
    // ensurePendingPrompt calls collide and the QR vanished (field report 2026-11-16).
    const tick=()=>{if(checkoutInFlightRef.current)return;const p=pendingRead();if(p&&!p.parked)recoverPending().catch(()=>{})};
    const timer=window.setInterval(tick,2000);
    return()=>window.clearInterval(timer);
  },[online,method,payOpen,session.csrf]);

  const parkedRecord=pendingRead()?.parked?pendingRead():null;
  useEffect(()=>{
    if(!online||!parkedRecord)return;
    const tick=()=>{if(pendingRead()?.parked)recoverPending().catch(()=>{})};
    tick();
    const timer=window.setInterval(tick,2000);
    return()=>window.clearInterval(timer);
  },[online,!!parkedRecord,session.csrf]);

  useEffect(()=>{
    if(online)return;
    setMethod("cash");
    setSplitBill(false);
    setSplitSelection({});
    setCustomerId("");
    setPointsRedeemed(0);
  },[online]);

  useEffect(()=>{
    if(splitGroup&&cart.items.length===0){splitGroupClear();setSplitGroup(null)}
  },[cart.items.length,splitGroup?.orderId]);

  useEffect(()=>{
    try{
      const raw=sessionStorage.getItem("field-pos-edit-cash-v1");
      if(!raw)return;
      sessionStorage.removeItem("field-pos-edit-cash-v1");
      const edit=JSON.parse(raw),heldCash=Number(edit?.heldCash);
      if(Number.isFinite(heldCash)&&heldCash>0){
        setMethod("cash");
        setReceived(String(heldCash));
        setNotice("กำลังแก้ไข "+String(edit?.fromQueue||edit?.fromBill||"บิลเดิม")+" · ยอดเงินสดจากบิลเดิม ฿"+formatBaht(heldCash)+" ถูกกรอกไว้แล้ว เพิ่ม/ลด/เปลี่ยนเมนูแล้วกดชำระเงินใหม่");
      }
    }catch{}
  },[]);

  useEffect(()=>{
    const refresh=()=>{if(document.visibilityState==="hidden")return;load().catch(()=>{})};
    const visible=()=>{if(document.visibilityState==="visible")refresh()};
    const timer=setInterval(refresh,15000);
    window.addEventListener("focus",refresh);document.addEventListener("visibilitychange",visible);
    return()=>{clearInterval(timer);window.removeEventListener("focus",refresh);document.removeEventListener("visibilitychange",visible)}
  },[]);

  // Keep pager and change visible until the operator chooses the next step.

  useEffect(()=>{
    if(!data)return;
    const byId=new Map((data.menu||[]).filter(sellable).map(x=>[x.id,x]));
    const removed:string[]=[];
    let changed=false;
    const next=cart.items.flatMap(item=>{
      const current=byId.get(item.id);
      const currentVariant=current?.variants?.find(v=>v.label===item.variant);
      if(!current||!currentVariant){removed.push(item.name);changed=true;return []}
      if(!currentVariant.available){
        const missing=(currentVariant.missingIngredients||[]).map(x=>x.name).join(", ");
        removed.push(item.name+(missing?" (ขาด "+missing+")":""));
        changed=true;
        return [];
      }
      if(item.name!==current.name||item.price!==current.price){changed=true;return [{...item,name:current.name,price:current.price}]}
      return [item];
    });
    if(changed)cart.replaceItems(next);
    if(removed.length)setNotice("นำ "+removed.join(", ")+" ออกจากตะกร้าอัตโนมัติ เพราะสต็อกหรือสูตรไม่พร้อม กรุณาตรวจยอดก่อนชำระ");
  },[data?.revision]);

  const cats=useMemo(()=>["ทั้งหมด",...Array.from(new Set((data?.menu||[]).filter(sellable).map(x=>x.category||"อื่นๆ")))], [data?.menu]);
  const menu=useMemo(()=>{const needle=q.trim().toLowerCase();return availableMenusFirst((data?.menu||[]).filter(x=>sellable(x)&&(cat==="ทั้งหมด"||(x.category||"อื่นๆ")===cat)&&(!needle||x.name.toLowerCase().includes(needle))))},[data?.menu,cat,q]);
  const hasConfiguredMenu=(data?.menu||[]).some(sellable);
  const allUnavailable=menu.length>0&&menu.every(x=>!x.available);
  const unavailableNames=useMemo(()=>Array.from(new Set(menu.flatMap(x=>x.variants.flatMap(v=>v.missingIngredients||[]).map(i=>i.name)))).slice(0,4),[menu]);
  const cartQtyByMenu=useMemo(()=>{const m=new Map<string,number>();for(const i of cart.items)m.set(i.id,(m.get(i.id)||0)+Number(i.qty||0));return m},[cart.items]);
  const cartStockState=useMemo(()=>cartAvailability({cart:cart.items,menu:data?.menu||[],stock:data?.availabilityStock||{}}),[cart.items,data?.menu,data?.availabilityStock]);
  const total=useMemo(()=>cart.items.reduce((sum,item)=>sum+item.price*item.qty,0),[cart.items]);
  const payableItems=splitBill?cart.items.map(i=>({...i,qty:Math.min(i.qty,Math.max(0,Number(splitSelection[i.key])||0))})).filter(i=>i.qty>0):cart.items;
  const payableQty=payableItems.reduce((s,i)=>s+i.qty,0);
  const payableTotal=payableItems.reduce((s,i)=>s+i.price*i.qty,0);
  const selectedCustomer=customers.find(x=>x.id===customerId)||null;
  const redeemValue=Math.max(0,Number(loyalty.pointsRedeemValue)||0);
  const maxRedeemPoints=selectedCustomer&&redeemValue>0?Math.max(0,Math.min(Number(selectedCustomer.points)||0,Math.floor((payableTotal+1e-9)/redeemValue))):0;
  const redeemPoints=Math.max(0,Math.min(Math.trunc(Number(pointsRedeemed)||0),maxRedeemPoints));
  const crmDiscount=Math.round(redeemPoints*redeemValue*100)/100;
  const netPayable=Math.max(0,Math.round((payableTotal-crmDiscount)*100)/100);
  const estimatedPointsAwarded=selectedCustomer&&loyalty.pointsSpend>0?Math.floor(netPayable/loyalty.pointsSpend):0;
  const remainingAfterBill=Math.max(0,cart.items.reduce((s,i)=>s+i.qty,0)-payableQty);
  const cashReceived=received.trim()===""?NaN:Number(received);
  const cashDelta=Number.isFinite(cashReceived)?cashReceived-netPayable:NaN;
  const deliveryRates=data?.settings?.deliveryGp||{};
  const deliveryGpRate=Math.max(0,Math.min(.8,Number(deliveryRates?.[deliveryPlatform])||0));
  const deliveryGpFee=Math.round(netPayable*deliveryGpRate*100)/100;
  const deliveryNetSettlement=Math.round((netPayable-deliveryGpFee)*100)/100;

  useEffect(()=>{if(pointsRedeemed>maxRedeemPoints)setPointsRedeemed(maxRedeemPoints)},[pointsRedeemed,maxRedeemPoints]);

  function applyServerState(r:any){
    const revision=Number(r?.revision)||0;
    if(!revision)return;
    revisionRef.current=Math.max(revisionRef.current||0,revision);
    setData(prev=>prev?{...prev,revision:Math.max(prev.revision,revision)}:prev);
  }

  function subtractPaidCart(payload:{id:string;variant:string;qty:number}[]){
    const remaining=cart.items.flatMap(item=>{
      const paid=payload.find(x=>x.id===item.id&&x.variant===item.variant);
      if(!paid)return [item];
      const qty=item.qty-Math.min(item.qty,Number(paid.qty)||0);
      return qty>0?[{...item,qty}]:[];
    });
    cart.replaceItems(remaining);
    return remaining;
  }

  function warmQueueSnapshot(){
    api<any>("/api/pos/queue").then(snapshot=>{if(snapshot&&Array.isArray(snapshot.orders))writeQueueSnapshotCache(snapshot)}).catch(()=>{});
  }

  async function refreshOfflineStats(){
    try{setOfflineStats(await getOfflineCashSummary());setOfflineStorageError(false)}
    catch(error){setOfflineStorageError(true);throw error}
  }

  async function syncOfflineQueue(){
    if(offlineSyncRef.current||typeof navigator!=="undefined"&&!navigator.onLine)return;
    offlineSyncRef.current=true;
    try{
      const sync=await syncOfflineCashSales(session);
      setOfflineStorageError(false);
      setOfflineStats({pending:sync.pending,needsReview:sync.needsReview,total:sync.total});
      if(sync.synced>0){
        setNotice("ซิงก์ยอดเงินสด Offline สำเร็จ "+sync.synced+" บิล · Cloud/Stock อัปเดตแล้ว"+(sync.promptPayUnverified>0?" · PromptPay "+sync.promptPayUnverified+" บิลยังไม่เจอแจ้งเตือนธนาคาร ให้ตรวจยอดในแอปธนาคารตอนปิดวัน":sync.promptPayMatched>0?" · PromptPay "+sync.promptPayMatched+" บิลตรวจยอดกับธนาคารแล้ว":""));
        await load(true).catch(()=>{});
        await loadCustomers().catch(()=>{});
      }
      if(sync.needsReview>0)setNotice("มีบิล Offline "+sync.needsReview+" รายการที่ต้องตรวจสอบก่อนลง Cloud · ระบบเก็บรายการไว้และไม่ลบทิ้ง");
    }catch(error:any){
      if(error?.message==="offline_storage_unavailable")setOfflineStorageError(true);
      throw error;
    }finally{offlineSyncRef.current=false}
  }

  function finishOfflineSale(localNo:string,opts:{total:number;received:number;paidCart:{id:string;variant:string;qty:number}[];payment?:"cash"|"promptpay"}){
    const projected=applyOfflineCashToBootstrap(data,opts.paidCart);
    if(projected){
      setData(projected);
      cachePut("/api/pos/bootstrap",projected).catch(()=>{});
    }
    setPayOpen(false);
    setResult("");
    setPrompt(null);setQrPreview(null);
    cart.clearCart();
    setReceived("");
    setCustomerId("");
    setPointsRedeemed(0);
    setSplitSelection({});
    setSplitBill(false);
    splitGroupClear();setSplitGroup(null);
    setLastSale({queueNo:localNo,pager:0,total:opts.total,received:opts.received,change:Math.max(0,opts.received-opts.total),payment:opts.payment||"cash",offline:true});
    setNotice(opts.payment==="promptpay"
      ?"บันทึก PromptPay แบบ Offline แล้ว · "+localNo+" · เน็ตกลับแล้วระบบจับคู่กับแจ้งเตือนธนาคารให้เอง"
      :"บันทึกเงินสดแบบ Offline แล้ว · "+localNo+" · ระบบจะซิงก์ Cloud อัตโนมัติเมื่ออินเทอร์เน็ตกลับมา");
    refreshOfflineStats().catch(()=>{});
  }

  function finishSale(r:any,opts:{payment:"cash"|"promptpay"|"bank"|"card"|"delivery";total:number;received:number;recovered?:boolean;splitBill?:boolean;paidCart?:{id:string;variant:string;qty:number}[];background?:boolean}){
    applyServerState(r);
    if(opts.background){
      // A parked PromptPay bill was paid while the operator is already on the
      // next order: never touch the current cart or payment sheet.
      announcePayment(Number(r?.total??opts.total));
      setParkedStatus(null);setParkedOpen(false);setDirectConfirmArmed(false);setParkedTick(t=>t+1);
      setNotice("ได้รับเงิน PromptPay ฿"+formatBaht(Number(r?.total??opts.total))+" · คิว "+String(r?.queueNo||"—")+" เข้าคิวแล้ว");
      warmQueueSnapshot();
      window.setTimeout(()=>load(true).catch(()=>{}),250);
      return;
    }
    setDirectConfirmArmed(false);
    if(opts.payment==="promptpay")announcePayment(Number(r?.total??opts.total));
    const serverTotal=Number(r?.total??opts.total);
    const serverReceived=Number(r?.received??opts.received);
    const serverChange=Number(r?.change??(opts.payment==="cash"?Math.max(0,serverReceived-serverTotal):0));
    setPayOpen(false);
    setResult("");
    setPrompt(null);setQrPreview(null);
    const remaining=opts.splitBill&&opts.paidCart?subtractPaidCart(opts.paidCart):(cart.clearCart(),[]);
    setReceived("");
    setCustomerId("");
    setPointsRedeemed(0);
    setSplitSelection({});
    setSplitBill(false);
    if(remaining.length&&(opts.splitBill||splitGroup)){
      const orderId=String(r?.orderId||splitGroup?.orderId||"");
      const queueNo=String(r?.queueNo||splitGroup?.queueNo||"—");
      const pager=Number(r?.pager??splitGroup?.pager??0);
      if(orderId){
        const group={orderId,queueNo,pager,createdAt:splitGroup?.createdAt||Date.now()};
        splitGroupWrite(group);setSplitGroup(group);
      }
      const qty=remaining.reduce((s,i)=>s+i.qty,0);
      setNotice("ชำระแยกสำเร็จ · ลูกค้ากลุ่มนี้ใช้คิว "+queueNo+" เดียวกัน · เหลือ "+qty+" แก้วในตะกร้า รอรับเงินคนถัดไป");
    }else if(!remaining.length){
      splitGroupClear();setSplitGroup(null);
    }
    setLastSale({
      queueNo:String(r?.queueNo||"—"),
      pager:Number(r?.pager)||0,
      billNo:r?.billNo?String(r.billNo):undefined,
      total:serverTotal,
      received:serverReceived,
      change:serverChange,
      payment:opts.payment,
      recovered:opts.recovered
    });
    warmQueueSnapshot();
    window.setTimeout(()=>load(true).catch(()=>{}),250);
    window.setTimeout(()=>loadCustomers().catch(()=>{}),500);
  }

  function availabilityMessage(result:ReturnType<typeof cartAvailability>){
    if(result.shortages.length)return "วัตถุดิบเพียงพอไม่ครบสำหรับตะกร้านี้ · ขาด: "+result.shortages.map(x=>x.name).join(", ");
    return "มีเมนูหรือตัวเลือกที่หมดชั่วคราว กรุณาตรวจตะกร้า";
  }

  async function validateCartChange(next:{id:string;variant:string;qty:number}[],apply:()=>void,allowShortage=false){
    if(cartCheckInFlightRef.current||checkoutInFlightRef.current)return;
    // Fast path: a fresh local projection that already allows the change is
    // applied in the same frame. Precheck never reserves stock; payment opening
    // and the server checkout transaction remain the stock authority.
    const plan=planCartChange({next,menu:data?.menu,stock:data?.availabilityStock,allowShortage,projectionAt:projectionAtRef.current});
    if(plan.mode==="apply-local"){
      const before=useCartStore.getState().items;
      apply();
      revalidateCartInBackground(allowShortage?null:{before,after:useCartStore.getState().items});
      return;
    }
    cartCheckInFlightRef.current=true;
    const before=JSON.stringify(useCartStore.getState().items);
    try{
      // Refresh the authoritative stock projection before changing the cart.
      // The checkout transaction remains the final concurrency guard.
      const fresh=await api<Bootstrap>("/api/pos/bootstrap");
      if(JSON.stringify(useCartStore.getState().items)!==before)return;
      if(fresh.revision<(revisionRef.current||0)){setNotice("ข้อมูลสต็อกเปลี่ยน กรุณาลองอีกครั้ง");return}
      acceptBootstrap(fresh);
      const checked=cartAvailability({cart:next,menu:fresh.menu,stock:fresh.availabilityStock||{}});
      if(!checked.available){setNotice(availabilityMessage(checked));if(!allowShortage)return}
      apply();
    }catch{setNotice("ยังตรวจสอบสต็อกล่าสุดไม่ได้ กรุณาเชื่อมต่อแล้วลองอีกครั้ง")}
    finally{cartCheckInFlightRef.current=false}
  }

  // Revision-aware refresh after an instant cart change. GET requests are
  // coalesced by the API client, so rapid taps share one network read.
  // If the server says the tap is no longer sellable (sold on another device),
  // the instant change is rolled back so the cart matches the tap-time precheck.
  function revalidateCartInBackground(guard:{before:CartItems;after:CartItems}|null){
    api<Bootstrap|RevisionUnchanged>("/api/pos/bootstrap",revisionRef.current!==null?{headers:{"X-Field-Revision":String(revisionRef.current)}}:{}).then(res=>{
      if(!acceptBootstrap(res))return;
      const fresh=res as Bootstrap,latest=useCartStore.getState().items;
      if(!latest.length)return;
      const checked=cartAvailability({cart:latest,menu:fresh.menu,stock:fresh.availabilityStock||{}});
      if(checked.available)return;
      if(guard&&useCartStore.getState().items===guard.after)cart.replaceItems(guard.before);
      setNotice(availabilityMessage(checked));
    }).catch(()=>{});
  }

  function addVariant(product:MenuItem,variant:MenuItem["variants"][number],onAdded?:()=>void){
    const remaining=additionalServingsForVariant({variant,demand:cartStockState.demand,stock:data?.availabilityStock||{}});
    if(!variant.available||remaining<1){setNotice("วัตถุดิบเพียงพออีก 0 แก้วเท่านั้น"+(variant.missingIngredients?.length?" · ขาด: "+variant.missingIngredients.map(x=>x.name).join(", "):""));return}
    // Read the live store, not the render snapshot, so two taps in one frame
    // are both counted in the availability check.
    const next=useCartStore.getState().items.map(x=>({id:x.id,variant:x.variant,qty:x.qty}));
    const existing=next.find(x=>x.id===product.id&&x.variant===variant.label);
    if(existing)existing.qty+=1;else next.push({id:product.id,variant:variant.label,qty:1});
    void validateCartChange(next,()=>{cart.addItem({id:product.id,name:product.name,variant:variant.label,price:product.price});setSelected(null);tapHaptic();onAdded?.()});
  }

  function chooseMenu(product:MenuItem){
    // One tap = the shop's default recipe (normal sweetness). Sweetness is
    // changed from the cart chips; size-style variants still open the picker.
    const quick=quickAddVariant(product.variants);
    if(quick){
      addVariant(product,quick,product.variants.length>1?()=>setLastQuick({key:product.id+"::"+quick.label,id:product.id,name:product.name,variant:quick.label,at:Date.now()}):()=>setLastQuick(null));
      return;
    }
    setSelected(product);
  }

  // Move one cup of a cart line to another sweetness of the same menu. Uses the
  // same stock check as any cart change (recipes differ per variant).
  useEffect(()=>{
    if(!lastQuick)return;
    const timer=window.setTimeout(()=>setLastQuick(current=>current?.at===lastQuick.at?null:current),8000);
    return()=>window.clearTimeout(timer);
  },[lastQuick]);

  function changeVariant(key:string,label:string){
    const live=useCartStore.getState().items;
    const moved=moveOneUnitToVariant(live,key,label);
    if(moved===live)return;
    const next=moved.map(x=>({id:x.id,variant:x.variant,qty:x.qty}));
    void validateCartChange(next,()=>{cart.replaceItems(moved);tapHaptic()});
  }

  function sweetnessChips(item:{key:string;id:string;name:string;variant:string;qty:number},locked=false){
    const product=data?.menu.find(m=>m.id===item.id);
    if(!product||product.variants.length<2)return <small className="mt-1 block text-slate-500">{orderOptionLabel(item.variant)}</small>;
    return <div className="mt-2">
      <div role="group" aria-label={"ความหวาน "+item.name} className="flex flex-wrap gap-1.5">
        {product.variants.map(v=>{const active=v.label===item.variant;return <button key={v.label} type="button" data-sweetness-chip aria-pressed={active} disabled={locked||(!active&&!v.available)} onClick={()=>changeVariant(item.key,v.label)} className={"min-h-11 rounded-xl border px-3 text-xs font-bold "+(active?"border-[#1F4D3A] bg-[#1F4D3A] text-white":"border-slate-300 bg-white text-slate-700")}>{shortVariantLabel(v.label)}</button>})}
      </div>
      {item.qty>1&&<small className="mt-1 block text-[11px] text-slate-500">แตะความหวานอื่นเพื่อเปลี่ยนทีละ 1 แก้ว</small>}
    </div>;
  }

  function updateCartQuantity(key:string,nextQty:number){
    const liveItems=useCartStore.getState().items;
    const item=liveItems.find(x=>x.key===key);if(!item)return;
    const next=liveItems.map(x=>({id:x.id,variant:x.variant,qty:x.key===key?nextQty:x.qty})).filter(x=>x.qty>0);
    if(nextQty<=item.qty){void validateCartChange(next,()=>cart.updateQuantity(key,nextQty),true);return}
    const remaining=additionalServingsAvailable({cart:cart.items,menu:data?.menu||[],stock:data?.availabilityStock||{},menuId:item.id,variantLabel:item.variant,demand:cartStockState.demand});
    if(remaining<1){setNotice("วัตถุดิบเพียงพออีก 0 แก้วเท่านั้น");return}
    void validateCartChange(next,()=>cart.updateQuantity(key,nextQty));
  }

  function holdCurrentBill(){
    if(!cart.items.length)return;
    if((pendingRead()&&!pendingRead()?.parked)||cashPendingRead()){
      setNotice("ยังมีรายการชำระเงินเดิมที่รอตรวจสอบ · ยังพักบิลนี้ไม่ได้จนกว่าจะยืนยันสถานะเดิม");
      return;
    }
    if(splitGroup){
      setNotice("บิลนี้เป็นการจ่ายต่อของคิว "+splitGroup.queueNo+" · ต้องรับเงินกลุ่มนี้ให้ครบก่อน จึงไม่สามารถพักเป็นบิลใหม่ได้");
      return;
    }
    const qty=cart.items.reduce((s,i)=>s+i.qty,0);
    const saved=heldBills.holdCart(cart.items);
    cart.clearCart();
    setSelected(null);
    setPayOpen(false);
    setReceived("");
    setCustomerId("");
    setPointsRedeemed(0);
    setSplitBill(false);
    setSplitSelection({});
    setNotice("พักบิลแล้ว · "+qty+" แก้ว · เวลา "+localTime(saved.createdAt)+" · รับลูกค้าคิวถัดไปได้ทันที");
  }

  function resumeHeldBill(id:string){
    if(cart.items.length){
      setHeldOpen(false);
      setNotice("ตะกร้าปัจจุบันยังมีสินค้า · กดพักบิลปัจจุบันก่อน แล้วจึงเรียกบิลเดิมกลับ");
      return;
    }
    const held=heldBills.held.find(x=>x.id===id);
    if(!held)return;
    const byId=new Map((data?.menu||[]).filter(sellable).map(x=>[x.id,x]));
    const removed:string[]=[];
    const next=held.items.flatMap(item=>{
      const current=byId.get(item.id),variant=current?.variants?.find(v=>v.label===item.variant);
      if(!current||!variant||!variant.available){removed.push(item.name);return []}
      return [{...item,name:current.name,price:current.price}];
    });
    heldBills.removeHeld(id);
    setHeldOpen(false);
    if(!next.length){
      setNotice("บิลที่พักไว้ไม่สามารถขายได้แล้ว เพราะเมนู/สูตร/สต็อกเปลี่ยน · ลบบิลพักออกแล้ว");
      return;
    }
    cart.replaceItems(next);
    const availability=cartAvailability({cart:next,menu:data?.menu||[],stock:data?.availabilityStock||{}});
    const notes:string[]=["เรียกบิลพักเวลา "+localTime(held.createdAt)+" กลับมาแล้ว"];
    if(removed.length)notes.push("นำ "+removed.join(", ")+" ออกเพราะหมดหรือสูตรไม่พร้อม");
    if(!availability.available)notes.push(availabilityMessage(availability));
    else notes.push("ตรวจราคาและจำนวนแล้วกดชำระได้");
    setNotice(notes.join(" · "));
  }

  function startNextOrder(){
    setLastSale(null);
    setNotice("");
    setResult("");
    setPrompt(null);setQrPreview(null);
    setReceived("");
    setMethod("cash");
    setSelected(null);
    setQ("");
    setCat("ทั้งหมด");
  }


  async function recoverCashCheckout(){
    if(cashReconcileRef.current)return;
    cashReconcileRef.current=true;
    try{
      const p=cashPendingRead();
      if(!p)return;
      if(Date.now()-Number(p.createdAt||0)>24*60*60*1000){
        setNotice("พบรายการเงินสดค้างเกิน 24 ชม. กรุณาตรวจ Orders ก่อนดำเนินการต่อ");
        return;
      }
      try{
        const r=await api<any>("/api/pos/checkout",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(p.body)});
        cashPendingClear();
        finishSale(r,{payment:"cash",total:Number(p.body?.total)||0,received:Number(p.body?.received)||0,recovered:true,splitBill:p.body?.checkoutMode==="split_bill",paidCart:Array.isArray(p.body?.cart)?p.body.cart:undefined});
      }catch(e:any){
        if(e.message==="business_date_changed")setNotice("รายการเงินสดค้างข้ามวัน · กรุณาตรวจ Orders ก่อน หากไม่พบบิลให้บันทึกปรับปรุงด้วย Admin");
        else if(!["network_unavailable","offline_write_blocked"].includes(e.message)){
          cashPendingClear();
          setNotice("ตรวจรายการเงินสดค้างไม่สำเร็จ · "+errorText(e.message));
        }
      }
    }finally{
      cashReconcileRef.current=false;
    }
  }

  function completePrompt(p:PendingPrompt,r:any,opts:Parameters<typeof finishSale>[1],alwaysClear:boolean){
    pendingClear();
    if(p.parked){finishSale(r,{...opts,background:true});return}
    if(alwaysClear||p.checkoutMode!=="split_bill")cart.clearCart();
    finishSale(r,opts);
  }

  // Solo flow: keep waiting for the bank in the background and take the next
  // order. Allowed only once the QR exists on the server (session + charge),
  // so the parked bill keeps its own cart snapshot and stock reservation.
  function parkPendingPrompt(){
    const p=pendingRead();
    if(!p||p.parked||!p.sessionId||!p.paymentReference||p.checkoutMode==="split_bill"||splitGroup)return;
    if(String(prompt?.status||"").toLowerCase()!=="pending")return;
    pendingWrite({...p,parked:true,parkedAt:Date.now()});
    setParkedStatus(prompt);
    setDirectConfirmArmed(false);
    cart.clearCart();
    setPrompt(null);setQrPreview(null);setResult("");setReceived("");setMethod("cash");
    setPayOpen(false);
    setParkedTick(t=>t+1);
    setNotice("QR ฿"+formatBaht(p.total)+" รอเงินเข้าอยู่เบื้องหลัง · รับออเดอร์ถัดไปได้เลย");
  }

  async function cancelParkedPrompt(){
    const p=pendingRead();
    if(!p?.parked||parkedBusy)return;
    setParkedBusy(true);
    try{
      await cancelPendingReservation(p);
      pendingClear();
      // Put the cups back so the operator can take cash, unless a new order is already in the cart.
      if(!useCartStore.getState().items.length&&data){
        const items=p.cart.map(x=>{const m=data.menu.find(mm=>mm.id===x.id);return m?{key:x.id+"::"+x.variant,id:x.id,name:m.name,variant:x.variant,price:m.price,qty:x.qty}:null}).filter(Boolean) as CartItems;
        if(items.length)cart.replaceItems(items);
      }
      setParkedStatus(null);setParkedOpen(false);setParkedTick(t=>t+1);
      setNotice("ยกเลิก QR ฿"+formatBaht(p.total)+" แล้ว · รับเงินวิธีอื่นได้");
    }catch(e:any){setNotice(e?.message==="promptpay_already_paid"?"QR นี้ได้รับเงินแล้ว · ระบบกำลังบันทึกเข้าคิว":"ยกเลิก QR ไม่สำเร็จ · ลองอีกครั้ง")}
    finally{setParkedBusy(false)}
  }

  async function finalizePending(p:PendingPrompt,verified:string){
    if(p.sessionId){
      const status=await api<any>("/api/pos/split/status",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({sessionId:p.sessionId})});
      if(status?.session?.status==="completed"){
        completePrompt(p,{orderId:status.session.orderId,queueNo:status.session.queueNo,pager:status.session.pager,total:status.session.total},{payment:"promptpay",total:p.total,received:p.total,recovered:true,splitBill:p.checkoutMode==="split_bill",paidCart:p.cart},false);
        return status;
      }
      const allocations=p.cart.map((x,index)=>({index,qty:x.qty}));
      const body={requestKey:p.payRequestKey||crypto.randomUUID(),sessionId:p.sessionId,method:"promptpay",allocations,paymentReference:p.paymentReference,paymentVerified:verified,label:"PromptPay"};
      try{
        const r=await api<any>("/api/pos/split/pay",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)});
        completePrompt(p,r,{payment:"promptpay",total:p.total,received:p.total,recovered:true,splitBill:p.checkoutMode==="split_bill",paidCart:p.cart},true);
        return r;
      }catch(e:any){
        if(e.message==="split_session_unavailable"){
          const retry=await api<any>("/api/pos/split/status",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({sessionId:p.sessionId})});
          if(retry?.session?.status==="completed"){
            completePrompt(p,{orderId:retry.session.orderId,queueNo:retry.session.queueNo,pager:retry.session.pager,total:retry.session.total},{payment:"promptpay",total:p.total,received:p.total,recovered:true,splitBill:p.checkoutMode==="split_bill",paidCart:p.cart},false);
            return retry;
          }
        }
        throw e;
      }
    }
    const body={requestKey:p.requestKey,date:p.date,cart:p.cart,payment:"promptpay",received:p.total,paymentReference:p.paymentReference,paymentVerified:verified,customerId:p.customerId,pointsRedeemed:Number(p.pointsRedeemed||0),checkoutMode:p.checkoutMode||"full",targetOrderId:p.targetOrderId||undefined};
    const r=await api<any>("/api/pos/checkout",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)});
    completePrompt(p,r,{payment:"promptpay",total:p.total,received:p.total,recovered:true,splitBill:p.checkoutMode==="split_bill",paidCart:p.cart},true);
    return r;
  }

  async function cancelPendingReservation(p:PendingPrompt){
    if(!p.sessionId)return;
    try{
      if(p.paymentReference){
        await api<any>("/api/pos/split/provider-release",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({requestKey:crypto.randomUUID(),sessionId:p.sessionId,paymentReference:p.paymentReference})});
      }else{
        await api<any>("/api/pos/split/cancel",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({requestKey:crypto.randomUUID(),sessionId:p.sessionId})});
      }
    }catch(e:any){
      if(!["split_session_unavailable","split_session_not_found"].includes(e.message))throw e;
    }
  }

  async function ensurePendingPrompt(p:PendingPrompt){
    let next={...p};
    if(!next.sessionId){
      const reserved=await api<any>("/api/pos/split/start",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({requestKey:next.requestKey,date:next.date,cart:next.cart,customerId:next.customerId,pointsRedeemed:Number(next.pointsRedeemed||0),mode:"promptpay_full",targetOrderId:next.targetOrderId||undefined})});
      const serverTotal=Number(reserved?.session?.total);
      if(!reserved?.session?.id||!Number.isFinite(serverTotal)||serverTotal<=0)throw new Error("promptpay_reservation_failed");
      next={...next,sessionId:reserved.session.id,total:serverTotal};
      pendingWrite(next);
    }
    let st:any=null;
    if(!next.paymentReference){
      st=await api<any>("/api/payments/promptpay/create",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({reference:next.sessionId})});
      if(!st?.chargeId)throw new Error("promptpay_qr_unavailable");
      next={...next,paymentReference:st.chargeId};
      pendingWrite(next);
    }
    return {pending:next,status:st};
  }

  async function confirmDirectPayment(chargeIdArg?:string){
    const chargeId=typeof chargeIdArg==="string"?chargeIdArg:prompt?.chargeId;
    if(!session||!chargeId||directConfirmBusy)return;
    setDirectConfirmBusy(true);
    try{
      await api<any>("/api/payments/promptpay/direct/confirm",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({chargeId})});
      setDirectConfirmArmed(false);
      // The normal pending-payment path re-reads the charge on the server and finalises once.
      await recoverPending();
    }catch(e:any){setResult(errorText(String(e?.message||"")))}
    finally{setDirectConfirmBusy(false)}
  }

  async function recoverPending(){
    if(promptReconcileRef.current)return;
    if(checkoutInFlightRef.current)return;
    promptReconcileRef.current=true;
    let p=pendingRead();
    if(!p){promptReconcileRef.current=false;return}
    try{
      if(!p.sessionId||!p.paymentReference){
        const resumed=await ensurePendingPrompt(p);
        p=resumed.pending;
        if(resumed.status)setPrompt(resumed.status);
      }
      if(p.sessionId){
        const sessionStatus=await api<any>("/api/pos/split/status",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({sessionId:p.sessionId})});
        if(sessionStatus?.session?.status==="completed"){
          completePrompt(p,{orderId:sessionStatus.session.orderId,queueNo:sessionStatus.session.queueNo,pager:sessionStatus.session.pager,total:sessionStatus.session.total},{payment:"promptpay",total:p.total,received:p.total,recovered:true,splitBill:p.checkoutMode==="split_bill",paidCart:p.cart},false);
          return;
        }
        if(["expired","cancelled"].includes(String(sessionStatus?.session?.status||"").toLowerCase())){pendingClear();if(p.parked){setParkedStatus(null);setParkedOpen(false);setParkedTick(t=>t+1)}return}
      }
      const st=await api<any>("/api/payments/promptpay/status",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({chargeId:p.paymentReference})});
      if(st.paid){await finalizePending(p,st.chargeId||p.paymentReference);return}
      if(["failed","expired","reversed","cancelled"].includes(String(st.status||"").toLowerCase())){
        await cancelPendingReservation(p);pendingClear();
        if(p.parked){setParkedStatus(null);setParkedOpen(false);setParkedTick(t=>t+1);setNotice("QR ฿"+formatBaht(p.total)+" หมดเวลา · ยังไม่ได้รับเงิน")}
        return;
      }
      if(p.parked){setParkedStatus(st);return}
      setMethod("promptpay");
      setPrompt(st);
      setPayOpen(true);
      setResult("พบ PromptPay ที่ยังรอชำระ ระบบใช้ QR เดิม ตรวจสอบรายการเดิม และยังคงจอง Stock ไว้เพื่อป้องกันรับเงินเกินจำนวนที่ขายได้");
    }catch{
      if(p?.parked)return;
      setMethod("promptpay");
      setPayOpen(true);
      setResult("ยังตรวจสอบ PromptPay รายการเดิมไม่ได้ ระบบเก็บรายการและการจองวัตถุดิบเดิมไว้ เพื่อป้องกันบิลหรือการรับเงินซ้ำ");
    }finally{
      promptReconcileRef.current=false;
    }
  }

  function errorText(code:string){
    return code==="cash_insufficient"?"จำนวนเงินรับไม่พอ":
      code==="promptpay_direct_amount_in_use"?"มี QR ยอดเดียวกันรอจ่ายอยู่ · ปิดหรือยกเลิก QR เดิมก่อน เพื่อไม่ให้ยอดโอนจับคู่ผิดบิล":
      code==="promptpay_direct_not_pending"?"QR นี้ไม่ได้รอจ่ายแล้ว (หมดเวลา/ยกเลิก/จ่ายแล้ว) · ระบบกำลังตรวจสถานะล่าสุด":
      code==="menu_unavailable"?"มีเมนูในตะกร้าที่ปิดขาย ราคาเป็น 0 หรือยังไม่พร้อมขาย กรุณาตรวจตะกร้าใหม่":
      code==="request_key_conflict"?"รายการเดิมถูกเปลี่ยน กรุณาตรวจประวัติออเดอร์ก่อนชำระอีกครั้ง":
      code==="recipe_unavailable"?"สูตรเมนูยังไม่ครบหรือมีปริมาณผิด กรุณาตรวจสูตรก่อนขาย":
      code==="day_closed"?"วันนี้ปิดยอดแล้ว ไม่สามารถรับรายการขายเพิ่มได้":
      code==="cash_shift_not_open"?"ยังไม่ได้เปิดกะเงินสดวันนี้ · เปิดงานร้านก่อนรับเงินสด หรือเลือก PromptPay/ช่องทางอื่น":
      code==="variant_unavailable"?"ตัวเลือกของเมนูในตะกร้าเปลี่ยนแล้ว กรุณาเลือกเมนูใหม่":
      (code==="stock_shortage"||code.startsWith("stock_shortage:"))?"วัตถุดิบไม่เพียงพอสำหรับออเดอร์นี้":
      code==="promptpay_timeout"?"หมดเวลารอ PromptPay ระบบยังเก็บรายการจองไว้ชั่วคราวและจะตรวจสอบอีกครั้ง":
      code==="promptpay_not_ready"?"PromptPay ยังไม่พร้อมใช้งาน กรุณารอ Beam อนุมัติและตั้งค่า API/Webhook ให้ครบ":
      code==="promptpay_provider_not_configured"?"ยังไม่ได้ตั้งค่า Beam Merchant ID / API Key":
      code==="promptpay_webhook_not_configured"?"ยังไม่ได้ตั้งค่า Beam Webhook HMAC Key":
      code==="promptpay_failed"?"PromptPay ไม่สำเร็จ กรุณาลองใหม่":
      code==="promptpay_charge_already_used"?"เลขชำระนี้ถูกบันทึกแล้ว กรุณาตรวจประวัติออเดอร์ก่อนรับเงินซ้ำ":
      ["promptpay_reference_mismatch","promptpay_currency_mismatch"].includes(code)?"ข้อมูลการชำระไม่ตรงกับรายการนี้ กรุณาคงรายการไว้และให้ผู้ดูแลตรวจสอบ":
      code==="pending_promptpay_exists"?"มี PromptPay รายการเดิมที่ยังไม่สิ้นสุด กรุณาชำระหรือรอผลรายการเดิม":
      code==="pending_cash_checkout_exists"?"มีออเดอร์เงินสดเดิมที่ยังไม่ทราบผล กรุณารอระบบตรวจรายการเดิมก่อนรับบิลใหม่":
      code==="business_date_changed"?"วันธุรกิจเปลี่ยนแล้ว กรุณาตรวจ Orders ก่อนทำรายการใหม่":
      code==="offline_cash_only"?"โหมด Offline รับได้เฉพาะเงินสด":
      code==="offline_split_not_supported"?"โหมด Offline ยังไม่รองรับแยกบิล/เพิ่มเข้าคิวเดิม กรุณารับเป็นบิลปกติ":
      code==="offline_loyalty_not_supported"?"โหมด Offline งดสะสม/ใช้แต้มชั่วคราว เพื่อป้องกันแต้มซ้ำข้ามอุปกรณ์":
      code==="offline_storage_write_failed"?"บันทึกบิล Offline ไม่สำเร็จ · ยังไม่ยืนยันยอดขาย กรุณาตรวจพื้นที่เก็บข้อมูลหรือเชื่อมต่ออินเทอร์เน็ต":
      code==="offline_storage_unavailable"?"เครื่องนี้ไม่สามารถเปิดพื้นที่เก็บ Offline ได้ กรุณาเชื่อมต่ออินเทอร์เน็ตก่อนขาย":
      code==="offline_catalog_unavailable"?"ไม่มีข้อมูลเมนู/สต็อกที่ cache ไว้ จึงยังขาย Offline ไม่ได้":
      code==="offline_price_changed"?"ราคาบน Cloud เปลี่ยนจากตอนขาย Offline · เก็บบิลไว้ให้ตรวจสอบ ไม่ลงยอดผิด":
      code==="offline_write_blocked"?"ออฟไลน์อยู่ · ระบบรองรับเฉพาะเงินสดแบบ Offline":
      code==="network_unavailable"?"การเชื่อมต่อขาดหาย กรุณาตรวจอินเทอร์เน็ต ระบบจะไม่สร้างบิลซ้ำ":
      code==="invalid_points_redeem"?"จำนวนแต้มที่ใช้ไม่ถูกต้อง":
      code==="customer_required_for_points"?"ต้องเลือกลูกค้าก่อนใช้แต้ม":
      code==="points_redemption_disabled"?"ยังไม่ได้เปิดการใช้แต้มเป็นส่วนลดใน Settings":
      code==="insufficient_points"?"แต้มลูกค้าไม่เพียงพอ":
      code==="points_discount_exceeds_total"?"แต้มที่ใช้มากกว่ายอดบิล":
      code==="promptpay_zero_total"?"ยอดสุทธิเป็น 0 บาท กรุณาใช้ Cash/แต้มเต็มแทน PromptPay":
      code;
  }

  async function checkout(){
    if(!cart.items.length||busy||!payableItems.length)return;
    const unresolvedPrompt=pendingRead();
    if(unresolvedPrompt?.parked&&method==="promptpay"){
      setResult("มี QR รอเงินเข้าอยู่แล้ว 1 รายการ · รอให้เงินเข้าหรือยกเลิก QR เดิมก่อนสร้างใหม่");
      return;
    }
    if(unresolvedPrompt&&!unresolvedPrompt.parked&&method!=="promptpay"){
      setResult("มี PromptPay รายการเดิมที่ยังรอผล · ช่องทางรับเงินอื่นถูกพักเพื่อป้องกันรับเงินซ้ำ");
      return;
    }
    if(online&&currentShiftStatus==="closed"){
      setResult("วันนี้ปิดยอดแล้ว · ยังรับเงินสดเพิ่มไม่ได้");
      return;
    }
    if(online&&method==="cash"&&currentShiftStatus==="not_open"){
      if(session.user.role==="admin"){
        setPayOpen(false);
        setNotice("ก่อนรับเงินสด ต้องเปิดกะเงินสดวันนี้ก่อน · ระบบพาไปเปิดในงานร้านโดยไม่ออกจากหน้า POS");
        setWorkspaceMounted(true);
        setWorkspaceOpen(true);
      }else{
        setResult("ยังไม่ได้เปิดกะเงินสด · ให้เจ้าของร้านเปิดกะก่อน หรือเลือก PromptPay/ช่องทางอื่น");
      }
      return;
    }
    if(checkoutInFlightRef.current)return;
    checkoutInFlightRef.current=true;
    setBusy(true);
    setResult("");
    try{
      let checkoutTotal=netPayable;
      const cartPayload=payableItems.map(i=>({id:i.id,variant:i.variant,qty:i.qty}));
      const checkoutMode=splitBill?"split_bill":"full";
      let paymentVerified:any=true,paymentReference:any=null,requestKey=crypto.randomUUID();
      if(method==="cash"&&Number(received)<checkoutTotal)throw Object.assign(new Error("cash_insufficient"),{status:409});

      // A local QR already shown keeps this bill on the offline path even if the
      // network returns, so the customer is never asked to scan a second QR.
      const offlineAtStart=(typeof navigator!=="undefined"&&!navigator.onLine)||(method==="promptpay"&&!!offlineQr&&offlineQr.key===JSON.stringify(cartPayload)+"|"+checkoutTotal);
      if(offlineAtStart){
        if(method!=="cash"&&!(method==="promptpay"&&offlineQrId))throw Object.assign(new Error("offline_cash_only"),{status:409});
        if(splitBill||splitGroup)throw Object.assign(new Error("offline_split_not_supported"),{status:409});
        if(customerId||redeemPoints>0)throw Object.assign(new Error("offline_loyalty_not_supported"),{status:409});
        if(!data)throw Object.assign(new Error("offline_catalog_unavailable"),{status:409});
        // Never confirm another offline sale while existing local bills are unreadable.
        await refreshOfflineStats();
        if(method==="promptpay"){
          // Never mix with a server-side QR that may still be collecting this money.
          if(pendingRead())throw Object.assign(new Error("pending_promptpay_exists"),{status:409});
          const key=JSON.stringify(cartPayload)+"|"+checkoutTotal;
          if(!offlineQr||offlineQr.key!==key){
            const url=await renderLocalPromptPayQr(String(offlineQrId),checkoutTotal);
            setOfflineQr({total:checkoutTotal,key,url});
            setResult("QR ออฟไลน์พร้อม · ให้ลูกค้าสแกน แล้วดูสลิปหรือแอปธนาคารก่อนกดบันทึก");
            return;
          }
          const offlineCreatedAt=Date.now();
          const ppBody={
            requestKey,date:localDate(),cart:cartPayload,payment:"promptpay",received:checkoutTotal,
            customerId:null,pointsRedeemed:0,total:checkoutTotal,checkoutMode:"full",
            offlineFulfilled:true,offlinePromptPay:true,offlineCreatedAt,offlineMenuRevision:data.revision
          };
          const queued=await queueOfflineCashSale(ppBody);
          setOfflineQr(null);
          finishOfflineSale(queued.localNo,{total:checkoutTotal,received:checkoutTotal,paidCart:cartPayload,payment:"promptpay"});
          return;
        }
        const offlineCreatedAt=Date.now();
        const body={
          requestKey,date:localDate(),cart:cartPayload,payment:"cash",received:Number(received),
          customerId:null,pointsRedeemed:0,total:checkoutTotal,checkoutMode:"full",
          offlineFulfilled:true,offlineCreatedAt,offlineMenuRevision:data.revision
        };
        const queued=await queueOfflineCashSale(body);
        finishOfflineSale(queued.localNo,{total:checkoutTotal,received:Number(received),paidCart:cartPayload});
        return;
      }

      if(method==="promptpay"){
        if(promptConfig?.ready!==true)throw Object.assign(new Error("promptpay_not_ready"),{status:503});
        if(promptReconcileRef.current){setResult("กำลังตรวจ QR เดิม · กดอีกครั้งใน 2 วินาที");return}
        let st:any=null;
        let activePending:PendingPrompt|null=null;
        const existing=pendingRead();
        if(existing){
          let resumed=existing,current:any=null;
          if(!resumed.sessionId||!resumed.paymentReference){
            const setup=await ensurePendingPrompt(resumed);
            resumed=setup.pending;
            current=setup.status;
          }
          if(!current)current=await api<any>("/api/payments/promptpay/status",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({chargeId:resumed.paymentReference})});
          if(current.paid){await finalizePending(resumed,current.chargeId||resumed.paymentReference);return}
          if(["failed","expired","reversed","cancelled"].includes(String(current.status||"").toLowerCase())){await cancelPendingReservation(resumed);pendingClear()}
          else if(!samePending(resumed,checkoutTotal,cartPayload,customerId,redeemPoints,splitGroup?.orderId||null))throw Object.assign(new Error("pending_promptpay_exists"),{status:409});
          else{st=current;paymentReference=resumed.paymentReference;requestKey=resumed.requestKey;activePending=resumed;checkoutTotal=resumed.total}
        }
        if(!st){
          const reservationKey=crypto.randomUUID();
          const payRequestKey=crypto.randomUUID();
          activePending={requestKey:reservationKey,payRequestKey,date:localDate(),cart:cartPayload,paymentReference:"",total:checkoutTotal,customerId:customerId||null,pointsRedeemed:redeemPoints,createdAt:Date.now(),checkoutMode,targetOrderId:splitGroup?.orderId||null};
          pendingWrite(activePending);
          if(offlineQrId&&promptConfig?.provider==="direct"&&checkoutMode==="full"){
            const previewTotal=checkoutTotal;
            renderLocalPromptPayQr(offlineQrId,previewTotal).then(url=>setQrPreview(cur=>cur===null?{total:previewTotal,url}:cur)).catch(()=>{});
          }
          const setup=await ensurePendingPrompt(activePending);
          activePending=setup.pending;
          st=setup.status||await api<any>("/api/payments/promptpay/status",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({chargeId:activePending.paymentReference})});
          checkoutTotal=activePending.total;
          paymentReference=activePending.paymentReference;
        }
        setPrompt(st);
        setQrPreview(null);
        if(["failed","expired","reversed","cancelled"].includes(String(st.status||"").toLowerCase())){
          if(activePending)await cancelPendingReservation(activePending);
          pendingClear();
          throw Object.assign(new Error("promptpay_failed"),{status:409});
        }
        if(st.paid){
          const p=activePending||pendingRead();
          if(p?.sessionId){await finalizePending(p,st.chargeId||paymentReference);return}
          paymentVerified=st.chargeId||paymentReference;
        }else{
          setPayOpen(true);
          setResult("QR พร้อมชำระ · ระบบตรวจ QR เดิมอัตโนมัติทุก 3 วินาที โดยไม่สร้างรายการใหม่");
          return;
        }
      }

      if(["bank","card"].includes(method)){paymentReference=manualPaymentReference.trim()||null;paymentVerified="manual"}
      let body:any={
        requestKey,date:localDate(),cart:cartPayload,payment:method==="delivery"?"other":method,
        received:method==="cash"?Number(received):checkoutTotal,
        paymentReference,paymentVerified,customerId:customerId||null,pointsRedeemed:redeemPoints,total:checkoutTotal,checkoutMode,
        salesChannel:method==="delivery"?deliveryPlatform:"store",
        targetOrderId:splitGroup?.orderId||undefined
      };
      if(method==="cash"){
        const existing=cashPendingRead();
        if(existing){
          if(!sameCashPending(existing,checkoutTotal,cartPayload,customerId,Number(received),redeemPoints,splitGroup?.orderId||null))throw Object.assign(new Error("pending_cash_checkout_exists"),{status:409});
          body=existing.body;
          requestKey=body.requestKey;
        }else cashPendingWrite({body,createdAt:Date.now()});
      }

      const r=await api<any>("/api/pos/checkout",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)});
      if(method==="promptpay")pendingClear();
      if(method==="cash")cashPendingClear();
      finishSale(r,{payment:method,total:checkoutTotal,received:method==="cash"?Number(received):checkoutTotal,splitBill:checkoutMode==="split_bill",paidCart:cartPayload});
    }catch(e:any){
      if(qrPreviewRef.current){
        setQrPreview(null);
        setNotice("เปิดรับ QR ไม่สำเร็จ · ถ้าลูกค้าโอนแล้ว ให้ดูยอดในแอปธนาคาร แล้วบันทึกเป็น ช่องทางอื่น → โอน");
      }
      if(method==="cash"&&e?.status&&e.status<500)cashPendingClear();
      const message=errorText(e.message);
      if(["menu_unavailable","variant_unavailable"].includes(e.message)||e.message==="stock_shortage"||e.message.startsWith("stock_shortage:")){
        setPayOpen(false);
        setNotice(message);
        load().catch(()=>{});
      }else if(e.message==="cash_shift_not_open"&&method==="cash"&&session.user.role==="admin"){
        setPayOpen(false);
        setNotice("ยังไม่ได้เปิดกะเงินสด · ระบบตรวจจาก Server แล้วและพาไปเปิดกะเดิมโดยไม่สร้างบิลซ้ำ");
        setWorkspaceMounted(true);
        setWorkspaceOpen(true);
        load().catch(()=>{});
      }else{
        setResult(method==="cash"&&e.message==="network_unavailable"?"การเชื่อมต่อขาดหาย · เก็บ request เดิมไว้และจะตรวจซ้ำอัตโนมัติ":message);
      }
    }finally{
      checkoutInFlightRef.current=false;
      setBusy(false);
    }
  }

  function openPayment(){
    if(cartCheckInFlightRef.current){setNotice("กำลังตรวจสต็อกล่าสุด กรุณารอสักครู่");return}
    if(!cart.items.length)return;
    const byId=new Map((data?.menu||[]).filter(sellable).map(x=>[x.id,x]));
    const blocked=cart.items.filter(item=>{
      const variant=byId.get(item.id)?.variants?.find(v=>v.label===item.variant);
      return !variant||!variant.available;
    });
    if(blocked.length){
      const blockedKeys=new Set(blocked.map(item=>item.key));
      cart.replaceItems(cart.items.filter(item=>!blockedKeys.has(item.key)));
      setNotice("นำ "+blocked.map(item=>item.name).join(", ")+" ออกจากตะกร้า เพราะเมนูหมดชั่วคราวหรือสูตรไม่พร้อม · กรุณาตรวจยอดแล้วกดชำระเงินอีกครั้ง");
      load().catch(()=>{});
      return;
    }
    const current=cartStockState;
    if(!current.available){setNotice(availabilityMessage(current));load().catch(()=>{});return}
    setResult("");
    setSplitBill(false);
    setSplitSelection({});
    setPaymentReviewOpen(false);
    setOtherPaymentOpen(["bank","card","delivery"].includes(method));
    setOrderOptionsOpen(!!splitGroup||!!customerId);
    setPayOpen(true);
  }

  const cartQty=cart.items.reduce((s,i)=>s+i.qty,0);
  const orderStep=payOpen?3:cart.items.length?2:1;
  const cashierGuide=cashierNextAction({cartQty,payOpen,method,payable:netPayable,received,promptReady:!!prompt?.qrUrl});
  const operatorGuide=data?.operatorGuide;
  const currentShiftStatus=String(operatorGuide?.shiftStatus||"");
  const cashShiftUnavailable=online&&currentShiftStatus==="not_open";
  const workspaceNextAction=chooseWorkspaceNextAction({
    canExpense:session.user.role==="admin"||session.user.permissions?.report===true,
    pendingExpense:workspaceSignals.pendingExpense,
    expenseRecoveryBlocked:workspaceSignals.expenseRecoveryBlocked,
    canQueue:session.user.role==="admin"||session.user.permissions?.queue===true,
    queueCount:online?Number(operatorGuide?.queueCount)||0:0,
    firstQueue:online?String(operatorGuide?.firstQueue||""):"",
    canStock:session.user.role==="admin"||session.user.permissions?.stock===true,
    outCount:online?Number(operatorGuide?.unavailableMenuCount)||0:0,
    lowCount:online?Number(operatorGuide?.lowStockMenuCount)||0:0,
    canStatus:session.user.role==="admin",
    blockedCount:0,
    canOrder:session.user.role==="admin"||session.user.permissions?.order===true,
    latestOrderLabel:"",
    canStartDay:session.user.role==="admin",
    businessDateKnown:online&&!!operatorGuide?.businessDate,
    shiftStatus:online&&operatorGuide?.shiftStatus!=="not_open"?String(operatorGuide?.shiftStatus||""):"",
    pendingOpenShift:workspaceSignals.pendingOpenShift,
    startDayRecoveryBlocked:workspaceSignals.startDayRecoveryBlocked
  });
  const workspaceActionVisible=!payOpen&&cartQty===0&&workspaceNextAction.tone!=="ready";
  const workspaceActionLabel=workspaceNextAction.action==="start_day"?"เริ่มตรงนี้":workspaceNextAction.tab==="queue"?"ทำคิวตรงนี้":workspaceNextAction.tab==="stock"?"ตรวจสต็อก":workspaceNextAction.tab==="expense"?"ตรวจรายการ":workspaceNextAction.tab==="status"?"ดูสถานะ":"เปิดงานร้าน";
  const openWorkspace=(requestedTab:null|"queue"|"orders"|"stock"|"expense"|"status"=null)=>{
    setWorkspaceRequestedTab(requestedTab);
    setWorkspaceMounted(true);
    setWorkspaceOpen(true);
  };
  const runWorkspaceNextAction=()=>openWorkspace(null);
  useEffect(()=>{
    const openFromShell=(event:Event)=>{
      const tab=(event as CustomEvent<{tab?:"queue"|"orders"|"stock"|"expense"|"status"}>).detail?.tab||null;
      openWorkspace(tab);
    };
    window.addEventListener("field:open-pos-workspace",openFromShell);
    return()=>window.removeEventListener("field:open-pos-workspace",openFromShell);
  },[]);
  const hasPendingPrompt=!!pendingRead()&&!pendingRead()?.parked;
  const quickCashAmounts=Array.from(new Set([Math.ceil(netPayable/100)*100,100,500,1000])).filter(v=>v>=netPayable&&v>0).sort((a,b)=>a-b).slice(0,3);
  const otherPaymentActive=["bank","card","delivery"].includes(method);
  const showOtherPayments=otherPaymentOpen||otherPaymentActive;
  const orderOptionsVisible=orderOptionsOpen||splitBill||!!customerId||!!splitGroup;

  const splitPaymentPending=!!splitGroup&&cart.items.length>0;
  const splitRemainingQty=splitPaymentPending?cart.items.reduce((sum,item)=>sum+item.qty,0):0;

  return <section className="flex h-full min-h-0">
    <div className="field-pos-catalog-pane flex min-w-0 flex-1 flex-col p-3 sm:p-4 md:p-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div><h1 className="m-0 text-xl font-semibold md:text-2xl">รับออเดอร์</h1></div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          {!offlineStorageError&&(!online||offlineStats.total>0)&&<div className={"hidden rounded-full border px-2.5 py-1.5 text-[10px] font-bold sm:block sm:text-xs "+(!online?"border-amber-300 bg-amber-50 text-amber-800":offlineStats.needsReview>0?"border-red-300 bg-red-50 text-red-700":"border-emerald-300 bg-emerald-50 text-emerald-700")}>{!online?"OFFLINE · เงินสดเท่านั้น":offlineStats.needsReview>0?"บิลในเครื่องต้องตรวจ "+offlineStats.needsReview:"บิลในเครื่องรอส่ง "+offlineStats.pending}</div>}
          <button disabled={busy||payOpen} onClick={()=>openWorkspace(null)} className="hidden min-h-11 items-center gap-1.5 rounded-full border border-[#d4af37]/50 bg-[#fff8dc] px-2.5 text-[11px] font-bold text-[#6f5510] disabled:opacity-40 md:flex md:px-3 md:text-xs"><ClipboardList size={14}/>งานร้าน</button><button onClick={()=>setHeldOpen(true)} className="relative flex min-h-11 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-2.5 text-[11px] font-semibold text-slate-700 sm:px-3 sm:text-xs"><Clock3 size={14}/>บิลที่พักไว้{heldBills.held.length>0&&<span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#d4af37] px-1 text-[10px] font-black text-black">{heldBills.held.length}</span>}</button>
          <div className="hidden rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] text-slate-600 sm:block sm:px-4 sm:py-2 sm:text-xs">{session.user.username}</div>
        </div>
      </div>

      {!offlineStorageError&&!online&&<div role="status" data-offline-banner className="mb-3 rounded-2xl border border-[#E8B04B] bg-[#FFF4E5] px-4 py-2.5 text-[#7A3E0B]">
        <b className="block text-sm">เน็ตหลุด · ขายเงินสด{offlineQrId?" และ PromptPay (QR ในเครื่อง)":""}ได้ตามปกติ</b>
        <span className="block text-[11px]">แยกจ่าย / แต้มปิดชั่วคราว{offlineStats.total>0?" · บิลเก็บในเครื่อง "+offlineStats.total+" บิล":""} · ส่งเข้าระบบเองเมื่อเน็ตกลับ</span>
      </div>}
      {!offlineStorageError&&online&&offlineStats.pending>0&&<div role="status" data-offline-banner className="mb-3 rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-900">เน็ตกลับแล้ว · กำลังส่งบิลค้าง {offlineStats.pending} บิล</div>}
      {parkedRecord&&<button type="button" data-parked-prompt onClick={()=>setParkedOpen(true)} className="mb-3 flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl border-2 border-[#1F4D3A] bg-[#E8F2EC] px-4 text-left text-[#1F4D3A]">
        <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#2F7D57]"/><b className="text-sm">รอเงินเข้า PromptPay ฿{formatBaht(parkedRecord.total)}</b></span>
        <span className="flex items-center gap-2 text-xs font-semibold"><ParkedElapsed since={parkedRecord.parkedAt||parkedRecord.createdAt}/> · แตะดู QR</span>
      </button>}

      {!workspaceActionVisible&&<div className="mb-2 flex items-center gap-3 text-xs" aria-label="ขั้นตอนรับออเดอร์">
        {[["1","เลือกเมนู"],["2","ตรวจออเดอร์"],["3","ชำระเงิน"]].map(([n,label])=>{const step=Number(n),active=orderStep===step,done=orderStep>step;return <div key={n} aria-current={active?"step":undefined} className={"flex min-h-6 items-center gap-1 font-semibold "+(active?"text-[#765b08]":done?"text-emerald-800":"text-slate-600")}><span className="grid h-5 w-5 place-items-center rounded-full bg-white text-[10px]">{done?"✓":n}</span><span>{label}</span></div>})}
      </div>}

      {!payOpen&&(workspaceActionVisible?<div role="status" aria-live="polite" className={"mb-3 flex items-center justify-between gap-3 rounded-2xl border px-3 py-2.5 "+(workspaceNextAction.tone==="critical"?"border-red-300 bg-red-50 text-red-900":workspaceNextAction.tone==="warn"?"border-amber-300 bg-amber-50 text-amber-900":"border-[#d4af37]/50 bg-[#fff8dc] text-slate-900")}>
        <div className="min-w-0"><span className="text-[9px] font-black uppercase tracking-[.16em] text-slate-500">ทำต่อก่อน</span><b className="mt-0.5 block text-sm">{workspaceNextAction.label}</b><span className="mt-0.5 block text-[11px] leading-4">{workspaceNextAction.detail}</span></div>
        <button type="button" disabled={busy||payOpen} onClick={runWorkspaceNextAction} className="min-h-11 shrink-0 rounded-xl border border-[#b98b00] bg-[#d4af37] px-3 text-xs font-black text-black shadow-sm disabled:opacity-40">{workspaceActionLabel}</button>
      </div>:!allUnavailable&&hasConfiguredMenu?<div role="status" aria-live="polite" className="mb-3 text-sm font-semibold text-slate-700">
        {cart.items.length?"แตะเมนูเพิ่ม หรือกดชำระเงินเมื่อสั่งครบ":cashierGuide.title}
      </div>:null)}

      {offlineStorageError&&<div role="alert" className="mb-3 shrink-0 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-900"><b>ยังอ่านบิลที่เก็บในเครื่องไม่ได้</b><p className="mt-1 text-xs">ยังยืนยันไม่ได้ว่ามีบิลรอส่งกี่รายการ · หยุดรับเงินสดตอนเน็ตหลุด และอย่าล้างข้อมูลเบราว์เซอร์ กรุณาตรวจพื้นที่เก็บข้อมูลหรือให้เจ้าของร้านช่วย</p><button disabled={busy} onClick={()=>refreshOfflineStats().catch(()=>{})} className="mt-2 min-h-11 rounded-xl border border-red-300 bg-white px-3 text-xs font-bold disabled:opacity-40">อ่านรายการ Offline อีกครั้ง</button></div>}
      {notice&&<div className="mb-3 flex items-start justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"><span>{notice}</span><button onClick={()=>setNotice("")} className="shrink-0"><X size={16}/></button></div>}
      {allUnavailable&&<div className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"><b>เมนูที่แสดงยังขายไม่ได้</b><p className="mt-1 text-xs">{unavailableNames.length?"ต้องตรวจยอดวัตถุดิบจริงก่อนรับออเดอร์ · ขาด: "+unavailableNames.join(", "):"ให้เจ้าของร้านตรวจสูตรและสถานะเมนูก่อนขาย"}</p>{unavailableNames.length>0&&(session.user.role==="admin"||session.user.permissions?.stock===true?<button onClick={()=>openWorkspace("stock")} className="mt-3 min-h-11 rounded-full bg-red-700 px-4 py-2 text-xs font-bold text-white">ตรวจสต็อกตรงนี้</button>:<p className="mt-2 text-xs font-semibold">ให้ผู้ดูแลสต็อกหรือเจ้าของร้านตรวจของจริงก่อนขาย</p>)}</div>}

      <div className="glass mb-2.5 flex items-center gap-2.5 rounded-2xl px-3 py-2.5 sm:mb-3 sm:gap-3 sm:px-4 sm:py-3"><Search size={17} className="text-slate-500"/><input aria-label="ค้นหาเมนู" value={q} onChange={e=>setQ(e.target.value)} placeholder="ค้นหาเมนู เช่น มัทฉะ / กาแฟ" className="min-w-0 w-full bg-transparent outline-none"/>{q&&<button type="button" aria-label="ล้างคำค้นเมนู" onClick={()=>setQ("")} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-700 hover:bg-slate-100"><X size={18}/></button>}</div>

      <div className="soft-scroll mb-3 flex gap-1.5 overflow-x-auto sm:mb-4 sm:gap-2">{cats.map(x=><button key={x} onClick={()=>setCat(x)} className={"min-h-11 shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold sm:px-4 sm:py-2 sm:text-xs "+(cat===x?"border-[#c59b19] bg-[#d4af37] text-black shadow-sm":"border-slate-300 bg-white text-slate-700")}>{x}</button>)}</div>

      <div className="field-pos-menu-list soft-scroll min-h-0 flex-1 overflow-auto pb-28 lg:pb-0">
        {data&&menu.length===0&&<div role="status" className="rounded-2xl border border-slate-200 bg-white p-5 text-center text-slate-700">
          <h2 className="text-sm font-bold">{hasConfiguredMenu?"ไม่พบเมนูที่ตรงกับคำค้นหรือหมวดนี้":"ยังไม่มีเมนูที่เปิดขาย"}</h2>
          <p className="mt-2 text-xs">{hasConfiguredMenu?"ลองดูเมนูทั้งหมด แล้วเลือกเมนูอีกครั้ง ออเดอร์ที่เลือกไว้ยังอยู่":"ให้เจ้าของร้านตรวจเมนู ราคา และสูตรก่อนเริ่มรับออเดอร์"}</p>
          {hasConfiguredMenu?<button type="button" onClick={()=>{setQ("");setCat("ทั้งหมด")}} className="mt-4 min-h-11 rounded-xl border border-[#b98b00] bg-[#fff8dc] px-4 text-sm font-bold text-[#6f5510]">ดูทุกเมนู</button>:session.user.role==="admin"?<Link prefetch={false} href="/products" className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-[#b98b00] bg-[#fff8dc] px-4 text-sm font-bold text-[#6f5510]">ไปจัดเมนู</Link>:null}
        </div>}
        <div className="grid grid-cols-2 items-stretch gap-2 sm:grid-cols-3 sm:gap-2.5 lg:grid-cols-4">{menu.map(x=>{const inCart=cartQtyByMenu.get(x.id)||0;const missing=Array.from(new Set(x.variants.flatMap(v=>v.missingIngredients||[]).map(i=>i.name))).slice(0,2).join(", ");return <button key={x.id} data-menu-card disabled={!x.available} onClick={()=>chooseMenu(x)} aria-label={x.name+" ฿"+formatBaht(x.price)+(inCart?" · ในตะกร้า "+inCart+" แก้ว":"")+(!x.available?" · หมดชั่วคราว":x.lowStock?" · เหลือ "+x.maxServings+" แก้ว":"")} className={"pos-menu-card relative flex min-h-[84px] flex-col justify-between rounded-[14px] bg-white px-3.5 py-3 text-left text-[#1B2A22] disabled:bg-[#F1EEE7] "+(inCart?"border-2 border-[#1F4D3A]":"border border-[#E4DED2]")}>
          {x.image&&<img src={x.image} alt="" loading="lazy" decoding="async" className="absolute right-2 top-2 h-9 w-9 rounded-lg object-cover opacity-90"/>}
          <b className={"block line-clamp-2 text-[15px] font-bold leading-snug sm:text-base "+(x.image?"pr-10":"")}>{x.name}</b>
          <div className="mt-2 flex w-full items-end justify-between gap-2">
            <span className="text-[15px] font-bold text-[#1F4D3A]">฿{formatBaht(x.price)}</span>
            {!x.available?<span className="shrink-0 whitespace-nowrap rounded-full bg-[#FBE9E3] px-2 py-0.5 text-[11px] font-bold text-[#9A3412]">หมดชั่วคราว</span>:inCart?<span className="rounded-full bg-[#1F4D3A] px-2 py-0.5 text-xs font-black text-white">×{inCart}</span>:x.lowStock?<span className="rounded-full bg-[#FFF4E5] px-2 py-0.5 text-[11px] font-bold text-[#9A3412]">เหลือ {x.maxServings}</span>:null}
          </div>
          {!x.available&&<small className="mt-1 block text-[11px] text-[#9A3412]">ขาด {missing||"สูตรยังไม่พร้อม"}</small>}
        </button>})}</div>
      </div>
    </div>

    <div className="field-pos-mobile-cartbar fixed left-2 right-2 z-30 flex items-center justify-between gap-2 rounded-[18px] border border-slate-300 bg-white/95 p-1.5 pl-3 shadow-lg backdrop-blur sm:left-4 sm:right-4 sm:rounded-[22px] sm:p-2 sm:pl-5 lg:hidden">
      {(()=>{
        const line=lastQuick&&!payOpen&&!lastSale?cart.items.find(i=>i.key===lastQuick.key):null;
        const product=line?data?.menu.find(m=>m.id===line.id):null;
        if(!line||!product||product.variants.length<2)return null;
        return <div data-quick-sweetness className="field-sheet-in absolute bottom-full left-0 right-0 mb-2 rounded-[18px] border border-[#1F4D3A]/25 bg-white p-2 shadow-lg">
          <p className="px-1 text-[11px] font-bold text-slate-600">เพิ่ม {line.name} แล้ว · เปลี่ยนความหวานแก้วนี้</p>
          <div role="group" aria-label={"ความหวานแก้วล่าสุด "+line.name} className="mt-1.5 flex gap-1.5">
            {product.variants.map(v=>{const active=v.label===line.variant;return <button key={v.label} type="button" aria-pressed={active} disabled={!active&&!v.available} onClick={()=>{if(!active)changeVariant(line.key,v.label);setLastQuick(null)}} className={"min-h-11 flex-1 rounded-xl border px-2 text-xs font-bold "+(active?"border-[#1F4D3A] bg-[#1F4D3A] text-white":"border-slate-300 bg-white text-slate-700")}>{shortVariantLabel(v.label)}</button>})}
          </div>
        </div>;
      })()}
      <div className="min-w-0 flex-1"><small className="block text-[10px] tracking-widest text-slate-500">{cart.items.reduce((s,i)=>s+i.qty,0)} แก้ว</small><b key={total} className="field-bump block text-lg text-[#765b08]">฿{formatBaht(total)}</b></div>
      <button disabled={!cart.items.length} onClick={holdCurrentBill} className="field-cart-action min-h-11 shrink-0 rounded-2xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 disabled:opacity-30"><Clock3 size={14} className="mx-auto mb-0.5"/>พักบิล</button>
      <button aria-label="ชำระเงิน" disabled={!cart.items.length} onClick={openPayment} className="field-cart-action min-h-11 shrink-0 rounded-2xl bg-[#d4af37] px-4 py-2.5 text-sm font-bold text-black disabled:opacity-30 sm:px-5 sm:py-3">ชำระเงิน ฿{formatBaht(total)}</button>
    </div>

    <aside className="glass m-3 ml-0 hidden w-[360px] shrink-0 flex-col rounded-[24px] p-5 lg:flex">
      <div className="mb-4 flex items-center justify-between"><div><p className="m-0 text-[10px] tracking-[.25em] text-slate-500">ขั้นตอน 2 · ตรวจออเดอร์</p><h2 className="m-0 mt-1 text-lg">รายการที่สั่ง</h2></div><span key={cart.items.reduce((s,i)=>s+i.qty,0)} className="field-bump rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs">{cart.items.reduce((s,i)=>s+i.qty,0)} แก้ว</span></div>
      <div className="soft-scroll min-h-0 flex-1 overflow-auto">{cart.items.length===0?<div className="grid h-full place-items-center text-sm text-slate-400">1. แตะเมนูเพื่อเริ่มออเดอร์</div>:cart.items.map(i=><div key={i.key} className="mb-3 rounded-[18px] border border-slate-200 bg-slate-100/70 p-4"><div className="flex gap-3"><div className="min-w-0 flex-1"><b className="text-sm">{i.name}</b>{sweetnessChips(i)}</div><button aria-label={"ลบ "+i.name} onClick={()=>cart.removeItem(i.key)} className="grid h-11 w-11 place-items-center rounded-xl text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 size={16}/></button></div><div className="mt-3 flex items-center justify-between"><div className="flex items-center gap-2"><button aria-label={"ลดจำนวน "+i.name} onClick={()=>updateCartQuantity(i.key,i.qty-1)} className="grid h-11 w-11 place-items-center rounded-xl border border-slate-300 bg-white"><Minus size={13}/></button><span className="w-5 text-center">{i.qty}</span><button aria-label={"เพิ่มจำนวน "+i.name} onClick={()=>updateCartQuantity(i.key,i.qty+1)} className="grid h-11 w-11 place-items-center rounded-xl border border-slate-300 bg-white"><Plus size={13}/></button></div><b className="text-[#765b08]">฿{formatBaht((i.price*i.qty))}</b></div></div>)}</div>
      <div className="border-t border-slate-300 pt-4"><div className="mb-2 flex justify-between text-sm text-slate-600"><span>ยอดสินค้า</span><span>฿{formatBaht(cart.getSubtotal())}</span></div><div className="mb-4 flex justify-between text-xl font-semibold"><span>รวมสุทธิ</span><span className="text-[#765b08]">฿{formatBaht(total)}</span></div><div className="grid grid-cols-[auto_1fr] gap-2"><button disabled={!cart.items.length} onClick={holdCurrentBill} className="field-cart-action flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 disabled:opacity-30"><Clock3 size={17}/>พักบิล</button><button aria-label="ชำระเงิน" disabled={!cart.items.length} onClick={openPayment} className="field-cart-action flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#d4af37] px-4 font-bold text-black disabled:opacity-30"><WalletCards size={18}/>ชำระเงิน</button></div></div>
    </aside>

    {parkedOpen&&parkedRecord&&<div className="field-modal-overlay fixed inset-0 z-[88] grid place-items-center bg-black/55 p-3"><ModalFocus labelId="field-parked-title" onEscape={()=>setParkedOpen(false)} className="field-modal-panel w-full max-w-sm rounded-[24px] border border-slate-300 bg-white p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-bold text-[#1F4D3A]">รอเงินเข้าเบื้องหลัง</p><h3 id="field-parked-title" className="mt-1 text-2xl font-bold">PromptPay ฿{formatBaht(parkedRecord.total)}</h3><p className="mt-1 text-xs text-slate-600">รอมาแล้ว <ParkedElapsed since={parkedRecord.parkedAt||parkedRecord.createdAt}/> · ระบบปิดบิลและส่งเข้าคิวเองเมื่อเงินเข้า</p></div><button type="button" aria-label="ปิด" onClick={()=>setParkedOpen(false)} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl hover:bg-slate-100"><X/></button></div>
      {parkedStatus?.qrUrl&&<img src={parkedStatus.qrUrl} alt="PromptPay QR" className="mx-auto mt-3 max-h-56 w-auto"/>}
      {parkedStatus?.provider==="direct"&&<div className="mt-3 grid gap-2">
        {!directConfirmArmed?<button type="button" onClick={()=>setDirectConfirmArmed(true)} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700">แจ้งเตือนไม่มา · เห็นเงินเข้าในแอปธนาคารแล้ว</button>:
        <div role="alertdialog" aria-label="ยืนยันเห็นเงินเข้า" className="rounded-xl border border-amber-300 bg-amber-50 p-3"><b className="text-sm text-amber-950">เห็นยอด ฿{formatBaht(parkedRecord.total)} เข้าบัญชีร้านแล้วจริงใช่ไหม?</b><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={()=>setDirectConfirmArmed(false)} className="min-h-11 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-700">ยังไม่เห็น</button><button type="button" disabled={directConfirmBusy} onClick={()=>confirmDirectPayment(parkedRecord.paymentReference)} className="min-h-11 rounded-xl bg-[#1F4D3A] text-xs font-black text-white disabled:opacity-40">เห็นแล้ว · ปิดบิล</button></div></div>}
        <button type="button" disabled={parkedBusy} onClick={cancelParkedPrompt} className="min-h-11 rounded-xl border border-red-200 bg-white px-3 text-xs font-bold text-red-700 disabled:opacity-40">{parkedBusy?"กำลังยกเลิก...":"ยกเลิก QR · ลูกค้าจ่ายวิธีอื่น"}</button>
      </div>}
    </ModalFocus></div>}
    {heldOpen&&<div className="field-modal-overlay fixed inset-0 z-[85] grid place-items-center bg-black/55" onMouseDown={()=>setHeldOpen(false)}><ModalFocus labelId="field-held-title" onEscape={()=>setHeldOpen(false)} className="field-modal-panel card soft-scroll w-full max-w-lg overflow-auto border border-slate-300 bg-white p-4 shadow-2xl sm:p-5" initialFocusSelector='[aria-label="ปิดบิลที่พักไว้"]'><div onMouseDown={e=>e.stopPropagation()}><div className="flex items-start justify-between gap-3"><div><p className="gold text-[10px] font-bold tracking-[.25em]">พักรายการไว้ก่อน</p><h3 id="field-held-title" className="mt-1 text-xl font-semibold">บิลที่พักไว้ · {heldBills.held.length}</h3><p className="mt-1 text-xs text-slate-500">ยังไม่สร้างยอดขาย ไม่ตัด Stock และไม่เข้าคิวจนกว่าจะชำระจริง</p></div><button aria-label="ปิดบิลที่พักไว้" onClick={()=>{setHeldDeleteConfirmId(null);setHeldOpen(false)}} className="grid h-11 w-11 place-items-center rounded-xl hover:bg-slate-100"><X size={18}/></button></div>{heldBills.held.length===0?<div className="mt-5 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">ยังไม่มีบิลพัก</div>:<div className="mt-4 space-y-2">{heldBills.held.map(h=>{const qty=h.items.reduce((s,i)=>s+i.qty,0),amount=h.items.reduce((s,i)=>s+i.price*i.qty,0);return <div key={h.id} className="rounded-[20px] border border-slate-200 bg-slate-50 p-3 sm:p-4"><div className="flex items-start justify-between gap-3"><div><b className="text-sm">พักเวลา {localTime(h.createdAt)}</b><p className="mt-1 text-xs text-slate-500">{qty} แก้ว · {h.items.length} เมนู · ฿{formatBaht(amount)}</p><p className="mt-1 line-clamp-2 text-[11px] text-slate-500">{h.items.map(i=>i.name+" ×"+i.qty).join(" · ")}</p></div><button onClick={()=>setHeldDeleteConfirmId(h.id)} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={"ขอลบบิลพักเวลา "+localTime(h.createdAt)}><Trash2 size={15}/></button></div>{heldDeleteConfirmId===h.id?<div role="alertdialog" aria-label="ยืนยันลบบิลพัก" className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3"><b className="text-sm text-red-900">ลบบิลพักนี้ใช่ไหม?</b><p className="mt-1 text-xs leading-5 text-red-800">บิลพัก ฿{formatBaht(amount)} · {qty} แก้ว · ยังไม่ขายและยังไม่ตัด Stock การลบจะเอารายการนี้ออกจากเครื่องเท่านั้น</p><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={()=>setHeldDeleteConfirmId(null)} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700">เก็บบิลไว้</button><button type="button" onClick={()=>{heldBills.removeHeld(h.id);setHeldDeleteConfirmId(null)}} className="min-h-11 rounded-xl bg-red-700 px-3 text-xs font-bold text-white">ลบบิลพัก</button></div></div>:<button onClick={()=>resumeHeldBill(h.id)} className="mt-3 min-h-11 w-full rounded-2xl bg-[#d4af37] px-4 text-sm font-bold text-black">เรียกบิลนี้กลับ</button>}</div>})}</div>}</div></ModalFocus></div>}

    {selected&&<div className="field-modal-overlay fixed inset-0 z-50 grid place-items-center bg-black/55" onMouseDown={()=>setSelected(null)}><ModalFocus labelId="field-modifier-title" onEscape={()=>setSelected(null)} className="field-modal-panel card w-full max-w-md overflow-auto border border-slate-300 bg-white p-4 shadow-2xl sm:p-6" initialFocusSelector='[aria-label="ปิดตัวเลือกเมนู"]'><div onMouseDown={e=>e.stopPropagation()}><div className="flex items-start justify-between"><div><p className="gold text-[10px] tracking-[.25em]">{selected.category||"DRINK"}</p><h3 id="field-modifier-title" className="mt-1 text-lg sm:text-xl">{selected.name}</h3></div><button aria-label="ปิดตัวเลือกเมนู" onClick={()=>setSelected(null)} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl hover:bg-slate-100"><X/></button></div><p className="mt-5 text-xs font-semibold text-slate-500">เลือกระดับหวาน / สูตร</p><div className="mt-3 grid gap-2">{selected.variants.map(v=>{const remaining=additionalServingsForVariant({variant:v,demand:cartStockState.demand,stock:data?.availabilityStock||{}});const canAdd=!!v.available&&remaining>0;return <button key={v.label} disabled={!canAdd} onClick={()=>addVariant(selected,v)} className="field-unavailable-variant min-h-11 rounded-2xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-left hover:border-[#c59b19] sm:px-4 sm:py-3 disabled:bg-slate-100 disabled:text-slate-400"><span>{orderOptionLabel(v.label)}{!v.available&&<small className="ml-2 text-red-600">หมดชั่วคราว</small>}{v.available&&remaining>0&&<small className="ml-2 text-amber-700">เพิ่มได้อีกประมาณ {remaining} แก้ว</small>}{v.available&&remaining<1&&<small className="ml-2 text-red-600">เพิ่มไม่ได้ · ตะกร้าใช้สต๊อกที่เหลือแล้ว</small>}</span><span className="float-right font-semibold text-[#765b08]">฿{formatBaht(selected.price)}</span>{!v.available&&v.missingIngredients?.length>0&&<small className="mt-1 block text-xs text-red-500">ขาด: {v.missingIngredients.map(i=>i.name).join(", ")}</small>}{v.available&&remaining<1&&<small className="mt-1 block text-xs text-slate-500">ลดจำนวนรายการในตะกร้า หรืออัปเดต Stock ก่อนเพิ่มเมนูนี้</small>}</button>})}</div></div></ModalFocus></div>}

    {payOpen&&<div className="field-modal-overlay fixed inset-0 z-[90] flex items-end justify-center bg-black/55 sm:grid sm:place-items-center"><ModalFocus labelId="field-payment-title" onEscape={busy||hasPendingPrompt?undefined:()=>setPayOpen(false)} className="field-modal-panel soft-scroll card max-h-[calc(100dvh-1rem)] w-full max-w-md overflow-auto border border-slate-300 bg-white p-4 shadow-2xl sm:max-h-[94vh] sm:p-6" initialFocusSelector='[aria-label="กลับไปเลือกเมนู"]'><fieldset disabled={busy} aria-busy={busy} className="m-0 min-w-0 border-0 p-0"><div className="flex justify-between gap-3"><div><p className="gold text-[10px] tracking-[.25em]">ขั้นตอน 3 · รับเงิน</p><h3 id="field-payment-title" className="mt-1 text-2xl font-semibold">ชำระเงิน ฿{formatBaht(netPayable)}</h3><p className="mt-1 text-xs text-slate-500">{splitBill?"บิลนี้ "+payableQty+" แก้ว · เหลือ "+remainingAfterBill+" แก้ว":payableQty+" แก้ว · "+cart.items.length+" เมนู"}</p></div><button aria-label="กลับไปเลือกเมนู" disabled={busy||hasPendingPrompt} onClick={()=>setPayOpen(false)} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"><X/></button></div>

      {busy&&<div role="status" aria-live="assertive" className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-900">กำลังยืนยันรายการนี้ · ห้ามรับเงินซ้ำหรือเปลี่ยนยอดจนกว่าระบบจะแจ้งผล</div>}

      {!busy&&<div role="status" aria-live="polite" className={"mt-3 rounded-2xl border px-3 py-2.5 "+(cashierGuide.tone==="warn"?"border-amber-300 bg-amber-50 text-amber-900":cashierGuide.tone==="ready"?"border-emerald-200 bg-emerald-50 text-emerald-900":"border-[#d4af37]/40 bg-[#fffaf0] text-slate-800")}>
        <b className="block text-sm">{cashierGuide.title}</b>
        <span className="mt-0.5 block text-[11px]">{cashierGuide.detail}</span>
      </div>}

      {!splitGroup&&cart.items.reduce((s,i)=>s+i.qty,0)>=2&&<div role="radiogroup" aria-label="วิธีจ่ายของบิลนี้" data-pay-mode className="mt-4 grid grid-cols-2 gap-1 rounded-2xl bg-[#EFEAE0] p-1">
        {([["single","จ่ายรวมบิลเดียว"],["split","แยกจ่ายตามคน"]] as const).map(([mode,label])=>{const on=mode==="split"?splitBill:!splitBill;const blocked=busy||hasPendingPrompt||(mode==="split"&&(!online||method==="delivery"));return <button key={mode} type="button" role="radio" aria-checked={on} disabled={blocked&&!on} onClick={()=>{if(on)return;setSplitBill(mode==="split");setPaymentReviewOpen(mode==="split");setSplitSelection({});setPointsRedeemed(0);setReceived("");setResult("")}} className={"min-h-11 rounded-xl text-sm font-bold disabled:opacity-40 "+(on?"bg-white text-[#1F4D3A] shadow-sm":"text-[#5B6660]")}>{label}</button>})}
      </div>}
      <button type="button" aria-expanded={orderOptionsVisible} aria-controls="field-order-payment-options" disabled={busy||hasPendingPrompt} onClick={()=>{if(!splitGroup)setOrderOptionsOpen(v=>!v)}} className={"mt-4 min-h-11 w-full rounded-2xl border px-4 text-sm font-semibold "+(orderOptionsVisible?"border-[#d4af37] bg-[#fff8dc] text-[#765b08]":"border-slate-300 bg-white text-slate-700")+" disabled:opacity-40"}>{splitGroup?"คิวนี้กำลังแยกจ่าย":splitBill?"กำลังแยกจ่าย · สมาชิก/แต้ม":"ตัวเลือกบิล / สมาชิก"}</button>
      {orderOptionsVisible&&<div id="field-order-payment-options" className="mt-2 rounded-2xl border border-slate-200 bg-white p-3"><p className="mb-2 text-[11px] text-slate-500">ใช้เมื่อต้องแยกจ่าย หรือเลือกลูกค้าสมาชิก · บิลทั่วไปข้ามส่วนนี้ได้</p>
      <button type="button" disabled={busy||hasPendingPrompt||!online||method==="delivery"||cart.items.reduce((s,i)=>s+i.qty,0)<2} onClick={()=>{setOrderOptionsOpen(true);setSplitBill(v=>{const next=!v;setPaymentReviewOpen(next);return next});setSplitSelection({});setPointsRedeemed(0);setReceived("");setResult("")}} className={"mt-4 min-h-11 w-full rounded-2xl border px-4 text-sm font-semibold "+(splitBill?"border-[#d4af37] bg-[#fff8dc] text-[#765b08]":"border-slate-300 bg-white text-slate-700")+" disabled:opacity-40"}>{splitBill?"ยกเลิกแยกบิล":"แยกบิล / จ่ายแยกตามคน"}</button>
      {splitBill&&<div className="mt-2 rounded-2xl border border-[#d4af37]/40 bg-[#fffaf0] px-3 py-2 text-xs text-slate-700">เลือกจำนวนแก้วของ <b>คนที่กำลังจ่าย</b> · หลังชำระ รายการที่เหลือยังอยู่ในตะกร้าเพื่อรับเงินคนถัดไป</div>}
      {splitGroup&&<div className="mt-2 rounded-2xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><b>กลุ่มเดียวกัน · คิว {splitGroup.queueNo}</b> · การจ่ายคนถัดไปจะใช้คิวและบัตรเรียกเดิมอัตโนมัติ</div>}
      {customers.length>0&&<select disabled={!online||hasPendingPrompt} value={customerId} onChange={e=>{setCustomerId(e.target.value);setPointsRedeemed(0);setReceived("")}} className="mt-4 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 disabled:bg-slate-100 disabled:text-slate-400"><option value="">ลูกค้าทั่วไป / ไม่สะสมแต้ม</option>{customers.map(x=><option key={x.id} value={x.id}>{x.name} · {x.points||0} pts</option>)}</select>}
      {selectedCustomer&&redeemValue>0&&<div className="mt-3 rounded-2xl border border-[#d4af37]/40 bg-[#fffaf0] p-3"><div className="flex items-center justify-between text-sm"><span><b>{selectedCustomer.name}</b> · มี {Number(selectedCustomer.points)||0} แต้ม</span><span className="text-xs text-slate-500">1 แต้ม = ฿{redeemValue.toFixed(2)}</span></div><div className="mt-2 grid grid-cols-[1fr_auto] gap-2"><input type="number" inputMode="numeric" min="0" max={maxRedeemPoints} step="1" disabled={hasPendingPrompt} value={pointsRedeemed} onChange={e=>{setPointsRedeemed(Math.max(0,Math.min(maxRedeemPoints,Math.trunc(Number(e.target.value)||0))));setReceived("")}} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3" placeholder="แต้มที่ใช้"/><button type="button" disabled={hasPendingPrompt||maxRedeemPoints<1} onClick={()=>{setPointsRedeemed(maxRedeemPoints);setReceived("")}} className="rounded-xl border border-[#d4af37] px-3 text-xs font-bold text-[#765b08] disabled:opacity-40">ใช้ได้สูงสุด {maxRedeemPoints}</button></div>{redeemPoints>0&&<div className="mt-3 space-y-1 border-t border-amber-200 pt-2 text-sm"><div className="flex justify-between"><span>ยอดก่อนส่วนลด</span><b>฿{formatBaht(payableTotal)}</b></div><div className="flex justify-between text-amber-800"><span>ใช้ {redeemPoints} แต้ม</span><b>−฿{formatBaht(crmDiscount)}</b></div><div className="flex justify-between text-base"><b>ยอดสุทธิ</b><b className="text-[#765b08]">฿{formatBaht(netPayable)}</b></div><p className="text-[11px] text-slate-500">บิลนี้คาดว่าจะได้ +{estimatedPointsAwarded} แต้ม จากยอดจ่ายจริง</p></div>}</div>}
      </div>}

            <div className="mt-3 rounded-[20px] border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center justify-between gap-3"><div className="min-w-0"><b className="text-sm">{splitBill?"เลือกสำหรับบิลนี้":"รายการที่สั่ง"}</b><p className="mt-0.5 text-[11px] text-slate-500">{splitBill?"เลือกได้แม้เมนูเดียวกันมีหลายแก้ว":"ทวนเมนู ราคา และระดับหวานก่อนรับเงินเมื่อจำเป็น · ไม่ต้องยืนยันซ้ำ"}</p></div><div className="flex shrink-0 items-center gap-2"><b className="text-lg text-[#765b08]">฿{formatBaht(payableTotal)}</b>{!splitBill&&<button type="button" disabled={busy} onClick={()=>setPaymentReviewOpen(v=>!v)} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 disabled:opacity-40">{paymentReviewOpen?"ซ่อนรายการ":"ดูรายการ"}</button>}</div></div>
        {(splitBill||paymentReviewOpen)&&<div className="soft-scroll mt-3 max-h-[230px] space-y-2 overflow-auto pr-1">
          {cart.items.map(i=>{const selectedQty=splitBill?Math.min(i.qty,Math.max(0,Number(splitSelection[i.key])||0)):i.qty;return <div key={i.key} className={"rounded-2xl border bg-white p-3 "+(splitBill&&selectedQty>0?"border-[#d4af37]":"border-slate-200")}>
            <div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1"><b className="block text-sm">{i.name}</b>{splitBill?<span className="mt-1 inline-block rounded-full bg-[#f4ecd0] px-2 py-1 text-[10px] font-semibold text-[#765b08]">{orderOptionLabel(i.variant)}</span>:sweetnessChips(i,busy||hasPendingPrompt)}</div>{!splitBill&&<button disabled={busy||hasPendingPrompt} onClick={()=>cart.removeItem(i.key)} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30" aria-label={"ลบ "+i.name}><Trash2 size={15}/></button>}</div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">{splitBill?<div className="flex items-center gap-2"><button aria-label={"ลดจำนวนในบิลนี้ "+i.name} disabled={busy||selectedQty<=0} onClick={()=>setSplitSelection(s=>({...s,[i.key]:Math.max(0,selectedQty-1)}))} className="grid h-11 w-11 place-items-center rounded-xl border border-slate-300 bg-white disabled:opacity-30"><Minus size={13}/></button><span className="min-w-[68px] text-center text-xs font-semibold">บิลนี้ {selectedQty}/{i.qty}</span><button aria-label={"เพิ่มจำนวนในบิลนี้ "+i.name} disabled={busy||selectedQty>=i.qty} onClick={()=>setSplitSelection(s=>({...s,[i.key]:Math.min(i.qty,selectedQty+1)}))} className="grid h-11 w-11 place-items-center rounded-xl border border-slate-300 bg-white disabled:opacity-30"><Plus size={13}/></button></div>:<div className="flex items-center gap-2"><button aria-label={"ลดจำนวน "+i.name} disabled={busy||hasPendingPrompt} onClick={()=>updateCartQuantity(i.key,i.qty-1)} className="grid h-11 w-11 place-items-center rounded-xl border border-slate-300 bg-white disabled:opacity-30"><Minus size={13}/></button><span className="min-w-6 text-center text-sm font-semibold">{i.qty}</span><button aria-label={"เพิ่มจำนวน "+i.name} disabled={busy||hasPendingPrompt} onClick={()=>updateCartQuantity(i.key,i.qty+1)} className="grid h-11 w-11 place-items-center rounded-xl border border-slate-300 bg-white disabled:opacity-30"><Plus size={13}/></button></div>}<div className="text-right"><small className="block text-[10px] text-slate-500">{selectedQty} × ฿{formatBaht(i.price)}</small><b className="text-sm text-[#765b08]">฿{formatBaht((selectedQty*i.price))}</b></div></div>
          </div>})}
        </div>}
        <div className="mt-3 border-t border-slate-200 pt-3">{crmDiscount>0&&<div className="mb-1 flex items-center justify-between text-xs text-slate-500"><span>ยอดก่อนส่วนลด</span><span>฿{formatBaht(payableTotal)}</span></div>}{crmDiscount>0&&<div className="mb-1 flex items-center justify-between text-xs text-amber-700"><span>ส่วนลดสมาชิก</span><span>−฿{formatBaht(crmDiscount)}</span></div>}<div className="flex items-center justify-between"><span className="text-sm font-semibold">{splitBill?"บิลนี้":"รวม"} {payableQty} แก้ว</span><b className="text-xl text-[#765b08]">฿{formatBaht(netPayable)}</b></div></div>
      </div>

      {!online&&<div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"><b>เน็ตหลุด</b> · รับเงินสด{offlineQrId?" และ PromptPay (QR ในเครื่อง)":""}ได้ บิลเก็บไว้ในเครื่องและส่งเข้าระบบเองเมื่อเน็ตกลับ · แยกบิล / แต้มปิดชั่วคราว</div>}
      <p className="mt-4 text-xs font-semibold text-slate-600">เลือกวิธีชำระ</p><div className="mt-2 grid grid-cols-3 gap-2 rounded-2xl bg-slate-100 p-1"><button disabled={hasPendingPrompt||cashShiftUnavailable} onClick={()=>{setMethod("cash");setOtherPaymentOpen(false);setManualPaymentReference("")}} title={cashShiftUnavailable?"ต้องเปิดกะเงินสดก่อนรับเงินสด":undefined} className={"rounded-xl p-3 text-xs disabled:cursor-not-allowed disabled:opacity-45 sm:text-sm "+(method==="cash"?"bg-[#d4af37] font-semibold text-black shadow-sm":"text-slate-700")}>เงินสด</button><button disabled={(online?promptConfig?.ready!==true:!offlineQrId)||netPayable<=0||!!parkedRecord} onClick={()=>{setMethod("promptpay");setOtherPaymentOpen(false);setManualPaymentReference("")}} title={!online?(offlineQrId?"เน็ตหลุด · สร้าง QR ในเครื่องได้":"PromptPay ต้องใช้อินเทอร์เน็ต"):promptConfig?.ready===true?"PromptPay พร้อมใช้งาน":"รอ Beam อนุมัติ / ตั้งค่า API และ Webhook"} className={"rounded-xl p-3 text-xs sm:text-sm disabled:cursor-not-allowed disabled:opacity-45 "+(method==="promptpay"?"bg-[#d4af37] font-semibold text-black shadow-sm":"text-slate-700")}>PromptPay{promptConfig?.selectedProvider==="beam"&&promptConfig?.mode==="test"?" · TEST":""}</button><button type="button" aria-expanded={showOtherPayments} aria-controls="field-other-payment-methods" disabled={hasPendingPrompt} onClick={()=>{if(!otherPaymentActive)setOtherPaymentOpen(v=>!v)}} className={"rounded-xl p-3 text-xs font-semibold sm:text-sm "+(showOtherPayments?"bg-white text-[#765b08] shadow-sm":"text-slate-700")}>ช่องทางอื่น</button></div>
      {showOtherPayments&&<div id="field-other-payment-methods" className="mt-2 rounded-2xl border border-slate-200 bg-white p-2"><div className="mb-2 px-1 text-[11px] text-slate-500">ใช้เมื่อไม่ได้รับเงินสดหรือ PromptPay</div><div className="grid grid-cols-3 gap-2"><button disabled={!online||hasPendingPrompt} onClick={()=>{setMethod("bank");setOtherPaymentOpen(true);setReceived("")}} className={"min-h-11 rounded-xl border px-3 text-xs sm:text-sm disabled:opacity-45 "+(method==="bank"?"border-[#d4af37] bg-[#fff8dc] font-semibold text-[#765b08]":"border-slate-200 bg-white text-slate-700")}>โอน</button><button disabled={!online||hasPendingPrompt} onClick={()=>{setMethod("card");setOtherPaymentOpen(true);setReceived("")}} className={"min-h-11 rounded-xl border px-3 text-xs sm:text-sm disabled:opacity-45 "+(method==="card"?"border-[#d4af37] bg-[#fff8dc] font-semibold text-[#765b08]":"border-slate-200 bg-white text-slate-700")}>บัตร</button><button disabled={!online||hasPendingPrompt} onClick={()=>{setMethod("delivery");setOtherPaymentOpen(true);setSplitBill(false);setSplitSelection({});setReceived("");setManualPaymentReference("")}} className={"min-h-11 rounded-xl border px-3 text-xs sm:text-sm disabled:opacity-45 "+(method==="delivery"?"border-[#d4af37] bg-[#fff8dc] font-semibold text-[#765b08]":"border-slate-200 bg-white text-slate-700")}>เดลิเวอรี</button></div></div>}
      {hasPendingPrompt&&<div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900"><b>กำลังรอผล PromptPay เดิม</b> · รายการและช่องทางรับเงินอื่นถูกล็อกชั่วคราว ระบบจะตรวจ QR เดิมอัตโนมัติเพื่อป้องกันรับเงินซ้ำ</div>}
      {hasPendingPrompt&&method==="promptpay"&&!splitBill&&!splitGroup&&String(prompt?.status||"").toLowerCase()==="pending"&&!prompt?.paid&&<button type="button" data-park-prompt onClick={parkPendingPrompt} className="mt-3 flex min-h-12 w-full items-center justify-center rounded-2xl border-2 border-[#1F4D3A] bg-white px-4 text-sm font-black text-[#1F4D3A]">ลูกค้าสแกนแล้ว · รับออเดอร์ถัดไประหว่างรอเงินเข้า</button>}
      {cashShiftUnavailable&&<div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 px-3 py-3 text-xs text-amber-900"><div className="flex items-center justify-between gap-3"><div><b>เงินสดยังไม่พร้อม</b><p className="mt-1">ต้องเปิดกะเงินสดก่อน เพื่อให้ยอดตั้งต้น เงินทอน และปิดวันกระทบกันได้ถูกต้อง</p></div>{session.user.role==="admin"&&<button type="button" onClick={()=>{setPayOpen(false);setWorkspaceMounted(true);setWorkspaceOpen(true)}} className="min-h-11 shrink-0 rounded-xl border border-[#b98b00] bg-[#d4af37] px-3 font-bold text-black">เปิดกะตรงนี้</button>}</div>{session.user.role!=="admin"&&<p className="mt-2 font-semibold">ให้เจ้าของร้านเปิดกะ หรือเลือก PromptPay/ช่องทางอื่น</p>}</div>}
      {online&&promptConfig?.ready!==true&&<div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">PromptPay ยังไม่เปิดรับเงินจริง · ใช้เงินสดหรือช่องทางอื่นไปก่อน และให้เจ้าของร้านตรวจการตั้งค่า PromptPay</div>}
      {["bank","card"].includes(method)&&<div className="mt-3 rounded-[20px] border border-slate-200 bg-slate-50 p-3"><label className="text-xs font-semibold text-slate-700">{method==="bank"?"เลขอ้างอิงโอน / หมายเหตุ":"เลขอ้างอิงจากเครื่องรับบัตร"}</label><input value={manualPaymentReference} onChange={e=>setManualPaymentReference(e.target.value)} placeholder={method==="bank"?"เช่น เลขท้ายรายการโอน (ใส่ได้ถ้ามี)":"เช่น เลขท้ายรายการจากเครื่อง (ใส่ได้ถ้ามี)"} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3"/><p className="mt-2 text-[11px] text-slate-500">ระบบเก็บช่องทางนี้แยกในรายงานบัญชี · ไม่กระทบเงินสดในลิ้นชัก</p></div>}
      {method==="delivery"&&<div className="mt-3 rounded-[20px] border border-slate-200 bg-slate-50 p-3"><label className="text-xs font-semibold text-slate-700">แพลตฟอร์ม Delivery</label><select value={deliveryPlatform} onChange={e=>setDeliveryPlatform(e.target.value as any)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3"><option value="grab">Grab</option><option value="lineman">LINE MAN</option><option value="other_delivery">Delivery อื่น</option></select><div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-xl bg-white p-2"><span className="text-slate-500">ยอดขาย</span><b className="mt-1 block">฿{formatBaht(netPayable)}</b></div><div className="rounded-xl bg-white p-2"><span className="text-slate-500">GP {(deliveryGpRate*100).toFixed(1)}%</span><b className="mt-1 block text-red-600">−฿{deliveryGpFee.toFixed(2)}</b></div><div className="rounded-xl bg-white p-2"><span className="text-slate-500">รับสุทธิ</span><b className="mt-1 block text-emerald-700">฿{deliveryNetSettlement.toFixed(2)}</b></div></div><p className="mt-2 text-[11px] text-slate-500">ยอดขายยังบันทึกเต็มจำนวน ส่วน GP แยกเป็นค่าธรรมเนียมเพื่อให้รายงานกระแสเงินสดตรงกับเงินที่จะได้รับจริง</p></div>}
      {method==="cash"&&<><div className="mt-4 grid grid-cols-[1fr_auto] gap-2"><input aria-label="จำนวนเงินที่รับจากลูกค้า" autoFocus inputMode="decimal" value={received} onChange={e=>setReceived(e.target.value)} placeholder="รับเงินมาเท่าไร" className="min-w-0 rounded-2xl border border-slate-300 bg-slate-100 px-4 py-3 text-lg outline-none focus:border-[#c59b19]"/><button type="button" disabled={busy||!payableItems.length} onClick={()=>setReceived(String(netPayable))} className="min-h-12 rounded-2xl border border-[#d4af37] bg-[#fff8dc] px-3 text-sm font-bold text-[#765b08] disabled:opacity-40">รับเงินพอดี ฿{formatBaht(netPayable)}</button></div><div className="mt-2 grid grid-cols-3 gap-2">{quickCashAmounts.map(amount=><button key={amount} type="button" disabled={busy||!payableItems.length} onClick={()=>setReceived(String(amount))} className="min-h-11 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-700 disabled:opacity-40">฿{amount}</button>)}</div>{received.trim()!==""&&Number.isFinite(cashDelta)&&<div className={"mt-3 flex items-center justify-between rounded-2xl border px-4 py-3 "+(cashDelta>=0?"border-emerald-300 bg-emerald-50 text-emerald-900":"border-red-300 bg-red-50 text-red-800")}><span>{cashDelta>=0?"เงินทอน":"ขาดอีก"}</span><b className="text-xl">฿{formatBaht(Math.abs(cashDelta))}</b></div>}</>}
      {method==="promptpay"&&!prompt?.qrUrl&&qrPreview&&qrPreview.total===netPayable&&<div data-qr-preview className="mt-4 rounded-[20px] border border-slate-300 bg-white p-4 text-center"><img src={qrPreview.url} alt="PromptPay QR" className="mx-auto max-h-56 w-auto"/><p className="mt-2 text-sm font-black text-black">ยอด ฿{formatBaht(qrPreview.total)} · ให้ลูกค้าสแกนได้เลย</p><p className="mt-1 text-[11px] text-slate-600">กำลังเปิดรับเงินในระบบ…</p></div>}
      {method==="promptpay"&&prompt?.qrUrl&&<div className="mt-4 rounded-[20px] border border-slate-300 bg-white p-4 text-center"><img src={prompt.qrUrl} alt="PromptPay QR" className="mx-auto max-h-56 w-auto"/><p className="mt-2 text-xs font-semibold text-black">{prompt.paid?"ชำระเงินแล้ว":"สแกน QR แล้วระบบจะตรวจสอบอัตโนมัติ"}</p>
        {prompt.provider==="direct"&&!prompt.paid&&String(prompt.status||"")==="pending"&&<div className="mt-3 border-t border-slate-200 pt-3">
          <p className="text-[11px] text-slate-600">ยอดล็อก ฿{formatBaht(Number(prompt.amount)||0)} · เข้าบัญชีร้านโดยตรง · ระบบปิดบิลเองเมื่อแจ้งเตือนธนาคารมาถึง</p>
          {!directConfirmArmed?<button type="button" data-direct-confirm onClick={()=>setDirectConfirmArmed(true)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700">แจ้งเตือนไม่มา · เห็นเงินเข้าในแอปธนาคารแล้ว</button>:
          <div role="alertdialog" data-direct-confirm-panel aria-label="ยืนยันเห็นเงินเข้า" className="mt-2 scroll-mb-28 rounded-xl border border-amber-300 bg-amber-50 p-3 text-left">
            <b className="text-sm text-amber-950">เห็นยอด ฿{formatBaht(Number(prompt.amount)||0)} เข้าบัญชีร้านแล้วจริงใช่ไหม?</b>
            <p className="mt-1 text-[11px] text-amber-900">ตรวจในแอปธนาคารก่อนกด · ระบบบันทึกชื่อผู้ยืนยันไว้ตรวจตอนปิดวัน</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" onClick={()=>setDirectConfirmArmed(false)} className="min-h-11 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-700">ยังไม่เห็น</button>
              <button type="button" data-direct-confirm-yes disabled={directConfirmBusy} onClick={()=>confirmDirectPayment()} className="min-h-11 rounded-xl bg-[#1F4D3A] text-xs font-black text-white disabled:opacity-40">{directConfirmBusy?"กำลังบันทึก...":"เห็นแล้ว · ปิดบิล"}</button>
            </div>
          </div>}
        </div>}
      </div>}
      {method==="promptpay"&&offlineQr&&<div data-offline-qr className="mt-4 rounded-[20px] border-2 border-amber-300 bg-white p-4 text-center">
        <img src={offlineQr.url} alt="PromptPay QR ออฟไลน์" className="mx-auto max-h-56 w-auto"/>
        <p className="mt-2 text-sm font-black text-black">ยอด ฿{formatBaht(offlineQr.total)} · เข้าบัญชีร้านโดยตรง</p>
        <p className="mt-1 text-[11px] text-amber-900">เน็ตหลุด · ระบบตรวจเงินเข้าเองไม่ได้ ดูสลิปลูกค้าหรือแอปธนาคารก่อนกดบันทึก · เน็ตกลับแล้วระบบจับคู่กับแจ้งเตือนธนาคารให้เอง</p>
      </div>}
      <div className="sticky bottom-0 z-10 -mx-4 mt-4 border-t border-slate-200 bg-white/95 px-4 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:-mx-6 sm:px-6">
        <button disabled={busy||!payableItems.length||(method==="promptpay"&&hasPendingPrompt)||(method==="cash"&&(!Number.isFinite(cashReceived)||cashReceived<netPayable))} onClick={checkout} className="field-cart-action w-full rounded-2xl bg-[#d4af37] py-3.5 font-bold text-black shadow-sm disabled:opacity-40">{busy?(method==="promptpay"&&prompt?"กำลังตรวจสอบการชำระเงิน...":"กำลังบันทึกบิล..."):(method==="promptpay"?(hasPendingPrompt?"กำลังรอผล QR เดิม...":offlineQr?"เห็นเงินเข้าแล้ว · บันทึกบิล":!online?"สร้าง QR ในเครื่อง (เน็ตหลุด)":"สร้าง QR ให้ลูกค้า"):method==="delivery"?"ยืนยันออเดอร์เดลิเวอรี":method==="bank"?"ยืนยันรับเงินโอน":method==="card"?"ยืนยันรับบัตร":!online?"บันทึกเงินสด Offline":"ยืนยันรับเงิน")}</button>
        {!busy&&method==="cash"&&Number.isFinite(cashReceived)&&cashReceived===netPayable&&<p className="mt-2 text-center text-xs font-semibold text-emerald-700">รับเงินพอดียอด · กดยืนยันชำระได้เลย</p>}
        {result&&<p className="mt-2 rounded-xl bg-slate-100 px-3 py-2 text-center text-sm text-slate-700">{result}</p>}
      </div>
    </fieldset></ModalFocus></div>}

    {lastSale&&<div className="field-modal-overlay fixed inset-0 z-[95] flex items-end justify-center bg-slate-950/20 backdrop-blur-[2px] sm:grid sm:place-items-center">
      <ModalFocus labelId="field-payment-handoff-title" className={"field-modal-panel w-full max-w-[460px] overflow-auto rounded-[26px] border bg-white p-5 shadow-2xl "+(lastSale.offline?"border-amber-300":"border-emerald-300")} initialFocusSelector='[data-handoff-primary]'>
        <div className="flex items-start gap-3">
          <div className={"grid h-10 w-10 shrink-0 place-items-center rounded-full "+(lastSale.offline?"bg-amber-100 text-amber-700":"bg-emerald-100 text-emerald-700")}><CheckCircle2 size={22}/></div>
          <div className="min-w-0 flex-1">
            <div>
              <b id="field-payment-handoff-title" className="text-lg">{lastSale.offline?"บันทึกเงินสดไว้ในเครื่องแล้ว":splitPaymentPending?"รับเงินคนนี้สำเร็จ · คิวเดิมยังไม่จบ":"ชำระเงินสำเร็จ"}</b>
              <p className="mt-1 text-sm text-slate-600">{lastSale.offline?"เลขชั่วคราว "+lastSale.queueNo+" · รอส่งเข้าระบบเมื่อเน็ตกลับ":splitPaymentPending?"คิว "+lastSale.queueNo+" · เหลือ "+splitRemainingQty+" แก้ว รอรับเงินคนถัดไป":"คิว "+lastSale.queueNo+(lastSale.recovered?" · กู้คืนรายการเดิม":"")}</p>
            </div>
            {lastSale.offline?<div className="mt-3 rounded-[20px] border-2 border-amber-300 bg-amber-50 p-4 text-center"><div className="text-xs font-bold tracking-[.12em] text-amber-800">บิลรอส่ง</div><div className="mt-1 text-3xl font-black leading-none text-amber-900">{lastSale.queueNo}</div><p className="mt-2 text-xs text-amber-800">ทำและส่งมอบออเดอร์นี้ตามลำดับที่รับ · เมื่อเน็ตกลับ ระบบจะลงบัญชีและตัดสต็อกให้อัตโนมัติ โดยไม่สร้างคิวผลิตซ้ำ</p></div>:splitPaymentPending?<div className="mt-3 rounded-[20px] border-2 border-amber-300 bg-amber-50 p-4 text-center"><div className="text-xs font-black tracking-[.12em] text-amber-800">ยังไม่ต้องส่งคิวไปทำ</div><div className="mt-1 text-3xl font-black leading-none text-amber-900">เหลือ {splitRemainingQty} แก้ว</div><p className="mt-2 text-xs text-amber-800">รับเงินของคิว {lastSale.queueNo} ให้ครบก่อน · รายการที่เหลือยังอยู่ในตะกร้าเดิม</p></div>:<div className="mt-3 rounded-[20px] border-2 border-[#d4af37] bg-[#fff8dc] p-4 text-center"><div className="text-xs font-bold tracking-[.18em] text-[#765b08]">หยิบบัตรให้ลูกค้า</div><div className="mt-1 text-4xl font-black leading-none text-[#6f5510] md:text-5xl">บัตร {lastSale.pager||"—"}</div></div>}
            {lastSale.payment==="cash"&&<div className="mt-3 flex items-center justify-between rounded-2xl bg-emerald-50 p-3"><span className="text-sm font-semibold text-emerald-800">เงินทอน</span><div className="text-2xl font-bold text-emerald-800">฿{formatBaht(lastSale.change)}</div></div>}
            <div className="mt-3">
              <button data-handoff-primary onClick={()=>{if(lastSale.offline||splitPaymentPending){startNextOrder();return}setLastSale(null);openWorkspace("queue")}} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#d4af37] px-3 text-sm font-bold text-black">
                {lastSale.offline||splitPaymentPending?<Plus size={16}/>:<ArrowRight size={15}/>}
                {lastSale.offline?"รับออเดอร์ถัดไป":splitPaymentPending?"เลือกของคนถัดไป":"ทำคิว "+lastSale.queueNo+" ต่อเลย"}
              </button>
              {!lastSale.offline&&!splitPaymentPending&&<button type="button" data-handoff-next-order onClick={startNextOrder} className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border-2 border-slate-300 bg-white px-3 text-sm font-bold text-slate-800"><Plus size={16}/>รับออเดอร์ถัดไปก่อน · ทำทีหลัง</button>}
            </div>
            <p className="mt-2 text-center text-[11px] text-slate-500">{lastSale.offline?"ยอดถูกเก็บในเครื่องแล้ว · ห้ามล้างข้อมูลแอปหรือเบราว์เซอร์ จนกว่าระบบจะแจ้งว่าส่งบิลสำเร็จ":splitPaymentPending?"อย่าเปิดออเดอร์ใหม่จนกว่าจะรับเงินคิวนี้ครบ · ปุ่มเดียวจะพาไปเลือกรายการของคนถัดไป":"ไม่มีลูกค้ารอ → ทำเลย · มีคนต่อแถว → รับออเดอร์ก่อน คิวจะรอตามลำดับ"}</p>
          </div>
        </div>
      </ModalFocus>
    </div>}
    {workspaceMounted&&<PosDailyWorkspace session={session} bootstrap={data} open={workspaceOpen} online={online} requestedTab={workspaceRequestedTab} onClose={()=>{setWorkspaceOpen(false);setWorkspaceRequestedTab(null)}}/>} 
  </section>;
}
