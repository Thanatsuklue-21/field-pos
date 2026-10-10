"use client";
import {formatMoney} from "@/lib/money-format.mjs";

import {useEffect,useMemo,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {ArrowRight,CheckCircle2,Clock3,Minus,Plus,Search,Trash2,WalletCards,X} from "lucide-react";
import AuthGate from "@/components/auth-gate";
import {api,type Bootstrap,type MenuItem,type RevisionUnchanged,type Session} from "@/lib/api-client";
import {BOOTSTRAP_OFFLINE_MAX_AGE_MS,cacheGet} from "@/lib/offline-db";
import {getOfflineCashSummary,queueOfflineCashSale,syncOfflineCashSales,type OfflineCashSummary} from "@/lib/offline-sales";
import {additionalServingsAvailable,cartAvailability} from "@/lib/domain/availability.mjs";
import {useCartStore} from "@/stores/cart-store";
import {useHeldCartStore} from "@/stores/held-cart-store";
import {writeQueueSnapshotCache} from "@/lib/queue-cache"; import {clearRecovery,readRecovery,writeRecovery} from "@/lib/recovery-storage";
import {shouldRetainCashPending} from "@/lib/cash-recovery-policy.mjs";

export default function Pos(){return <AuthGate>{s=><PosView session={s}/>}</AuthGate>}

function localDate(){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}
function localTime(ts:number){
  return new Intl.DateTimeFormat("th-TH",{timeZone:"Asia/Bangkok",hour:"2-digit",minute:"2-digit"}).format(new Date(ts));
}

const BOOTSTRAP_CACHE_MAX_AGE_MS=BOOTSTRAP_OFFLINE_MAX_AGE_MS;
const PENDING_KEY="field-pos-pending-promptpay-v1";
type PendingPrompt={requestKey:string;payRequestKey?:string;sessionId?:string;date:string;cart:{id:string;variant:string;qty:number}[];paymentReference:string;total:number;customerId:string|null;pointsRedeemed?:number;createdAt:number;checkoutMode?:"full"|"split_bill";targetOrderId?:string|null};
const pendingRead=():PendingPrompt|null=>{try{return JSON.parse(localStorage.getItem(PENDING_KEY)||"null")}catch{return null}};
const pendingWrite=(p:PendingPrompt)=>localStorage.setItem(PENDING_KEY,JSON.stringify(p));
const pendingClear=()=>localStorage.removeItem(PENDING_KEY);
const samePending=(p:PendingPrompt,total:number,cart:{id:string;variant:string;qty:number}[],customerId:string,pointsRedeemed:number,targetOrderId?:string|null)=>p.total===total&&p.customerId===(customerId||null)&&Number(p.pointsRedeemed||0)===pointsRedeemed&&String(p.targetOrderId||"")===String(targetOrderId||"")&&JSON.stringify(p.cart)===JSON.stringify(cart);

const CASH_PENDING_KEY="field-pos-pending-cash-v1";
type PendingCash={body:any;createdAt:number};
type CashRecoveryReview={requestKey:string;date:string;total:number;received:number;createdAt:number;reason:"business_date_changed"|"day_closed"|"server_rejected"};
const cashPendingRead=():PendingCash|null=>{try{return JSON.parse(localStorage.getItem(CASH_PENDING_KEY)||"null")}catch{return null}};
const cashPendingWrite=(p:PendingCash)=>localStorage.setItem(CASH_PENDING_KEY,JSON.stringify(p));
const cashPendingClear=()=>localStorage.removeItem(CASH_PENDING_KEY);
const sameCashPending=(p:PendingCash,total:number,cart:{id:string;variant:string;qty:number}[],customerId:string,received:number,pointsRedeemed:number,targetOrderId?:string|null)=>Number(p.body?.received)===received&&Number(p.body?.total??total)===total&&(p.body?.customerId||null)===(customerId||null)&&Number(p.body?.pointsRedeemed||0)===pointsRedeemed&&String(p.body?.targetOrderId||"")===String(targetOrderId||"")&&JSON.stringify(p.body?.cart||[])===JSON.stringify(cart);

type LastSale={queueNo:string;pager:number;billNo?:string;total:number;received:number;change:number;payment:"cash"|"promptpay"|"bank"|"card"|"delivery";recovered?:boolean;offline?:boolean};
type SplitGroup={orderId:string;queueNo:string;pager:number;createdAt:number};
const SPLIT_GROUP_KEY="field-pos-split-group-v1",EDIT_CASH_KEY="field-pos-edit-cash-v1";
const splitGroupRead=():SplitGroup|null=>readRecovery<SplitGroup>(SPLIT_GROUP_KEY);
const splitGroupWrite=(g:SplitGroup)=>writeRecovery(SPLIT_GROUP_KEY,g);
const splitGroupClear=()=>clearRecovery(SPLIT_GROUP_KEY);

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
  const [payOpen,setPayOpen]=useState(false);
  const [heldOpen,setHeldOpen]=useState(false);
  const [method,setMethod]=useState<"cash"|"promptpay"|"bank"|"card"|"delivery">("cash");
  const [deliveryPlatform,setDeliveryPlatform]=useState<"grab"|"lineman"|"other_delivery">("grab");
  const [received,setReceived]=useState("");
  const [manualPaymentReference,setManualPaymentReference]=useState("");
  const [busy,setBusy]=useState(false);
  const [result,setResult]=useState("");
  const [notice,setNotice]=useState("");
  const [cashRecoveryReview,setCashRecoveryReview]=useState<CashRecoveryReview|null>(null);
  const [lastSale,setLastSale]=useState<LastSale|null>(null);
  const [prompt,setPrompt]=useState<any|null>(null);
  const [promptConfig,setPromptConfig]=useState<any|null>(null);
  const [customers,setCustomers]=useState<any[]>([]);
  const [customerId,setCustomerId]=useState("");
  const [loyalty,setLoyalty]=useState({pointsSpend:0,pointsRedeemValue:0});
  const [pointsRedeemed,setPointsRedeemed]=useState(0);
  const [editCustomerRecovery,setEditCustomerRecovery]=useState<{customerId:string;pointsRedeemed:number}|null>(null);
  const [splitBill,setSplitBill]=useState(false);
  const [splitSelection,setSplitSelection]=useState<Record<string,number>>({});
  const [splitGroup,setSplitGroup]=useState<SplitGroup|null>(null);
  const [online,setOnline]=useState(true);
  const [offlineStats,setOfflineStats]=useState<OfflineCashSummary>({pending:0,needsReview:0,total:0});
  const [offlineSyncing,setOfflineSyncing]=useState(false);
  const revisionRef=useRef<number|null>(null);
  const offlineSyncRef=useRef(false);
  const cart=useCartStore();
  const heldBills=useHeldCartStore();

  useEffect(()=>{router.prefetch("/queue")},[router]);

  const acceptBootstrap=(next:Bootstrap|RevisionUnchanged)=>{
    if(next?.unchanged===true)return false;
    revisionRef.current=Math.max(revisionRef.current||0,Number(next.revision)||0);
    setData(prev=>!prev||next.revision>=prev.revision?next:prev);
    return true;
  };
  const load=(force=false)=>api<Bootstrap|RevisionUnchanged>("/api/pos/bootstrap",!force&&revisionRef.current!==null?{headers:{"X-Field-Revision":String(revisionRef.current)}}:{}).then(acceptBootstrap);
  const loadCustomers=()=>api<any>("/api/customers").then(x=>{setCustomers(x.customers||[]);setLoyalty({pointsSpend:Number(x.loyalty?.pointsSpend)||0,pointsRedeemValue:Number(x.loyalty?.pointsRedeemValue)||0})});

  useEffect(()=>{
    let active=true;
    const savedGroup=splitGroupRead();if(savedGroup?.orderId)setSplitGroup(savedGroup);

    // Render the last known sellable catalog immediately, then revalidate from Cloud.
    // acceptBootstrap is revision-aware, so a late cache read cannot overwrite newer server data.
    cacheGet<Bootstrap>("/api/pos/bootstrap",BOOTSTRAP_CACHE_MAX_AGE_MS)
      .then(cached=>{if(active&&cached)acceptBootstrap(cached)})
      .catch(()=>{});
    load(true).catch(()=>{});

    // These calls are non-blocking secondary data; the menu can render from IndexedDB first.
    loadCustomers().catch(()=>{});
    api<any>("/api/payments/promptpay/config").then(setPromptConfig).catch(()=>setPromptConfig({ready:false,configured:false}));
    recoverCashCheckout().then(()=>recoverPending()).catch(()=>{});
    return()=>{active=false};
  },[]);

  useEffect(()=>{
    const networkChanged=()=>{
      const next=typeof navigator==="undefined"||navigator.onLine;
      setOnline(next);
      refreshOfflineStats().catch(()=>{});
      if(next&&!session.offline)syncOfflineQueue().catch(()=>{});
    };
    networkChanged();
    window.addEventListener("online",networkChanged);
    window.addEventListener("offline",networkChanged);
    return()=>{window.removeEventListener("online",networkChanged);window.removeEventListener("offline",networkChanged)};
  },[]);

  useEffect(()=>{if(!session.offline&&online)syncOfflineQueue().catch(()=>{})},[session.offline,session.csrf]);

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
      const edit=readRecovery<any>(EDIT_CASH_KEY);
      if(!edit)return;
      const heldCash=Number(edit?.heldCash);
      if(Number.isFinite(heldCash)&&heldCash>0){
        setMethod("cash");
        setReceived(String(heldCash));
        if(edit?.customerId)setEditCustomerRecovery({customerId:String(edit.customerId),pointsRedeemed:Math.max(0,Math.trunc(Number(edit.pointsRedeemed)||0))});
        setNotice("กำลังแก้ไข "+String(edit?.fromQueue||edit?.fromBill||"บิลเดิม")+" · ยอดเงินสดจากบิลเดิม ฿"+formatMoney(heldCash)+" ถูกกรอกไว้แล้ว เพิ่ม/ลด/เปลี่ยนเมนูแล้วกด CHECKOUT ใหม่");
      }
    }catch{}
  },[]);

  useEffect(()=>{
    if(!editCustomerRecovery||!customers.length)return;
    const found=customers.some(x=>x.id===editCustomerRecovery.customerId);
    if(found){
      setCustomerId(editCustomerRecovery.customerId);
      setPointsRedeemed(editCustomerRecovery.pointsRedeemed);
      setNotice(prev=>(prev?prev+" · ":"")+"เรียกคืนลูกค้าและแต้มจากบิลเดิมแล้ว กรุณาตรวจสอบก่อนชำระ");
    }else{
      setNotice(prev=>(prev?prev+" · ":"")+"ไม่พบลูกค้าเดิมในระบบ กรุณาเลือกลูกค้าใหม่ก่อนชำระ");
    }
    setEditCustomerRecovery(null);
  },[customers,editCustomerRecovery]);

  useEffect(()=>{
    const refresh=()=>load().catch(()=>{});
    const visible=()=>{if(document.visibilityState==="visible")refresh()};
    const timer=setInterval(refresh,15000);
    window.addEventListener("focus",refresh);document.addEventListener("visibilitychange",visible);
    return()=>{clearInterval(timer);window.removeEventListener("focus",refresh);document.removeEventListener("visibilitychange",visible)};
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

  const cats=useMemo(()=>["ทั้งหมด",...Array.from(new Set((data?.menu||[]).filter(sellable).map(x=>x.category||"อื่นๆ")))], [data]);
  const menu=(data?.menu||[]).filter(x=>sellable(x)&&(cat==="ทั้งหมด"||(x.category||"อื่นๆ")===cat)&&x.name.toLowerCase().includes(q.toLowerCase()));
  const allUnavailable=menu.length>0&&menu.every(x=>!x.available);
  const unavailableNames=Array.from(new Set(menu.flatMap(x=>x.variants.flatMap(v=>v.missingIngredients||[]).map(i=>i.name)))).slice(0,4);
  const total=cart.getTotal();
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
    setOfflineStats(await getOfflineCashSummary());
  }

  async function syncOfflineQueue(){
    if(session.offline||offlineSyncRef.current||typeof navigator!=="undefined"&&!navigator.onLine)return;
    offlineSyncRef.current=true;
    setOfflineSyncing(true);
    window.dispatchEvent(new CustomEvent("field:sync",{detail:{status:"syncing"}}));
    try{
      const sync=await syncOfflineCashSales(session);
      setOfflineStats({pending:sync.pending,needsReview:sync.needsReview,total:sync.total});
      if(sync.synced>0){setNotice("ซิงก์ยอดเงินสด Offline สำเร็จ "+sync.synced+" บิล · Cloud/Stock อัปเดตแล้ว");await load(true).catch(()=>{});await loadCustomers().catch(()=>{})}
      if(sync.needsReview>0){setNotice("มีบิล Offline "+sync.needsReview+" รายการที่ต้องตรวจสอบก่อนลง Cloud · ระบบเก็บรายการไว้และไม่ลบทิ้ง");window.dispatchEvent(new CustomEvent("field:sync",{detail:{status:"sync_error"}}))}
      else window.dispatchEvent(new CustomEvent("field:sync",{detail:{status:"online"}}));
    }catch(error:any){
      window.dispatchEvent(new CustomEvent("field:sync",{detail:{status:"sync_error"}}));
      setNotice(error?.status===401||error?.status===403||error?.message==="offline_session_revalidation"
        ?"ยังส่งบิล Offline ไม่ได้ · กรุณาตรวจการเข้าสู่ระบบและสิทธิ์ผู้ใช้ บิลยังเก็บอยู่ในเครื่อง"
        :"ยังส่งบิล Offline ไม่ครบ · บิลที่ค้างยังเก็บอยู่ในเครื่อง ตรวจอินเทอร์เน็ตแล้วกดส่งบิลที่ค้างอีกครั้ง");
      refreshOfflineStats().catch(()=>{});
      throw error;
    }
    finally{offlineSyncRef.current=false;setOfflineSyncing(false)}
  }

  function finishOfflineSale(localNo:string,opts:{total:number;received:number;bootstrap:Bootstrap}){
    setData(opts.bootstrap);
    setPayOpen(false);
    setResult("");
    setPrompt(null);
    cart.clearCart();
    setReceived("");
    setCustomerId("");
    setPointsRedeemed(0);
    setSplitSelection({});
    setSplitBill(false);
    splitGroupClear();setSplitGroup(null);clearRecovery(EDIT_CASH_KEY);
    setLastSale({queueNo:localNo,pager:0,total:opts.total,received:opts.received,change:Math.max(0,opts.received-opts.total),payment:"cash",offline:true});
    setNotice("บันทึกเงินสดแบบ Offline แล้ว · "+localNo+" · ระบบจะซิงก์ Cloud อัตโนมัติเมื่ออินเทอร์เน็ตกลับมา");
    refreshOfflineStats().catch(()=>{});
  }

  function finishSale(r:any,opts:{payment:"cash"|"promptpay"|"bank"|"card"|"delivery";total:number;received:number;recovered?:boolean;splitBill?:boolean;paidCart?:{id:string;variant:string;qty:number}[]}){
    applyServerState(r);
    const serverTotal=Number(r?.total??opts.total);
    const serverReceived=Number(r?.received??opts.received);
    const serverChange=Number(r?.change??(opts.payment==="cash"?Math.max(0,serverReceived-serverTotal):0));
    setPayOpen(false);
    setResult("");
    setPrompt(null);
    const remaining=opts.splitBill&&opts.paidCart?subtractPaidCart(opts.paidCart):(cart.clearCart(),[]);
    setReceived("");
    setCustomerId("");
    setPointsRedeemed(0);
    setSplitSelection({});
    setSplitBill(false);
    if(!remaining.length)clearRecovery(EDIT_CASH_KEY);
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

  function addVariant(product:MenuItem,variant:MenuItem["variants"][number]){
    const remaining=additionalServingsAvailable({cart:cart.items,menu:data?.menu||[],stock:data?.availabilityStock||{},menuId:product.id,variantLabel:variant.label});
    if(!variant.available||remaining<1){setNotice("วัตถุดิบเพียงพออีก 0 แก้วเท่านั้น"+(variant.missingIngredients?.length?" · ขาด: "+variant.missingIngredients.map(x=>x.name).join(", "):""));return}
    cart.addItem({id:product.id,name:product.name,variant:variant.label,price:product.price});setSelected(null);
  }

  function updateCartQuantity(key:string,nextQty:number){
    const item=cart.items.find(x=>x.key===key);if(!item)return;
    if(nextQty<=item.qty){cart.updateQuantity(key,nextQty);return}
    const remaining=additionalServingsAvailable({cart:cart.items,menu:data?.menu||[],stock:data?.availabilityStock||{},menuId:item.id,variantLabel:item.variant});
    if(remaining<1){setNotice("วัตถุดิบเพียงพออีก 0 แก้วเท่านั้น");return}
    cart.updateQuantity(key,nextQty);
  }

  function holdCurrentBill(){
    if(!cart.items.length)return;
    if(pendingRead()||cashPendingRead()){
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
    setPrompt(null);
    setReceived("");
    setMethod("cash");
    setSelected(null);
    setQ("");
    setCat("ทั้งหมด");
  }


  async function recoverCashCheckout(){
    const p=cashPendingRead();
    if(!p)return;
    const ageMs=Math.max(0,Date.now()-Number(p.createdAt||0));
    if(ageMs>24*60*60*1000)setNotice("พบรายการเงินสดค้างเกิน 24 ชม. · กำลังตรวจ request เดิมกับ Server ก่อน เพื่อป้องกันบิลซ้ำ");
    try{
      const r=await api<any>("/api/pos/checkout",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(p.body)});
      cashPendingClear();
      setCashRecoveryReview(null);
      finishSale(r,{payment:"cash",total:Number(p.body?.total)||0,received:Number(p.body?.received)||0,recovered:true,splitBill:p.body?.checkoutMode==="split_bill",paidCart:Array.isArray(p.body?.cart)?p.body.cart:undefined});
    }catch(e:any){
      if(["business_date_changed","day_closed"].includes(e.message)){
        setCashRecoveryReview({
          requestKey:String(p.body?.requestKey||""),
          date:String(p.body?.date||""),
          total:Number(p.body?.total)||0,
          received:Number(p.body?.received)||0,
          createdAt:Number(p.createdAt)||0,
          reason:e.message
        });
        setNotice("รายการเงินสดค้างข้ามวันและ Server ไม่พบ replay ที่ยืนยันได้ · กรุณาตรวจ Orders ก่อน ระบบยังเก็บ request เดิมไว้และจะไม่สร้างบิลซ้ำ");
      }else if(shouldRetainCashPending(e)){
        setCashRecoveryReview(null);
        setNotice("ยังยืนยันผลรายการเงินสดค้างไม่ได้ · ระบบเก็บ request เดิมไว้เพื่อป้องกันบิลซ้ำ กรุณาตรวจการเชื่อมต่อ/เข้าสู่ระบบแล้วลองอีกครั้ง");
      }else{
        setCashRecoveryReview({
          requestKey:String(p.body?.requestKey||""),
          date:String(p.body?.date||""),
          total:Number(p.body?.total)||0,
          received:Number(p.body?.received)||0,
          createdAt:Number(p.createdAt)||0,
          reason:"server_rejected"
        });
        setNotice("Server ปฏิเสธรายการเงินสดเดิม · ระบบยังไม่ล้าง pending อัตโนมัติ กรุณาตรวจ Orders ก่อน เพื่อยืนยันว่าไม่มีบิลจาก request เดิม");
      }
    }
  }

  function clearReviewedCashPending(){
    if(session.user.role!=="admin"||!cashRecoveryReview)return;
    const pending=cashPendingRead();
    if(!pending||String(pending.body?.requestKey||"")!==cashRecoveryReview.requestKey){
      setCashRecoveryReview(null);
      setNotice("รายการเงินสดค้างในเครื่องเปลี่ยนไปแล้ว · กรุณารีเฟรชและตรวจใหม่");
      return;
    }
    const ok=window.confirm(
      "ยืนยันว่าตรวจ Orders แล้วและไม่พบบิลจาก request นี้?\n"+
      "วันที่เดิม: "+cashRecoveryReview.date+" · ยอด ฿"+formatMoney(cashRecoveryReview.total)+"\n"+
      "การทำรายการนี้จะล้างเฉพาะ pending ในเครื่อง ไม่สร้างยอดขายและไม่เปลี่ยน Stock"
    );
    if(!ok)return;
    cashPendingClear();
    setCashRecoveryReview(null);
    setPayOpen(false);
    setNotice("ล้าง pending เงินสดในเครื่องแล้ว · หากรับเงินจริงไปแล้ว ต้องบันทึก/ปรับปรุงยอดตามหลักฐานด้วย Admin ก่อนปิดวัน");
  }

  async function finalizePending(p:PendingPrompt,verified:string){
    if(p.sessionId){
      const status=await api<any>("/api/pos/split/status",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({sessionId:p.sessionId})});
      if(status?.session?.status==="completed"){
        pendingClear();
        if(p.checkoutMode!=="split_bill")cart.clearCart();
        finishSale({orderId:status.session.orderId,queueNo:status.session.queueNo,pager:status.session.pager,total:status.session.total},{payment:"promptpay",total:p.total,received:p.total,recovered:true,splitBill:p.checkoutMode==="split_bill",paidCart:p.cart});
        return status;
      }
      const allocations=p.cart.map((x,index)=>({index,qty:x.qty}));
      const body={requestKey:p.payRequestKey||crypto.randomUUID(),sessionId:p.sessionId,method:"promptpay",allocations,paymentReference:p.paymentReference,paymentVerified:verified,label:"PromptPay"};
      try{
        const r=await api<any>("/api/pos/split/pay",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)});
        pendingClear();
        cart.clearCart();
        finishSale(r,{payment:"promptpay",total:p.total,received:p.total,recovered:true,splitBill:p.checkoutMode==="split_bill",paidCart:p.cart});
        return r;
      }catch(e:any){
        if(e.message==="split_session_unavailable"){
          const retry=await api<any>("/api/pos/split/status",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({sessionId:p.sessionId})});
          if(retry?.session?.status==="completed"){
            pendingClear();
            if(p.checkoutMode!=="split_bill")cart.clearCart();
            finishSale({orderId:retry.session.orderId,queueNo:retry.session.queueNo,pager:retry.session.pager,total:retry.session.total},{payment:"promptpay",total:p.total,received:p.total,recovered:true,splitBill:p.checkoutMode==="split_bill",paidCart:p.cart});
            return retry;
          }
        }
        throw e;
      }
    }
    const body={requestKey:p.requestKey,date:p.date,cart:p.cart,payment:"promptpay",received:p.total,paymentReference:p.paymentReference,paymentVerified:verified,customerId:p.customerId,pointsRedeemed:Number(p.pointsRedeemed||0),checkoutMode:p.checkoutMode||"full",targetOrderId:p.targetOrderId||undefined};
    const r=await api<any>("/api/pos/checkout",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)});
    pendingClear();
    cart.clearCart();
    finishSale(r,{payment:"promptpay",total:p.total,received:p.total,recovered:true,splitBill:p.checkoutMode==="split_bill",paidCart:p.cart});
    return r;
  }

  async function cancelPendingReservation(p:PendingPrompt){
    if(!p.sessionId)return;
    try{
      await api<any>("/api/pos/split/cancel",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({requestKey:crypto.randomUUID(),sessionId:p.sessionId})});
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
      st=await api<any>("/api/payments/promptpay/create",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({amount:next.total,reference:next.sessionId})});
      if(!st?.chargeId)throw new Error("promptpay_qr_unavailable");
      next={...next,paymentReference:st.chargeId};
      pendingWrite(next);
    }
    return {pending:next,status:st};
  }

  async function recoverPending(){
    let p=pendingRead();
    if(!p)return;
    try{
      if(!p.sessionId||!p.paymentReference){
        const resumed=await ensurePendingPrompt(p);
        p=resumed.pending;
        if(resumed.status)setPrompt(resumed.status);
      }
      if(p.sessionId){
        const sessionStatus=await api<any>("/api/pos/split/status",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({sessionId:p.sessionId})});
        if(sessionStatus?.session?.status==="completed"){
          pendingClear();
          if(p.checkoutMode!=="split_bill")cart.clearCart();
          finishSale({orderId:sessionStatus.session.orderId,queueNo:sessionStatus.session.queueNo,pager:sessionStatus.session.pager,total:sessionStatus.session.total},{payment:"promptpay",total:p.total,received:p.total,recovered:true,splitBill:p.checkoutMode==="split_bill",paidCart:p.cart});
          return;
        }
        if(["expired","cancelled"].includes(String(sessionStatus?.session?.status||"").toLowerCase())){pendingClear();return}
      }
      const st=await api<any>("/api/payments/promptpay/status",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({chargeId:p.paymentReference})});
      if(st.paid){await finalizePending(p,st.chargeId||p.paymentReference);return}
      if(["failed","expired","reversed"].includes(String(st.status||"").toLowerCase())){await cancelPendingReservation(p);pendingClear();return}
      setMethod("promptpay");
      setPrompt(st);
      setPayOpen(true);
      setResult("พบ PromptPay ที่ยังรอชำระ ระบบใช้ QR เดิม ตรวจสอบรายการเดิม และยังคงจอง Stock ไว้เพื่อป้องกันรับเงินเกินจำนวนที่ขายได้");
    }catch{
      setMethod("promptpay");
      setPayOpen(true);
      setResult("ยังตรวจสอบ PromptPay รายการเดิมไม่ได้ ระบบเก็บรายการและ Stock reservation ไว้เพื่อป้องกันบิล/การรับเงินซ้ำ");
    }
  }

  function errorText(code:string){
    return code==="cash_insufficient"?"จำนวนเงินรับไม่พอ":
      code==="menu_unavailable"?"มีเมนูในตะกร้าที่ปิดขาย ราคาเป็น 0 หรือยังไม่พร้อมขาย กรุณาตรวจตะกร้าใหม่":
      code==="request_key_conflict"?"รายการเดิมถูกเปลี่ยน กรุณาตรวจประวัติออเดอร์ก่อนชำระอีกครั้ง":
      code==="recipe_unavailable"?"สูตรเมนูยังไม่ครบหรือมีปริมาณผิด กรุณาตรวจสูตรก่อนขาย":
      code==="day_closed"?"วันนี้ปิดยอดแล้ว ไม่สามารถรับรายการขายเพิ่มได้":
      code==="variant_unavailable"?"ตัวเลือกของเมนูในตะกร้าเปลี่ยนแล้ว กรุณาเลือกเมนูใหม่":
      (code==="stock_shortage"||code.startsWith("stock_shortage:"))?"วัตถุดิบไม่เพียงพอสำหรับออเดอร์นี้":
      code==="promptpay_timeout"?"หมดเวลารอ PromptPay ระบบยังเก็บรายการจองไว้ชั่วคราวและจะตรวจสอบอีกครั้ง":
      code==="promptpay_not_ready"?"PromptPay ยังไม่พร้อมใช้งาน กรุณารอ Beam อนุมัติและตั้งค่า API/Webhook ให้ครบ":
      code==="promptpay_provider_not_configured"?"ยังไม่ได้ตั้งค่า Beam Merchant ID / API Key":
      code==="promptpay_webhook_not_configured"?"ยังไม่ได้ตั้งค่า Beam Webhook HMAC Key":
      code==="promptpay_failed"?"PromptPay ไม่สำเร็จ กรุณาลองใหม่":
      code==="pending_promptpay_exists"?"มี PromptPay รายการเดิมที่ยังไม่สิ้นสุด กรุณาชำระหรือรอผลรายการเดิม":
      code==="pending_cash_checkout_exists"?"มีออเดอร์เงินสดเดิมที่ยังไม่ทราบผล กรุณารอระบบตรวจรายการเดิมก่อนรับบิลใหม่":
      code==="business_date_changed"?"วันธุรกิจเปลี่ยนแล้ว กรุณาตรวจ Orders ก่อนทำรายการใหม่":
      code==="offline_cash_only"?"โหมด Offline รับได้เฉพาะเงินสด":
      code==="offline_split_not_supported"?"โหมด Offline ยังไม่รองรับแยกบิล/เพิ่มเข้าคิวเดิม กรุณารับเป็นบิลปกติ":
      code==="offline_loyalty_not_supported"?"โหมด Offline งดสะสม/ใช้แต้มชั่วคราว เพื่อป้องกันแต้มซ้ำข้ามอุปกรณ์":
      code==="offline_storage_unavailable"?"เครื่องนี้ไม่สามารถเปิดพื้นที่เก็บ Offline ได้ กรุณาเชื่อมต่ออินเทอร์เน็ตก่อนขาย":
      code==="offline_storage_failed"?"บันทึกบิล Offline ไม่สำเร็จ · ตะกร้ายังอยู่ กรุณาตรวจพื้นที่เก็บข้อมูลหรือเชื่อมต่ออินเทอร์เน็ตก่อนลองอีกครั้ง":
      code==="offline_catalog_unavailable"?"ไม่มีข้อมูลเมนู/สต็อกที่ cache ไว้ จึงยังขาย Offline ไม่ได้":
      code==="offline_session_revalidation"?"อินเทอร์เน็ตกลับมาแล้ว · กำลังตรวจสิทธิ์ผู้ใช้กับ Server กรุณากดชำระอีกครั้ง":
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
    if(cashRecoveryReview){
      setResult("ต้องตรวจรายการเงินสดค้างก่อนรับชำระบิลใหม่");
      return;
    }
    setBusy(true);
    setResult("");
    try{
      let checkoutTotal=netPayable;
      const cartPayload=payableItems.map(i=>({id:i.id,variant:i.variant,qty:i.qty}));
      const checkoutMode=splitBill?"split_bill":"full";
      let paymentVerified:any=true,paymentReference:any=null,requestKey=crypto.randomUUID();
      if(method==="cash"&&Number(received)<checkoutTotal)throw Object.assign(new Error("cash_insufficient"),{status:409});

      const offlineAtStart=typeof navigator!=="undefined"&&!navigator.onLine;
      if(!offlineAtStart&&session.offline)throw Object.assign(new Error("offline_session_revalidation"),{status:409});
      if(offlineAtStart){
        if(method!=="cash")throw Object.assign(new Error("offline_cash_only"),{status:409});
        if(splitBill||splitGroup)throw Object.assign(new Error("offline_split_not_supported"),{status:409});
        if(customerId||redeemPoints>0)throw Object.assign(new Error("offline_loyalty_not_supported"),{status:409});
        if(!data)throw Object.assign(new Error("offline_catalog_unavailable"),{status:409});
        const offlineCreatedAt=Date.now();
        const body={
          requestKey,date:localDate(),cart:cartPayload,payment:"cash",received:Number(received),
          customerId:null,pointsRedeemed:0,total:checkoutTotal,checkoutMode:"full",
          offlineFulfilled:true,offlineCreatedAt,offlineMenuRevision:data.revision
        };
        const queued=await queueOfflineCashSale(body,{projectStock:true});
        if(!queued.bootstrap)throw new Error("offline_storage_failed");
        finishOfflineSale(queued.localNo,{total:checkoutTotal,received:Number(received),bootstrap:queued.bootstrap});
        return;
      }

      if(method==="promptpay"){
        if(promptConfig?.ready!==true)throw Object.assign(new Error("promptpay_not_ready"),{status:503});
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
          if(["failed","expired","reversed"].includes(String(current.status||"").toLowerCase())){await cancelPendingReservation(resumed);pendingClear()}
          else if(!samePending(resumed,checkoutTotal,cartPayload,customerId,redeemPoints,splitGroup?.orderId||null))throw Object.assign(new Error("pending_promptpay_exists"),{status:409});
          else{st=current;paymentReference=resumed.paymentReference;requestKey=resumed.requestKey;activePending=resumed;checkoutTotal=resumed.total}
        }
        if(!st){
          const reservationKey=crypto.randomUUID();
          const payRequestKey=crypto.randomUUID();
          activePending={requestKey:reservationKey,payRequestKey,date:localDate(),cart:cartPayload,paymentReference:"",total:checkoutTotal,customerId:customerId||null,pointsRedeemed:redeemPoints,createdAt:Date.now(),checkoutMode,targetOrderId:splitGroup?.orderId||null};
          pendingWrite(activePending);
          const setup=await ensurePendingPrompt(activePending);
          activePending=setup.pending;
          st=setup.status||await api<any>("/api/payments/promptpay/status",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({chargeId:activePending.paymentReference})});
          checkoutTotal=activePending.total;
          paymentReference=activePending.paymentReference;
        }
        setPrompt(st);
        const deadline=Date.now()+15*60*1000;
        while(!st.paid&&Date.now()<deadline){
          if(["failed","expired","reversed"].includes(String(st.status||"").toLowerCase())){
            if(activePending)await cancelPendingReservation(activePending);
            pendingClear();
            throw Object.assign(new Error("promptpay_failed"),{status:409});
          }
          await new Promise(resolve=>setTimeout(resolve,2500));
          st=await api<any>("/api/payments/promptpay/status",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({chargeId:paymentReference})});
          setPrompt(st);
        }
        if(!st.paid)throw new Error("promptpay_timeout");
        const p=activePending||pendingRead();
        if(p?.sessionId){await finalizePending(p,st.chargeId||paymentReference);return}
        paymentVerified=st.chargeId||paymentReference;
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
      if(method==="cash"&&!shouldRetainCashPending(e))cashPendingClear();
      const message=errorText(e.message);
      if(["menu_unavailable","variant_unavailable"].includes(e.message)||e.message==="stock_shortage"||e.message.startsWith("stock_shortage:")){
        setPayOpen(false);
        setNotice(message);
        load().catch(()=>{});
      }else{
        setResult(method==="cash"&&e.message==="network_unavailable"?"การเชื่อมต่อขาดหาย · เก็บ request เดิมไว้และจะตรวจซ้ำอัตโนมัติ":message);
      }
    }finally{
      setBusy(false);
    }
  }

  function openPayment(){
    if(!cart.items.length)return;
    if(cashRecoveryReview){
      setNotice("ต้องตรวจรายการเงินสดค้างก่อนเปิดชำระบิลใหม่ · เปิด Orders หรือให้ Admin ล้าง pending ที่ตรวจแล้ว");
      return;
    }
    const byId=new Map((data?.menu||[]).filter(sellable).map(x=>[x.id,x]));
    const blocked=cart.items.filter(item=>{
      const variant=byId.get(item.id)?.variants?.find(v=>v.label===item.variant);
      return !variant||!variant.available;
    });
    if(blocked.length){
      const blockedKeys=new Set(blocked.map(item=>item.key));
      cart.replaceItems(cart.items.filter(item=>!blockedKeys.has(item.key)));
      setNotice("นำ "+blocked.map(item=>item.name).join(", ")+" ออกจากตะกร้า เพราะเมนูหมดชั่วคราวหรือสูตรไม่พร้อม · กรุณาตรวจยอดแล้วกด CHECKOUT อีกครั้ง");
      load().catch(()=>{});
      return;
    }
    const current=cartAvailability({cart:cart.items,menu:data?.menu||[],stock:data?.availabilityStock||{}});
    if(!current.available){setNotice(availabilityMessage(current));load().catch(()=>{});return}
    setResult("");
    setSplitBill(false);
    setSplitSelection({});
    setPayOpen(true);
  }

  return <section className="flex h-full min-h-0">
    <div className="flex min-w-0 flex-1 flex-col p-3 sm:p-4 md:p-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div><p className="gold m-0 text-[10px] font-bold tracking-[.3em]">POINT OF SALE</p><h1 className="m-0 mt-1 text-xl font-semibold tracking-wide md:text-2xl">FIELD DRINKS</h1></div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          {(!online||offlineStats.total>0)&&<div className={"hidden rounded-full border px-2.5 py-1.5 text-[10px] font-bold sm:block sm:text-xs "+(!online?"border-amber-300 bg-amber-50 text-amber-800":offlineStats.needsReview>0?"border-red-300 bg-red-50 text-red-700":"border-emerald-300 bg-emerald-50 text-emerald-700")}>{!online?"OFFLINE · เงินสดเท่านั้น":offlineStats.needsReview>0?"Offline ต้องตรวจ "+offlineStats.needsReview:"Offline รอ Sync "+offlineStats.pending}</div>}
          <button onClick={()=>setHeldOpen(true)} className="relative flex min-h-9 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-2.5 text-[11px] font-semibold text-slate-700 sm:px-3 sm:text-xs"><Clock3 size={14}/>พักบิล{heldBills.held.length>0&&<span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#d4af37] px-1 text-[10px] font-black text-black">{heldBills.held.length}</span>}</button>
          <div className="hidden rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] text-slate-600 sm:block sm:px-4 sm:py-2 sm:text-xs">{session.user.username}</div>
        </div>
      </div>

      {offlineStats.total>0&&<div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
        <span role="status" aria-live="polite" aria-atomic="true">บิล Offline รอส่ง {offlineStats.pending} · ต้องตรวจสอบ {offlineStats.needsReview}</span>
        <button disabled={!online||session.offline||offlineSyncing||offlineStats.pending===0} onClick={()=>syncOfflineQueue().catch(()=>{})} className="min-h-11 rounded-xl bg-[#1F4D3A] px-4 font-bold text-white disabled:opacity-45">{offlineSyncing?"กำลังส่งบิล…":"ส่งบิลที่ค้าง"}</button>
      </div>}
      {notice&&<div role="status" aria-live="polite" aria-atomic="true" className="mb-3 flex items-start justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"><span>{notice}</span><button aria-label="ปิดข้อความแจ้งเตือน" onClick={()=>setNotice("")} className="shrink-0"><X size={16}/></button></div>}
      {cashRecoveryReview&&<div className="mb-3 rounded-2xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><b>ต้องตรวจรายการเงินสดค้างก่อนรับบิลใหม่</b><p className="mt-1 text-xs">วันที่ {cashRecoveryReview.date||"—"} · ยอด ฿{formatMoney(cashRecoveryReview.total)} · รับ ฿{formatMoney(cashRecoveryReview.received)} · Request …{cashRecoveryReview.requestKey.slice(-8)}</p></div>
          <span className="rounded-full bg-red-100 px-2 py-1 text-[10px] font-bold uppercase">{cashRecoveryReview.reason}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={()=>router.push("/orders")} className="min-h-11 rounded-xl border border-red-300 bg-white px-4 text-xs font-bold">เปิด Orders เพื่อตรวจ</button>
          {session.user.role==="admin"&&<button onClick={clearReviewedCashPending} className="min-h-11 rounded-xl bg-red-700 px-4 text-xs font-bold text-white">ตรวจแล้ว · ล้าง pending ในเครื่อง</button>}
        </div>
      </div>}
      {allUnavailable&&<div className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"><b>เมนูทั้งหมดถูกพักขายชั่วคราว</b><p className="mt-1 text-xs">ต้องบันทึกยอดวัตถุดิบจริงก่อนรับออเดอร์{unavailableNames.length?" · ขาด: "+unavailableNames.join(", "):""}</p><button onClick={()=>router.push("/stock")} className="mt-3 rounded-full bg-red-700 px-4 py-2 text-xs font-bold text-white">ตั้งยอดเริ่มต้น Stock</button></div>}

      <div className="glass mb-2.5 flex items-center gap-2.5 rounded-2xl px-3 py-2.5 sm:mb-3 sm:gap-3 sm:px-4 sm:py-3"><Search size={17} className="text-slate-500"/><input value={q} onChange={e=>setQ(e.target.value)} aria-label="ค้นหาเมนู" placeholder="ค้นหาเมนู" className="w-full bg-transparent outline-none"/></div>

      <div className="soft-scroll mb-3 flex gap-1.5 overflow-x-auto sm:mb-4 sm:gap-2">{cats.map(x=><button key={x} onClick={()=>setCat(x)} className={"shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold sm:px-4 sm:py-2 sm:text-xs "+(cat===x?"border-[#c59b19] bg-[#d4af37] text-black shadow-sm":"border-slate-300 bg-white text-slate-700")}>{x}</button>)}</div>

      <div className="soft-scroll min-h-0 flex-1 overflow-auto pb-28 lg:pb-0">
        <div className="grid grid-cols-2 items-stretch gap-2 sm:gap-3 lg:grid-cols-3 2xl:grid-cols-4">{menu.map(x=><button key={x.id} disabled={!x.available} onClick={()=>setSelected(x)} className="glass group flex min-h-[154px] flex-col overflow-hidden rounded-[20px] text-left sm:min-h-[190px] sm:rounded-[24px] hover:border-[#c59b19] disabled:border-slate-200 disabled:bg-slate-100 disabled:opacity-65"><div className="relative h-20 shrink-0 bg-[#f4ecd0] sm:h-24">{x.image?<img src={x.image} alt={x.name} loading="lazy" decoding="async" fetchPriority="low" className="h-full w-full object-cover"/>:<div className="grid h-full place-items-center text-2xl font-bold text-[#765b08]">{x.name.slice(0,1)}</div>}<div className="absolute right-2 top-2">{!x.available?<span className="rounded-full bg-red-100 px-2 py-1 text-[10px] font-bold text-red-700">หมดชั่วคราว</span>:x.lowStock?<span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-800">เหลือประมาณ {x.maxServings} แก้ว</span>:null}</div></div><div className="flex flex-1 flex-col p-3 sm:p-4"><div className="text-[9px] uppercase tracking-widest text-slate-500 sm:text-[10px]">{x.category||"DRINK"}</div><b className="mt-1 block line-clamp-2 text-sm sm:text-base">{x.name}</b><div className="mt-auto pt-2 text-base font-semibold text-[#765b08] sm:pt-3 sm:text-lg">฿{formatMoney(x.price)}</div>{!x.available&&<small className="mt-2 block text-xs text-red-600">{Array.from(new Set(x.variants.flatMap(v=>v.missingIngredients||[]).map(i=>i.name))).slice(0,2).join(", ")||"สูตรยังไม่พร้อม"}</small>}</div></button>)}</div>
      </div>
    </div>

    <div className="fixed bottom-[70px] left-2 right-2 z-30 flex items-center justify-between gap-2 rounded-[18px] border border-slate-300 bg-white/95 p-1.5 pl-3 shadow-lg backdrop-blur sm:bottom-[78px] sm:left-4 sm:right-4 sm:rounded-[22px] sm:p-2 sm:pl-5 lg:hidden">
      <div className="min-w-0 flex-1"><small className="block text-[10px] tracking-widest text-slate-500">{cart.items.reduce((s,i)=>s+i.qty,0)} ITEMS</small><b className="text-lg text-[#765b08]">฿{formatMoney(cart.getTotal())}</b></div>
      <button disabled={!cart.items.length} onClick={holdCurrentBill} className="min-h-11 shrink-0 rounded-2xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 disabled:opacity-30"><Clock3 size={14} className="mx-auto mb-0.5"/>พักบิล</button>
      <button disabled={!cart.items.length} onClick={openPayment} className="min-h-11 shrink-0 rounded-2xl bg-[#d4af37] px-4 py-2.5 text-sm font-bold text-black disabled:opacity-30 sm:px-5 sm:py-3">CHECKOUT</button>
    </div>

    <aside className="glass m-3 ml-0 hidden w-[360px] shrink-0 flex-col rounded-[24px] p-5 lg:flex">
      <div className="mb-4 flex items-center justify-between"><div><p className="m-0 text-[10px] tracking-[.25em] text-slate-500">CURRENT ORDER</p><h2 className="m-0 mt-1 text-lg">CART</h2></div><span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs">{cart.items.reduce((s,i)=>s+i.qty,0)} ITEMS</span></div>
      <div className="soft-scroll min-h-0 flex-1 overflow-auto">{cart.items.length===0?<div className="grid h-full place-items-center text-sm text-slate-400">เลือกเมนูเพื่อเริ่มออเดอร์</div>:cart.items.map(i=><div key={i.key} className="mb-3 rounded-[18px] border border-slate-200 bg-slate-100/70 p-4"><div className="flex gap-3"><div className="flex-1"><b className="text-sm">{i.name}</b><small className="mt-1 block text-slate-500">{i.variant}</small></div><button onClick={()=>cart.removeItem(i.key)} className="text-slate-500 hover:text-red-600"><Trash2 size={16}/></button></div><div className="mt-3 flex items-center justify-between"><div className="flex items-center gap-2"><button onClick={()=>updateCartQuantity(i.key,i.qty-1)} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-300 bg-white"><Minus size={13}/></button><span className="w-5 text-center">{i.qty}</span><button onClick={()=>updateCartQuantity(i.key,i.qty+1)} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-300 bg-white"><Plus size={13}/></button></div><b className="text-[#765b08]">฿{formatMoney((i.price*i.qty))}</b></div></div>)}</div>
      <div className="border-t border-slate-300 pt-4"><div className="mb-2 flex justify-between text-sm text-slate-600"><span>Subtotal</span><span>฿{formatMoney(cart.getSubtotal())}</span></div><div className="mb-4 flex justify-between text-xl font-semibold"><span>Total</span><span className="text-[#765b08]">฿{formatMoney(cart.getTotal())}</span></div><div className="grid grid-cols-[auto_1fr] gap-2"><button disabled={!cart.items.length} onClick={holdCurrentBill} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 disabled:opacity-30"><Clock3 size={17}/>พักบิล</button><button disabled={!cart.items.length} onClick={openPayment} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#d4af37] px-4 font-bold text-black disabled:opacity-30"><WalletCards size={18}/>CHECKOUT / PAY</button></div></div>
    </aside>

    {heldOpen&&<div className="fixed inset-0 z-[85] grid place-items-center bg-black/55 p-3" onMouseDown={()=>setHeldOpen(false)}><div className="card soft-scroll max-h-[85dvh] w-full max-w-lg overflow-auto border border-slate-300 bg-white p-4 shadow-2xl sm:p-5" onMouseDown={e=>e.stopPropagation()}><div className="flex items-start justify-between gap-3"><div><p className="gold text-[10px] font-bold tracking-[.25em]">HOLD BILL</p><h3 className="mt-1 text-xl font-semibold">บิลที่พักไว้ · {heldBills.held.length}</h3><p className="mt-1 text-xs text-slate-500">ยังไม่สร้างยอดขาย ไม่ตัด Stock และไม่เข้าคิวจนกว่าจะชำระจริง</p></div><button onClick={()=>setHeldOpen(false)} className="grid h-9 w-9 place-items-center rounded-xl hover:bg-slate-100"><X size={18}/></button></div>{heldBills.held.length===0?<div className="mt-5 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">ยังไม่มีบิลพัก</div>:<div className="mt-4 space-y-2">{heldBills.held.map(h=>{const qty=h.items.reduce((s,i)=>s+i.qty,0),amount=h.items.reduce((s,i)=>s+i.price*i.qty,0);return <div key={h.id} className="rounded-[20px] border border-slate-200 bg-slate-50 p-3 sm:p-4"><div className="flex items-start justify-between gap-3"><div><b className="text-sm">พักเวลา {localTime(h.createdAt)}</b><p className="mt-1 text-xs text-slate-500">{qty} แก้ว · {h.items.length} เมนู · ฿{formatMoney(amount)}</p><p className="mt-1 line-clamp-2 text-[11px] text-slate-500">{h.items.map(i=>i.name+" ×"+i.qty).join(" · ")}</p></div><button onClick={()=>{if(window.confirm("ยกเลิกบิลพักนี้?"))heldBills.removeHeld(h.id)}} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="ลบบิลพัก"><Trash2 size={15}/></button></div><button onClick={()=>resumeHeldBill(h.id)} className="mt-3 min-h-11 w-full rounded-2xl bg-[#d4af37] px-4 text-sm font-bold text-black">เรียกบิลนี้กลับ</button></div>})}</div>}</div></div>}

    {selected&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-3 sm:p-4" onMouseDown={()=>setSelected(null)}><div className="card w-full max-w-md border border-slate-300 bg-white p-4 shadow-2xl sm:p-6" onMouseDown={e=>e.stopPropagation()}><div className="flex items-start justify-between"><div><p className="gold text-[10px] tracking-[.25em]">{selected.category||"DRINK"}</p><h3 className="mt-1 text-lg sm:text-xl">{selected.name}</h3></div><button onClick={()=>setSelected(null)}><X/></button></div><p className="mt-5 text-xs uppercase tracking-widest text-slate-500">Choose variant</p><div className="mt-3 grid gap-2">{selected.variants.map(v=>{const remaining=additionalServingsAvailable({cart:cart.items,menu:data?.menu||[],stock:data?.availabilityStock||{},menuId:selected.id,variantLabel:v.label});const canAdd=!!v.available&&remaining>0;return <button key={v.label} disabled={!canAdd} onClick={()=>addVariant(selected,v)} className="min-h-11 rounded-2xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-left hover:border-[#c59b19] sm:px-4 sm:py-3 disabled:bg-slate-100 disabled:text-slate-400"><span>{v.label||"Standard"}{!v.available&&<small className="ml-2 text-red-600">หมดชั่วคราว</small>}{v.available&&remaining>0&&<small className="ml-2 text-amber-700">เพิ่มได้อีกประมาณ {remaining} แก้ว</small>}{v.available&&remaining<1&&<small className="ml-2 text-red-600">เพิ่มไม่ได้ · ตะกร้าใช้สต๊อกที่เหลือแล้ว</small>}</span><span className="float-right font-semibold text-[#765b08]">฿{formatMoney(selected.price)}</span>{!v.available&&v.missingIngredients?.length>0&&<small className="mt-1 block text-xs text-red-500">ขาด: {v.missingIngredients.map(i=>i.name).join(", ")}</small>}{v.available&&remaining<1&&<small className="mt-1 block text-xs text-slate-500">ลดจำนวนรายการในตะกร้า หรืออัปเดต Stock ก่อนเพิ่มเมนูนี้</small>}</button>})}</div></div></div>}

    {payOpen&&<div className="fixed inset-0 z-[90] grid place-items-center bg-black/55 p-2 sm:p-4"><div className="field-payment-sheet soft-scroll card w-full max-w-md overflow-auto border border-slate-300 bg-white p-4 shadow-2xl sm:max-h-[94vh] sm:p-6"><div className="flex justify-between gap-3"><div><p className="gold text-[10px] tracking-[.25em]">PAYMENT</p><h3 className="mt-1 text-2xl font-semibold">ยอดชำระ ฿{formatMoney(netPayable)}</h3><p className="mt-1 text-xs text-slate-500">{splitBill?"บิลนี้ "+payableQty+" แก้ว · เหลือ "+remainingAfterBill+" แก้ว":payableQty+" แก้ว · "+cart.items.length+" เมนู"}</p></div><button disabled={busy} onClick={()=>setPayOpen(false)} className="disabled:cursor-not-allowed disabled:opacity-30"><X/></button></div>

      <button type="button" disabled={busy||!online||method==="delivery"||cart.items.reduce((s,i)=>s+i.qty,0)<2} onClick={()=>{setSplitBill(v=>!v);setSplitSelection({});setPointsRedeemed(0);setReceived("");setResult("")}} className={"mt-4 min-h-11 w-full rounded-2xl border px-4 text-sm font-semibold "+(splitBill?"border-[#d4af37] bg-[#fff8dc] text-[#765b08]":"border-slate-300 bg-white text-slate-700")+" disabled:opacity-40"}>{splitBill?"ยกเลิกแยกบิล":"แยกบิล / จ่ายแยกตามคน"}</button>
      {splitBill&&<div className="mt-2 rounded-2xl border border-[#d4af37]/40 bg-[#fffaf0] px-3 py-2 text-xs text-slate-700">เลือกจำนวนแก้วของ <b>คนที่กำลังจ่าย</b> · หลังชำระ รายการที่เหลือยังอยู่ในตะกร้าเพื่อรับเงินคนถัดไป</div>}
      {splitGroup&&<div className="mt-2 rounded-2xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><b>กลุ่มเดียวกัน · คิว {splitGroup.queueNo}</b> · การจ่ายคนถัดไปจะใช้คิวและบัตรเรียกเดิมอัตโนมัติ</div>}

      <div className="mt-3 rounded-[20px] border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center justify-between gap-3"><div><b className="text-sm">{splitBill?"เลือกสำหรับบิลนี้":"รายการที่สั่ง"}</b><p className="mt-0.5 text-[11px] text-slate-500">{splitBill?"เลือกได้แม้เมนูเดียวกันมีหลายแก้ว":"ทวนเมนู ราคา และระดับหวานก่อนรับเงิน"}</p></div><b className="shrink-0 text-lg text-[#765b08]">฿{formatMoney(payableTotal)}</b></div>
        <div className="soft-scroll mt-3 max-h-[230px] space-y-2 overflow-auto pr-1">
          {cart.items.map(i=>{const selectedQty=splitBill?Math.min(i.qty,Math.max(0,Number(splitSelection[i.key])||0)):i.qty;return <div key={i.key} className={"rounded-2xl border bg-white p-3 "+(splitBill&&selectedQty>0?"border-[#d4af37]":"border-slate-200")}>
            <div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1"><b className="block text-sm">{i.name}</b><span className="mt-1 inline-block rounded-full bg-[#f4ecd0] px-2 py-1 text-[10px] font-semibold text-[#765b08]">{orderOptionLabel(i.variant)}</span></div>{!splitBill&&<button disabled={busy} onClick={()=>cart.removeItem(i.key)} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30" aria-label={"ลบ "+i.name}><Trash2 size={15}/></button>}</div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">{splitBill?<div className="flex items-center gap-2"><button disabled={busy||selectedQty<=0} onClick={()=>setSplitSelection(s=>({...s,[i.key]:Math.max(0,selectedQty-1)}))} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-300 bg-white disabled:opacity-30"><Minus size={13}/></button><span className="min-w-[68px] text-center text-xs font-semibold">บิลนี้ {selectedQty}/{i.qty}</span><button disabled={busy||selectedQty>=i.qty} onClick={()=>setSplitSelection(s=>({...s,[i.key]:Math.min(i.qty,selectedQty+1)}))} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-300 bg-white disabled:opacity-30"><Plus size={13}/></button></div>:<div className="flex items-center gap-2"><button disabled={busy} onClick={()=>updateCartQuantity(i.key,i.qty-1)} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-300 bg-white disabled:opacity-30"><Minus size={13}/></button><span className="min-w-6 text-center text-sm font-semibold">{i.qty}</span><button disabled={busy} onClick={()=>updateCartQuantity(i.key,i.qty+1)} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-300 bg-white disabled:opacity-30"><Plus size={13}/></button></div>}<div className="text-right"><small className="block text-[10px] text-slate-500">{selectedQty} × ฿{formatMoney(i.price)}</small><b className="text-sm text-[#765b08]">฿{formatMoney((selectedQty*i.price))}</b></div></div>
          </div>})}
        </div>
        <div className="mt-3 border-t border-slate-200 pt-3">{crmDiscount>0&&<div className="mb-1 flex items-center justify-between text-xs text-slate-500"><span>ยอดก่อนส่วนลด</span><span>฿{formatMoney(payableTotal)}</span></div>}{crmDiscount>0&&<div className="mb-1 flex items-center justify-between text-xs text-amber-700"><span>ส่วนลดสมาชิก</span><span>−฿{formatMoney(crmDiscount)}</span></div>}<div className="flex items-center justify-between"><span className="text-sm font-semibold">{splitBill?"บิลนี้":"รวม"} {payableQty} แก้ว</span><b className="text-xl text-[#765b08]">฿{formatMoney(netPayable)}</b></div></div>
      </div>

      {!online&&<div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"><b>Offline Mode</b> · รับเงินสดได้ตามปกติ บิลจะเก็บในเครื่องและ Sync อัตโนมัติเมื่อเน็ตกลับ · QR / แยกบิล / แต้มถูกปิดชั่วคราว</div>}
      <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-slate-100 p-1"><button onClick={()=>{setMethod("cash");setManualPaymentReference("")}} className={"rounded-xl p-3 text-xs sm:text-sm "+(method==="cash"?"bg-[#d4af37] font-semibold text-black shadow-sm":"text-slate-700")}>Cash</button><button disabled={!online||promptConfig?.ready!==true||netPayable<=0} onClick={()=>{setMethod("promptpay");setManualPaymentReference("")}} title={!online?"PromptPay ต้องใช้อินเทอร์เน็ต":promptConfig?.ready===true?"PromptPay พร้อมใช้งาน":"รอ Beam อนุมัติ / ตั้งค่า API และ Webhook"} className={"rounded-xl p-3 text-xs sm:text-sm disabled:cursor-not-allowed disabled:opacity-45 "+(method==="promptpay"?"bg-[#d4af37] font-semibold text-black shadow-sm":"text-slate-700")}>PromptPay{promptConfig?.selectedProvider==="beam"&&promptConfig?.mode==="test"?" · TEST":""}</button><button disabled={!online} onClick={()=>{setMethod("bank");setReceived("")}} className={"rounded-xl p-3 text-xs sm:text-sm disabled:opacity-45 "+(method==="bank"?"bg-[#d4af37] font-semibold text-black shadow-sm":"text-slate-700")}>โอนธนาคาร</button><button disabled={!online} onClick={()=>{setMethod("card");setReceived("")}} className={"rounded-xl p-3 text-xs sm:text-sm disabled:opacity-45 "+(method==="card"?"bg-[#d4af37] font-semibold text-black shadow-sm":"text-slate-700")}>บัตร</button><button disabled={!online} onClick={()=>{setMethod("delivery");setSplitBill(false);setSplitSelection({});setReceived("");setManualPaymentReference("")}} className={"rounded-xl p-3 text-xs sm:text-sm disabled:opacity-45 "+(method==="delivery"?"bg-[#d4af37] font-semibold text-black shadow-sm":"text-slate-700")}>Delivery</button></div>
      {online&&promptConfig?.ready!==true&&<div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">PromptPay ยังไม่เปิดรับเงินจริง · ระบบกำลังรอ Beam Merchant/API/Webhook ให้พร้อม</div>}
      {["bank","card"].includes(method)&&<div className="mt-3 rounded-[20px] border border-slate-200 bg-slate-50 p-3"><label className="text-xs font-semibold text-slate-700">{method==="bank"?"เลขอ้างอิงโอน / หมายเหตุ":"เลขอ้างอิงบัตร / Terminal"}</label><input value={manualPaymentReference} onChange={e=>setManualPaymentReference(e.target.value)} placeholder={method==="bank"?"เช่น เลขท้ายรายการโอน (ใส่ได้ถ้ามี)":"เช่น Slip/Terminal ref (ใส่ได้ถ้ามี)"} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3"/><p className="mt-2 text-[11px] text-slate-500">ระบบบันทึกเป็นช่องทางรับเงินแยกสำหรับรายงานและ Export บัญชี · ไม่กระทบเงินสดในลิ้นชัก</p></div>}
      {method==="delivery"&&<div className="mt-3 rounded-[20px] border border-slate-200 bg-slate-50 p-3"><label className="text-xs font-semibold text-slate-700">แพลตฟอร์ม Delivery</label><select value={deliveryPlatform} onChange={e=>setDeliveryPlatform(e.target.value as any)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3"><option value="grab">Grab</option><option value="lineman">LINE MAN</option><option value="other_delivery">Delivery อื่น</option></select><div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-xl bg-white p-2"><span className="text-slate-500">ยอดขาย</span><b className="mt-1 block">฿{formatMoney(netPayable)}</b></div><div className="rounded-xl bg-white p-2"><span className="text-slate-500">GP {(deliveryGpRate*100).toFixed(1)}%</span><b className="mt-1 block text-red-600">−฿{formatMoney(deliveryGpFee)}</b></div><div className="rounded-xl bg-white p-2"><span className="text-slate-500">รับสุทธิ</span><b className="mt-1 block text-emerald-700">฿{formatMoney(deliveryNetSettlement)}</b></div></div><p className="mt-2 text-[11px] text-slate-500">ยอดขายยังบันทึกเต็มจำนวน ส่วน GP แยกเป็นค่าธรรมเนียมเพื่อให้รายงานกระแสเงินสดตรงกับเงินที่จะได้รับจริง</p></div>}
      {customers.length>0&&<select disabled={!online} value={customerId} onChange={e=>{setCustomerId(e.target.value);setPointsRedeemed(0);setReceived("")}} className="mt-4 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 disabled:bg-slate-100 disabled:text-slate-400"><option value="">ลูกค้าทั่วไป / ไม่สะสมแต้ม</option>{customers.map(x=><option key={x.id} value={x.id}>{x.name} · {x.points||0} pts</option>)}</select>}
      {selectedCustomer&&redeemValue>0&&<div className="mt-3 rounded-2xl border border-[#d4af37]/40 bg-[#fffaf0] p-3"><div className="flex items-center justify-between text-sm"><span><b>{selectedCustomer.name}</b> · มี {Number(selectedCustomer.points)||0} แต้ม</span><span className="text-xs text-slate-500">1 แต้ม = ฿{formatMoney(redeemValue)}</span></div><div className="mt-2 grid grid-cols-[1fr_auto] gap-2"><input type="number" inputMode="numeric" min="0" max={maxRedeemPoints} step="1" value={pointsRedeemed} onChange={e=>{setPointsRedeemed(Math.max(0,Math.min(maxRedeemPoints,Math.trunc(Number(e.target.value)||0))));setReceived("")}} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3" placeholder="แต้มที่ใช้"/><button type="button" disabled={maxRedeemPoints<1} onClick={()=>{setPointsRedeemed(maxRedeemPoints);setReceived("")}} className="rounded-xl border border-[#d4af37] px-3 text-xs font-bold text-[#765b08] disabled:opacity-40">ใช้ได้สูงสุด {maxRedeemPoints}</button></div>{redeemPoints>0&&<div className="mt-3 space-y-1 border-t border-amber-200 pt-2 text-sm"><div className="flex justify-between"><span>ยอดก่อนส่วนลด</span><b>฿{formatMoney(payableTotal)}</b></div><div className="flex justify-between text-amber-800"><span>ใช้ {redeemPoints} แต้ม</span><b>−฿{formatMoney(crmDiscount)}</b></div><div className="flex justify-between text-base"><b>ยอดสุทธิ</b><b className="text-[#765b08]">฿{formatMoney(netPayable)}</b></div><p className="text-[11px] text-slate-500">บิลนี้คาดว่าจะได้ +{estimatedPointsAwarded} แต้ม จากยอดจ่ายจริง</p></div>}</div>}
      {method==="cash"&&<><div className="mt-4 grid grid-cols-[1fr_auto] gap-2"><input autoFocus inputMode="decimal" value={received} onChange={e=>setReceived(e.target.value)} placeholder="จำนวนเงินที่รับ" className="min-w-0 rounded-2xl border border-slate-300 bg-slate-100 px-4 py-3 text-lg outline-none focus:border-[#c59b19]"/><button type="button" disabled={busy||!payableItems.length} onClick={()=>setReceived(String(netPayable))} className="min-h-12 rounded-2xl border border-[#d4af37] bg-[#fff8dc] px-3 text-sm font-bold text-[#765b08] disabled:opacity-40">รับพอดี ฿{formatMoney(netPayable)}</button></div><div className="mt-2 grid grid-cols-3 gap-2">{[100,500,1000].map(amount=><button key={amount} type="button" disabled={busy||!payableItems.length} onClick={()=>setReceived(String(amount))} className={"min-h-11 rounded-xl border px-2 text-sm font-bold disabled:opacity-40 "+(cashReceived===amount?"border-[#d4af37] bg-[#fff8dc] text-[#765b08]":"border-slate-300 bg-white text-slate-700")}>฿{formatMoney(amount)}</button>)}</div>{received.trim()!==""&&Number.isFinite(cashDelta)&&<div className={"mt-3 flex items-center justify-between rounded-2xl border px-4 py-3 "+(cashDelta>=0?"border-emerald-300 bg-emerald-50 text-emerald-900":"border-red-300 bg-red-50 text-red-800")}><span>{cashDelta>=0?"เงินทอน":"ขาดอีก"}</span><b className="text-xl">฿{formatMoney(Math.abs(cashDelta))}</b></div>}</>}
      {method==="promptpay"&&prompt?.qrUrl&&<div className="mt-4 rounded-[20px] border border-slate-300 bg-white p-4 text-center"><img src={prompt.qrUrl} alt="PromptPay QR" className="mx-auto max-h-56 w-auto"/><p className="mt-2 text-xs font-semibold text-black">{prompt.paid?"ชำระเงินแล้ว":"สแกน QR แล้วระบบจะตรวจสอบอัตโนมัติ"}</p></div>}
      <div className="sticky bottom-0 z-10 -mx-4 mt-4 border-t border-slate-200 bg-white/95 px-4 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:-mx-6 sm:px-6">
        <button disabled={busy||!payableItems.length||(method==="cash"&&(!Number.isFinite(cashReceived)||cashReceived<netPayable))} onClick={checkout} className="w-full rounded-2xl bg-[#d4af37] py-3.5 font-bold text-black shadow-sm disabled:opacity-40">{busy?(method==="promptpay"&&prompt?"WAITING FOR PAYMENT...":"กำลังบันทึกบิล..."):(method==="promptpay"?"CREATE QR / PAY":method==="delivery"?"CONFIRM DELIVERY ORDER":method==="bank"?"ยืนยันรับโอน":method==="card"?"ยืนยันรับบัตร":!online?"SAVE OFFLINE CASH":"CONFIRM PAYMENT")}</button>
        {method==="cash"&&Number.isFinite(cashReceived)&&cashReceived===netPayable&&<p className="mt-2 text-center text-xs font-semibold text-emerald-700">รับเงินพอดียอด · กดยืนยันชำระได้เลย</p>}
        {result&&<p className="mt-2 rounded-xl bg-slate-100 px-3 py-2 text-center text-sm text-slate-700">{result}</p>}
      </div>
    </div></div>}

    {lastSale&&<div className={"fixed bottom-[92px] right-4 z-[70] w-[min(460px,calc(100vw-2rem))] rounded-[26px] border bg-white p-5 shadow-2xl md:bottom-6 md:right-6 "+(lastSale.offline?"border-amber-300":"border-emerald-300")}><div className="flex items-start gap-3"><div className={"grid h-10 w-10 shrink-0 place-items-center rounded-full "+(lastSale.offline?"bg-amber-100 text-amber-700":"bg-emerald-100 text-emerald-700")}><CheckCircle2 size={22}/></div><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div><b className="text-lg">{lastSale.offline?"บันทึกเงินสด Offline แล้ว":"ชำระเงินสำเร็จ"}</b><p className="mt-1 text-sm text-slate-600">{lastSale.offline?"เลขชั่วคราว "+lastSale.queueNo+" · รอ Sync Cloud":"คิว "+lastSale.queueNo+(lastSale.recovered?" · กู้คืนรายการเดิม":"")}</p></div><button onClick={()=>setLastSale(null)}><X size={18}/></button></div>{lastSale.offline?<div className="mt-3 rounded-[20px] border-2 border-amber-300 bg-amber-50 p-4 text-center"><div className="text-xs font-bold tracking-[.12em] text-amber-800">OFFLINE ORDER</div><div className="mt-1 text-3xl font-black leading-none text-amber-900">{lastSale.queueNo}</div><p className="mt-2 text-xs text-amber-800">ทำและส่งมอบออเดอร์นี้ตามลำดับที่รับ · เมื่อเน็ตกลับระบบจะลงบัญชี/Stock โดยไม่สร้างคิวผลิตซ้ำ</p></div>:<div className="mt-3 rounded-[20px] border-2 border-[#d4af37] bg-[#fff8dc] p-4 text-center"><div className="text-xs font-bold tracking-[.18em] text-[#765b08]">หยิบบัตรให้ลูกค้า</div><div className="mt-1 text-4xl font-black leading-none text-[#6f5510] md:text-5xl">บัตร {lastSale.pager||"—"}</div></div>}{lastSale.payment==="cash"&&<div className="mt-3 flex items-center justify-between rounded-2xl bg-emerald-50 p-3"><span className="text-sm font-semibold text-emerald-800">เงินทอน</span><div className="text-2xl font-bold text-emerald-800">฿{formatMoney(lastSale.change)}</div></div>}<div className={"mt-3 grid gap-2 "+(lastSale.offline?"grid-cols-1":"grid-cols-2")}><button onClick={startNextOrder} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#d4af37] px-3 text-sm font-bold text-black"><Plus size={16}/>รับออเดอร์ถัดไป</button>{!lastSale.offline&&<button onClick={()=>router.push("/queue")} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700">ไปทำคิว {lastSale.queueNo} <ArrowRight size={15}/></button>}</div><p className="mt-2 text-center text-[11px] text-slate-500">{lastSale.offline?"ยอดถูกเก็บในเครื่องแล้ว ห้ามล้างข้อมูล Browser จนกว่าจะ Sync สำเร็จ":"รับออเดอร์ถัดไปได้ทันทีโดยไม่ออกจากหน้า POS"}</p></div></div></div>}
  </section>;
}
