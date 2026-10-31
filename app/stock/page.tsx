"use client";
import {Suspense,useEffect,useMemo,useRef,useState} from "react";
import {useRouter,useSearchParams} from "next/navigation";
import {AlertTriangle,Archive,ArrowDownCircle,ArrowUpCircle,Edit3,Plus,RotateCcw,Search,Trash2,X} from "lucide-react";
import AuthGate from "@/components/auth-gate";
import ModalFocus from "@/components/modal-focus";
import {api,type Session} from "@/lib/api-client";
import {purchaseCostLabel,previewReceived,defaultPackSizeUnit,countedQuantity} from "@/lib/stock-entry-guidance.mjs";
import {prepareStockWriteIntent,readStockWriteIntent,sendStockWriteIntent,type StockWriteIntent,type StockWriteOperation} from "@/lib/stock-write-recovery";

type Purchase={
  id:string;stockTransactionId:string;supplier:string;purchaseDate:string;packageQty:number|null;packageUnit:string;packSize:number|null;packSizeUnit:string;
  quantityReceived:number;usageUnit:string;totalCost:number;unitCost:number;sourceUrl:string;imageUrl:string;note:string;createdAt:number;conversionApproximate:boolean;paymentMethod?:string;
  cancelled:boolean;cancelledAt:number|null;cancelReason:string;
};
type PurchaseProfile={packageUnit:string;packSize:number;packSizeUnit:string;quantityPerPackage:number;usageUnit:string;conversionApproximate?:boolean;supplier?:string;sourceUrl?:string;imageUrl?:string;purchaseCost?:number|null;purchaseDate?:string;note?:string;paymentMethod?:string;updatedAt?:number};
type Ingredient={id:string;name:string;qty:number;unit:string;safetyStock:number;unitCost:number;costStatus:string;costKind:string;wasteMargin:number;lowStock:boolean;archived:boolean;archivedAt?:number|null;historyResetAt?:number;purchaseProfile?:PurchaseProfile|null;recentPurchases:Purchase[]};
type Tx={id:string;ingredientId:string;type:string;qtyDelta:number;unit:string;reason:string;createdAt:number};
type Overview={revision:number;ingredients:Ingredient[];transactions:Tx[];openingInventory?:{revision:number;items:Array<{id:string;name:string;qty:number;unit:string;capturedAt:number|null;costStatus:string}>};attention?:{blockedMenus:number;ingredients:Array<{id:string;menuNames:string[]}>;missingReferences:number}};
type CountInput={packs:string;loose:string;base:string};
type CountAdjustment={ingredientId:string;name:string;expectedQty:number;countedQty:number;variance:number;unit:string};
type CountProposal={id:string;date:string;status:string;submittedAt:number;submittedBy:string;adjustments:CountAdjustment[];rejectReason?:string};
type MasterDraft=Partial<Ingredient>&{originalUnit?:string;loadedAt?:number};

const today=()=>new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Bangkok"});
const packageUnits=["ขวด","ถุง","ถัง","แกลลอน","กล่อง","แพ็ก","ลัง","ชิ้น"];
const usageUnits=[["g","กรัม (g)"],["ml","มิลลิลิตร (ml)"],["piece","ชิ้น"],["set","ชุด"],["serve","เสิร์ฟ"]];
const usageUnitLabel=(unit?:string)=>usageUnits.find(([value])=>value===unit)?.[1]||String(unit||"—");

export default function Stock(){return <AuthGate>{s=><Suspense fallback={<p className="p-5">กำลังเปิดสต็อก…</p>}><StockView session={s}/></Suspense>}</AuthGate>}

function compactMoney(v:number){return Number(v||0).toLocaleString("th-TH",{minimumFractionDigits:0,maximumFractionDigits:2})}
function latestPurchase(x:Ingredient){return x.recentPurchases?.find(p=>!p.cancelled)||null}

function StockView({session}:{session:Session}){
  const admin=session.user.role==="admin";
  const [data,setData]=useState<Overview|null>(null),[q,setQ]=useState(""),[tab,setTab]=useState<"active"|"archived">("active"),[msg,setMsg]=useState(""),[busy,setBusy]=useState(false);
  const [txOpen,setTxOpen]=useState<Ingredient|null>(null),[type,setType]=useState<"PURCHASE"|"WASTE">("PURCHASE"),[wasteQty,setWasteQty]=useState("");
  const [purchaseCost,setPurchaseCost]=useState(""),[purchaseDate,setPurchaseDate]=useState(today()),[supplier,setSupplier]=useState(""),[sourceUrl,setSourceUrl]=useState(""),[imageUrl,setImageUrl]=useState(""),[note,setNote]=useState(""),[purchasePaymentMethod,setPurchasePaymentMethod]=useState("bank");
  const [packageQty,setPackageQty]=useState("1"),[packageUnit,setPackageUnit]=useState("ขวด"),[packSize,setPackSize]=useState(""),[packSizeUnit,setPackSizeUnit]=useState("g"),[presetId,setPresetId]=useState("");
  const [master,setMaster]=useState<MasterDraft|null>(null),[masterMsg,setMasterMsg]=useState(""),[purchaseEdit,setPurchaseEdit]=useState<{ingredient:Ingredient;purchase:Purchase}|null>(null);
  const [countOpen,setCountOpen]=useState(false),[counts,setCounts]=useState<Record<string,CountInput>>({}),[countProposals,setCountProposals]=useState<CountProposal[]>([]);
  const [ingredientReview,setIngredientReview]=useState<null|{ingredient:Ingredient;action:"archive"|"reset"}>(null);
  const [countReview,setCountReview]=useState<null|{proposal:CountProposal;approve:boolean;reason:string}>(null);
  const [pendingStockIntent,setPendingStockIntent]=useState<StockWriteIntent|null>(null),[stockRecoveryBlocked,setStockRecoveryBlocked]=useState(false);
  const stockRecoveryRef=useRef(false);

  const router=useRouter(),params=useSearchParams(),attentionOnly=params.get("attention")==="shortage";
  const [loadError,setLoadError]=useState(false),[refreshing,setRefreshing]=useState(false);
  useEffect(()=>{if(attentionOnly){setTab("active");setQ("")}},[attentionOnly]);
  const load=async()=>{
    setRefreshing(true);
    try{const [overview,proposalData]=await Promise.all([api<Overview>("/api/stock/overview"),api<{proposals:CountProposal[]}>("/api/stock/cycle-count/proposals")]);setData(overview);setCountProposals(proposalData.proposals||[]);setLoadError(false)}
    catch(error){setLoadError(true);throw error}
    finally{setRefreshing(false)}
  };

  function stockError(code:string){
    const map:Record<string,string>={
      stock_recovery_unavailable:"อ่าน/บันทึก recovery ของ Stock ไม่ได้ · ระบบล็อกการปรับ Stock ใหม่เพื่อป้องกันยอดซ้ำ",
      pending_stock_write_exists:"มีรายการ Stock เดิมที่ยังไม่ทราบผล · ระบบจะตรวจ Request เดิมก่อน ห้ามสร้างรายการใหม่",
      stock_ack_unknown:"Server ยังไม่ยืนยันผลรายการ Stock เดิมอย่างครบถ้วน · ระบบเก็บ Request เดิมไว้และจะตรวจซ้ำ",
      network_unavailable:"ยังไม่ทราบว่า Server บันทึก Stock แล้วหรือไม่ · ระบบเก็บ Request เดิมไว้ ห้ามทำรายการใหม่แทน",
      idempotency_conflict:"Request เดิมไม่ตรงกับผู้ใช้หรือข้อมูลเดิม · หยุดรายการนี้และตรวจ Audit/Stock ก่อนดำเนินการต่อ",
      request_key_conflict:"Request เดิมถูกผูกกับผู้ใช้หรือข้อมูลชุดอื่น · หยุดรายการนี้และตรวจผลเดิมก่อน",
      invalid_purchase_url:"ลิงก์ไม่ถูกต้อง · ใส่ได้ทั้ง https://... หรือโดเมน เช่น shopee.co.th/...",
      future_purchase_date:"วันที่ซื้อห้ามเป็นอนาคต",
      purchase_date_closed:"วันที่ซื้อถูก Close Day แล้ว",
      stock_shortage:"จำนวนคงเหลือไม่พอ · ระบบยังไม่ได้บันทึกรายการใหม่นี้",
      unsupported_stock_unit:"หน่วยสต็อกยังไม่รองรับ · ให้ผู้ดูแลตรวจหน่วยของรายการ",
      incompatible_stock_unit:"หน่วยต่อบรรจุภัณฑ์ไม่เข้ากับหน่วยที่สูตรใช้",
      invalid_purchase_payment_method:"ช่องทางชำระค่าซื้อไม่ถูกต้อง",
      purchase_not_found:"ไม่พบรายการรับเข้าต้นทาง · ระบบยังไม่ได้แก้ Stock/ต้นทุนจาก Request นี้",
      purchase_already_cancelled:"รายการรับเข้านี้ถูกยกเลิกไปแล้ว · กรุณาตรวจประวัติก่อนทำต่อ",
      purchase_before_reset_read_only:"รายการนี้อยู่ก่อนจุดล้างข้อมูลทดลอง จึงแก้ย้อนหลังไม่ได้",
      purchase_has_fifo_consumption:"รายการรับเข้านี้มีการจองหรือใช้ผลิตแล้ว จึงแก้ต้นทุนเดิมไม่ได้ กรุณาตรวจประวัติและใช้รายการปรับปรุงแยกต่างหาก",
      invalid_cycle_count:"กรอกจำนวนจริงให้ครบและไม่ติดลบ · ถ้าไม่มีของให้ใส่ 0",
      invalid_purchase_date:"วันที่ซื้อไม่ถูกต้อง · กรุณาตรวจวันที่แล้วส่งใหม่",
      invalid_purchase_cost:"ราคาซื้อไม่ถูกต้อง · กรุณาตรวจยอดรวม",
      incomplete_purchase_packaging:"ข้อมูลจำนวนแพ็ก/ขนาดต่อแพ็กไม่ครบ · ยังไม่ได้แก้ Stock",
      purchase_correction_stock_negative:"แก้จำนวนรับเข้าไม่ได้ เพราะจะทำให้ Stock ติดลบ · กรุณาตรวจนับ Stock จริงก่อน",
      purchase_cancel_stock_negative:"ยกเลิกรับเข้าไม่ได้ เพราะวัตถุดิบถูกใช้ไปแล้วหรือยอดคงเหลือไม่พอ · กรุณาตรวจนับ Stock จริง",
      purchase_cancel_has_later_movement:"ยกเลิกย้อนหลังอัตโนมัติไม่ได้ เพราะมีการขาย/ของเสีย/นับหรือปรับ Stock หลังรายการนี้ · เพื่อไม่ให้ Stock เพี้ยน กรุณาใช้การตรวจนับ Stock จริงหรือปรับยอดแทน",
      purchase_stock_transaction_missing:"ไม่พบ Stock Ledger ต้นทาง · ระบบหยุดการยกเลิกเพื่อป้องกัน Stock เพี้ยน",
      purchase_cancel_confirmation_required:"การยืนยันยกเลิกรับเข้าไม่ถูกต้อง · ยังไม่มีการเปลี่ยน Stock",
      purchase_cancel_reason_required:"กรุณาระบุเหตุผลยกเลิกรับเข้าเพื่อเก็บ Audit",
      invalid_purchase_quantity:"ข้อมูลจำนวนรับเข้าต้นทางไม่ถูกต้อง · ระบบหยุดการยกเลิกเพื่อป้องกัน Stock เพี้ยน",
      cycle_count_requires_confirmation:"ต้องยืนยันผลนับก่อนปรับ Stock",
      day_closed:"วันนี้ปิดยอดแล้ว · ไม่สามารถปรับ Stock ย้อนหลังใน flow นี้",
      cycle_count_approval_confirmation_required:"ต้องยืนยันการอนุมัติผลนับก่อนปรับ Stock",
      cycle_count_reject_reason_required:"กรุณาระบุเหตุผลที่ตีกลับผลนับ",
      cycle_count_proposal_not_found:"ไม่พบผลนับที่ต้องการตรวจ · ระบบยังไม่ได้ปรับ Stock จาก Request นี้",
      cycle_count_proposal_id_mismatch:"รหัสผลนับใน Request ไม่ตรงกับรายการที่เปิดอยู่ · ระบบยังไม่เปลี่ยน Stock",
      cycle_count_proposal_not_pending:"ผลนับนี้ถูกตรวจไปแล้ว · ระบบจะตรวจ Request เดิมก่อน ห้ามกดซ้ำด้วย Request ใหม่",
      cycle_count_proposal_day_closed:"วันที่ของผลนับถูก Close Day แล้ว · ไม่อนุญาตให้ปรับ Stock ย้อนหลัง",
      cycle_count_proposal_expired:"ผลนับหมดอายุ · Server บันทึกสถานะหมดอายุแล้ว ระบบเก็บ Request เดิมไว้เพื่อยืนยัน ACK เดิม",
      cycle_count_proposal_stale:"Stock เปลี่ยนหลังพนักงานนับ · Server บันทึกผลนี้เป็นหมดอายุจากข้อมูลเปลี่ยนแล้ว ระบบเก็บ Request เดิมไว้เพื่อยืนยัน ACK เดิม",
      invalid_ingredient:"ข้อมูล Stock Master ไม่ถูกต้อง · ตรวจชื่อ หน่วย และ Safety Stock",
      invalid_cost_kind:"ประเภทต้นทุนไม่ถูกต้อง · กรุณาเลือกจากรายการที่ระบบรองรับ",
      invalid_waste_margin:"Waste margin ต้องอยู่ระหว่าง 0% ถึง 50%"
    };
    return map[code]||code;
  }

  function stockRequest(operation:StockWriteOperation,body:any){
    if(operation==="ingredientCreate")return {path:"/api/stock/ingredients",method:"POST"};
    if(operation==="stockTransaction")return {path:"/api/stock/transactions",method:"POST"};
    if(operation==="cycleCountCommit")return {path:"/api/stock/cycle-count",method:"POST"};
    if(operation==="cycleCountProposal")return {path:"/api/stock/cycle-count/proposals",method:"POST"};
    if(operation==="purchaseEdit")return {path:"/api/stock/purchases/"+encodeURIComponent(String(body?.purchaseId||"")),method:"PATCH"};
    if(operation==="purchaseCancel")return {path:"/api/stock/purchases/"+encodeURIComponent(String(body?.purchaseId||""))+"/cancel",method:"POST"};
    const proposalId=encodeURIComponent(String(body?.proposalId||""));
    return {path:"/api/stock/cycle-count/proposals/"+proposalId+(operation==="cycleCountProposalApprove"?"/approve":"/reject"),method:"POST"};
  }
  function exactStockAck(result:any,body:any,intent:StockWriteIntent){
    if(intent.operation==="ingredientCreate"){
      const ingredient=result?.ingredient;
      const expectedWasteMargin=["syrup","concentrate"].includes(String(body.costKind||""))?Number(body.wasteMargin||0):0;
      return result?.ok===true&&result?.requestKey===body.requestKey&&result?.performedBy===intent.actorId&&typeof ingredient?.id==="string"&&ingredient.id.length>0&&ingredient?.name===body.name&&ingredient?.unit===body.unit&&Number(ingredient?.safetyStock)===Number(body.safetyStock)&&ingredient?.costKind===body.costKind&&Number(ingredient?.wasteMargin)===expectedWasteMargin;
    }
    if(intent.operation==="stockTransaction"){
      const tx=result?.transaction;
      return result?.ok===true&&tx?.requestKey===body.requestKey&&tx?.createdBy===intent.actorId&&tx?.ingredientId===body.ingredientId&&tx?.type===body.type;
    }
    if(intent.operation==="cycleCountCommit")return result?.ok===true&&result?.requestKey===body.requestKey&&result?.cycleCount?.createdBy===intent.actorId;
    if(intent.operation==="cycleCountProposal")return result?.ok===true&&result?.requestKey===body.requestKey&&result?.proposal?.requestKey===body.requestKey&&result?.proposal?.submittedBy===intent.actorId;
    if(intent.operation==="purchaseEdit")return result?.ok===true&&result?.requestKey===body.requestKey&&result?.performedBy===intent.actorId&&result?.id===body.purchaseId&&Number.isFinite(Number(result?.quantityReceived));
    if(intent.operation==="purchaseCancel")return result?.ok===true&&result?.requestKey===body.requestKey&&result?.performedBy===intent.actorId&&result?.id===body.purchaseId&&typeof result?.reversalId==="string"&&result.reversalId.length>0;
    if(intent.operation==="cycleCountProposalApprove")return result?.requestKey===body.requestKey&&result?.performedBy===intent.actorId&&result?.proposalId===body.proposalId&&["approved","stale","expired"].includes(String(result?.outcome||""));
    return result?.requestKey===body.requestKey&&result?.performedBy===intent.actorId&&result?.proposalId===body.proposalId&&result?.outcome==="rejected";
  }
  function notCommittedErrors(operation:StockWriteOperation){
    if(operation==="ingredientCreate")return new Set(["invalid_request_key","admin_required","invalid_ingredient","invalid_cost_kind","invalid_waste_margin"]);
    if(operation==="stockTransaction")return new Set([
      "invalid_stock_transaction","invalid_request_key","ingredient_required","invalid_stock_transaction_type","invalid_qty_delta","invalid_stock_text",
      "purchase_must_increase_stock","waste_must_decrease_stock","ingredient_missing","invalid_purchase_cost","invalid_purchase_date","future_purchase_date",
      "invalid_package_qty","invalid_pack_size","unsupported_stock_unit","incompatible_stock_unit","incomplete_purchase_packaging","packaging_quantity_mismatch",
      "invalid_purchase_url","invalid_cost_status","confirmed_cost_required","invalid_purchase_payment_method","stock_shortage","day_closed","purchase_date_closed",
      "high_risk_confirmation_required","high_risk_reason_required"
    ]);
    if(operation==="purchaseEdit")return new Set([
      "invalid_request_key","admin_required","purchase_not_found","purchase_already_cancelled","ingredient_missing","purchase_before_reset_read_only","purchase_has_fifo_consumption",
      "invalid_purchase_date","future_purchase_date","purchase_date_closed","invalid_purchase_cost","incomplete_purchase_packaging",
      "unsupported_stock_unit","incompatible_stock_unit","purchase_correction_stock_negative","invalid_purchase_url","invalid_purchase_payment_method"
    ]);
    if(operation==="purchaseCancel")return new Set([
      "invalid_request_key","admin_required","purchase_cancel_confirmation_required","purchase_cancel_reason_required","purchase_not_found","ingredient_missing",
      "purchase_already_cancelled","purchase_before_reset_read_only","purchase_date_closed","purchase_stock_transaction_missing","purchase_has_fifo_consumption",
      "purchase_cancel_has_later_movement","purchase_cancel_stock_negative","invalid_purchase_quantity"
    ]);
    if(operation==="cycleCountProposalApprove")return new Set(["invalid_request_key","cycle_count_approval_confirmation_required","cycle_count_proposal_id_mismatch","cycle_count_proposal_not_found","cycle_count_proposal_not_pending","cycle_count_proposal_day_closed","request_key_conflict","admin_required"]);
    if(operation==="cycleCountProposalReject")return new Set(["invalid_request_key","cycle_count_reject_reason_required","cycle_count_proposal_id_mismatch","cycle_count_proposal_not_found","cycle_count_proposal_not_pending","request_key_conflict","admin_required"]);
    return new Set(["invalid_cycle_count","cycle_count_requires_confirmation","day_closed"]);
  }
  function stockSuccessMessage(intent:StockWriteIntent,result:any,recovery:boolean){
    const prefix=recovery?"กู้คืน Request เดิมสำเร็จ · ":"";
    if(intent.operation==="ingredientCreate")return prefix+"สร้าง Stock Master แล้ว · "+String(result?.ingredient?.name||intent.body.name||"");
    if(intent.operation==="stockTransaction")return prefix+"บันทึก Stock แล้ว";
    if(intent.operation==="cycleCountCommit")return prefix+"Owner บันทึกยอดนับจริงแล้ว";
    if(intent.operation==="cycleCountProposal")return prefix+"ส่งผลนับให้ Owner ตรวจแล้ว · Stock ยังไม่เปลี่ยนจนกว่า Owner อนุมัติ";
    if(intent.operation==="purchaseEdit")return prefix+"แก้ข้อมูลรับเข้าแล้ว · Stock/ต้นทุน/รายจ่ายอัปเดตใน transaction เดียว";
    if(intent.operation==="purchaseCancel")return prefix+"ยกเลิกรับเข้าแล้ว · Stock และ Purchase Spend ถูกย้อนกลับ";
    if(intent.operation==="cycleCountProposalReject")return prefix+"ตีกลับผลนับแล้ว · Stock ไม่ถูกเปลี่ยน";
    if(result?.outcome==="approved")return prefix+"อนุมัติผลนับและปรับ Stock แล้ว";
    if(result?.outcome==="stale")return prefix+"ยืนยันผล Request เดิมแล้ว · Stock เปลี่ยนหลังพนักงานนับ จึงไม่ปรับยอดและต้องนับใหม่";
    return prefix+"ยืนยันผล Request เดิมแล้ว · ผลนับหมดอายุ จึงไม่ปรับ Stock และต้องนับใหม่";
  }

  async function submitStockIntent(intent:StockWriteIntent,recovery=false){
    setBusy(true);setMsg("");
    try{
      const req=stockRequest(intent.operation,intent.body);
      const result=await sendStockWriteIntent(intent,body=>api<any>(req.path,{method:req.method,headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)}),exactStockAck,notCommittedErrors(intent.operation));
      setPendingStockIntent(null);setStockRecoveryBlocked(false);
      if(intent.operation==="ingredientCreate")setMaster(null);
      else if(intent.operation==="stockTransaction"){setTxOpen(null);setWasteQty("")}
      else if(intent.operation==="cycleCountCommit"||intent.operation==="cycleCountProposal")setCountOpen(false);
      else if(intent.operation==="purchaseEdit")setPurchaseEdit(null);
      else if(intent.operation==="purchaseCancel"&&purchaseEdit?.purchase.id===intent.body.purchaseId)setPurchaseEdit(null);
      setMsg(stockSuccessMessage(intent,result,recovery));
      await load();
      return result;
    }catch(e:any){
      try{
        const current=readStockWriteIntent(session.user.id);setPendingStockIntent(current);
        setMsg(stockError(e.message));
      }catch{
        setStockRecoveryBlocked(true);setMsg(stockError("stock_recovery_unavailable"));
      }
      await load().catch(()=>{});
      return null;
    }finally{setBusy(false)}
  }

  useEffect(()=>{
    load().catch(()=>{});
    let disposed=false,recovering=false;
    const recover=async()=>{
      if(disposed||recovering||stockRecoveryRef.current)return;
      let intent:StockWriteIntent|null=null;
      try{intent=readStockWriteIntent(session.user.id);if(!disposed)setStockRecoveryBlocked(false)}
      catch{if(!disposed){setStockRecoveryBlocked(true);setMsg(stockError("stock_recovery_unavailable"))}return}
      if(!disposed)setPendingStockIntent(intent);
      if(!intent)return;
      if(typeof navigator!=="undefined"&&!navigator.onLine){if(!disposed)setMsg("มีรายการ Stock เดิมรอตรวจ · ขณะ Offline ระบบจะไม่สร้างรายการใหม่");return}
      recovering=true;stockRecoveryRef.current=true;
      try{await submitStockIntent(intent,true)}
      finally{recovering=false;stockRecoveryRef.current=false}
    };
    const onOnline=()=>recover().catch(()=>{}),onFocus=()=>recover().catch(()=>{}),onVisible=()=>{if(document.visibilityState==="visible")recover().catch(()=>{})};
    recover().catch(()=>{});
    window.addEventListener("online",onOnline);window.addEventListener("focus",onFocus);document.addEventListener("visibilitychange",onVisible);
    return()=>{disposed=true;window.removeEventListener("online",onOnline);window.removeEventListener("focus",onFocus);document.removeEventListener("visibilitychange",onVisible)};
  },[session.user.id,session.csrf]);
  const attentionIds=useMemo(()=>new Set(data?.attention?.ingredients.map(x=>x.id)||[]),[data?.attention]);
  const rows=useMemo(()=>(data?.ingredients||[]).filter(x=>x.archived===(tab==="archived")&&(x.name+" "+x.id).toLowerCase().includes(q.toLowerCase())&&(!attentionOnly||(!loadError&&attentionIds.has(x.id)))),[data,q,tab,attentionOnly,attentionIds,loadError]);
  const active=(data?.ingredients||[]).filter(x=>!x.archived),low=active.filter(x=>x.lowStock);
  const purchaseHistory=useMemo(()=>(data?.ingredients||[]).flatMap(i=>(i.recentPurchases||[]).map(p=>({ingredient:i,p}))).sort((a,b)=>b.p.createdAt-a.p.createdAt).slice(0,60),[data]);

  function setFromPurchase(x:Ingredient,p?:Purchase|null){
    const profile=x.purchaseProfile;
    setPurchaseCost(String(p?.totalCost??profile?.purchaseCost??""));
    setSupplier(p?.supplier||profile?.supplier||"");
    setSourceUrl(p?.sourceUrl||profile?.sourceUrl||"");
    setImageUrl(p?.imageUrl||profile?.imageUrl||"");
    setNote(p?.note||profile?.note||"");
    setPurchasePaymentMethod(p?.paymentMethod||profile?.paymentMethod||"bank");
    setPackageQty(String(p?.packageQty??1));
    setPackageUnit(p?.packageUnit||profile?.packageUnit||"ขวด");
    setPackSize(String(p?.packSize??profile?.packSize??""));
    setPackSizeUnit(p?.packSizeUnit||profile?.packSizeUnit||defaultPackSizeUnit(x.unit));
    setPresetId(p?.id||"");
  }
  function openPurchase(x:Ingredient){if(pendingStockIntent||stockRecoveryBlocked){setMsg(stockError(stockRecoveryBlocked?"stock_recovery_unavailable":"pending_stock_write_exists"));return}setMsg("");setType("PURCHASE");setPurchaseDate(today());setTxOpen(x);setFromPurchase(x,latestPurchase(x))}
  function openWaste(x:Ingredient){if(pendingStockIntent||stockRecoveryBlocked){setMsg(stockError(stockRecoveryBlocked?"stock_recovery_unavailable":"pending_stock_write_exists"));return}setMsg("");setType("WASTE");setTxOpen(x);setWasteQty("");setNote("")}

  async function openMaster(x?:Ingredient){
    setMasterMsg("");
    if(!x){
      setMaster({name:"",unit:"piece",originalUnit:"piece",safetyStock:0,costKind:"other",wasteMargin:0,loadedAt:Date.now()});
      return;
    }
    setBusy(true);
    try{
      const latest=await api<Overview>("/api/stock/overview");
      setData(latest);
      const fresh=latest.ingredients.find(item=>item.id===x.id)||x;
      setMaster({...fresh,originalUnit:fresh.unit,loadedAt:Date.now()});
    }catch{
      setMaster({...x,originalUnit:x.unit,loadedAt:Date.now()});
      setMasterMsg("โหลดข้อมูลล่าสุดจากฐานข้อมูลไม่สำเร็จ · กำลังแสดงข้อมูลที่มีอยู่ในหน้าจอ");
    }finally{setBusy(false)}
  }

  async function saveTx(){
    if(!txOpen)return;
    if(stockRecoveryBlocked){setMsg(stockError("stock_recovery_unavailable"));return}
    if(pendingStockIntent){await submitStockIntent(pendingStockIntent,true);return}
    try{
      const packs=Number(packageQty),size=Number(packSize),waste=Number(wasteQty);
      const body:any=type==="PURCHASE"?{
        requestKey:crypto.randomUUID(),ingredientId:txOpen.id,type:"PURCHASE",unit:txOpen.unit,referenceType:"purchase",referenceId:"manual-"+Date.now(),reason:note||"รับเข้าสินค้า",
        purchaseCost:Number(purchaseCost),purchaseDate,supplier,packageQty:packs,packageUnit,packSize:size,packSizeUnit,sourceUrl,imageUrl,purchaseNote:note,purchasePaymentMethod
      }:{
        requestKey:crypto.randomUUID(),ingredientId:txOpen.id,type:"WASTE",qtyDelta:-waste,unit:txOpen.unit,referenceType:"waste",referenceId:"manual-"+Date.now(),reason:note||"ของเสีย"
      };
      const intent=prepareStockWriteIntent(session.user.id,"stockTransaction",today(),body);
      setPendingStockIntent(intent);
      await submitStockIntent(intent,false);
    }catch(e:any){
      setMsg(stockError(e.message));
      if(e.message==="stock_recovery_unavailable")setStockRecoveryBlocked(true);
    }
  }

  async function saveMaster(){
    if(!master)return;setBusy(true);setMsg("");setMasterMsg("");
    try{
      const payload:any={name:String(master.name||"").trim(),safetyStock:Number(master.safetyStock)||0,costKind:master.costKind||"other",wasteMargin:Number(master.wasteMargin)||0};
      if(!master.id||master.unit!==master.originalUnit)payload.unit=master.unit||"piece";
      if(!master.id){
        if(stockRecoveryBlocked){setMsg(stockError("stock_recovery_unavailable"));return}
        if(pendingStockIntent){await submitStockIntent(pendingStockIntent,true);return}
        const body={requestKey:crypto.randomUUID(),...payload};
        const intent=prepareStockWriteIntent(session.user.id,"ingredientCreate",today(),body);
        setPendingStockIntent(intent);
        await submitStockIntent(intent,false);
        return;
      }
      await api("/api/stock/ingredients/"+encodeURIComponent(master.id),{method:"PATCH",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(payload)});
      const latest=await api<Overview>("/api/stock/overview");setData(latest);
      const saved=latest.ingredients.find(item=>item.id===master.id);
      setMaster(null);setMsg(saved?"บันทึก Master แล้ว · "+saved.name:"บันทึก Stock Master แล้ว");
    }catch(e:any){
      const map:Record<string,string>={
        unit_change_requires_zero_stock:"เปลี่ยนหน่วยตัดสูตรไม่ได้ เพราะยังมี Stock คงเหลืออยู่ · แต่การเปลี่ยนชื่อทำได้โดยไม่ต้องเปลี่ยนหน่วย",
        unit_change_recipe_in_use:"เปลี่ยนหน่วยตัดสูตรไม่ได้ เพราะรายการนี้ถูกใช้ในสูตรอยู่ · แก้ชื่อได้ตามปกติ",
        invalid_ingredient_name:"ชื่อรายการไม่ถูกต้อง กรุณากรอกอย่างน้อย 2 ตัวอักษร",
        stock_recovery_unavailable:stockError("stock_recovery_unavailable"),
        pending_stock_write_exists:stockError("pending_stock_write_exists")
      };
      setMasterMsg(map[e.message]||e.message);
      if(e.message==="stock_recovery_unavailable")setStockRecoveryBlocked(true);
    }finally{setBusy(false)}
  }
  async function performIngredientAction(x:Ingredient,action:"archive"|"restore"|"reset"){
    setBusy(true);setMsg("");
    try{
      await api("/api/stock/ingredients/"+encodeURIComponent(x.id)+"/"+action,{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(action==="reset"?{confirm:"RESET"}:{})});
      setMaster(null);setIngredientReview(null);setMsg(action==="reset"?"ล้างข้อมูลทดลองแล้ว":action==="archive"?"เก็บรายการแล้ว":"กู้คืนรายการแล้ว");await load();
    }catch(e:any){setMsg(e.message==="ingredient_in_use"?"รายการนี้ยังถูกใช้ในสูตรเมนู ต้องเอาออกจากสูตรก่อนเก็บ":e.message)}finally{setBusy(false)}
  }
  async function ingredientAction(x:Ingredient,action:"archive"|"restore"|"reset"){
    if(action==="restore")return performIngredientAction(x,action);
    setIngredientReview({ingredient:x,action});
    setMsg("");
  }
  async function confirmIngredientReview(){
    if(!ingredientReview)return;
    await performIngredientAction(ingredientReview.ingredient,ingredientReview.action);
  }

  function openCount(){
    if(pendingStockIntent||stockRecoveryBlocked){setMsg(stockError(stockRecoveryBlocked?"stock_recovery_unavailable":"pending_stock_write_exists"));return}
    const next:Record<string,CountInput>={};
    for(const x of active){
      const per=Number(x.purchaseProfile?.quantityPerPackage)||0;
      if(per>0){const packs=Math.floor(x.qty/per),loose=x.qty-packs*per;next[x.id]={packs:String(packs),loose:String(Number(loose.toFixed(4))),base:""}}
      else next[x.id]={packs:"",loose:"",base:String(x.qty)}
    }
    setMsg("");setCounts(next);setCountOpen(true);
  }
  async function saveCount(){
    if(!data)return;
    if(stockRecoveryBlocked){setMsg(stockError("stock_recovery_unavailable"));return}
    if(pendingStockIntent){await submitStockIntent(pendingStockIntent,true);return}
    try{
      const payload=active.map(x=>{const row=counts[x.id]||{packs:"0",loose:"0",base:String(x.qty)},per=Number(x.purchaseProfile?.quantityPerPackage)||0;const qty=countedQuantity(row,per);if(qty===null)throw new Error("invalid_cycle_count");return {ingredientId:x.id,countedQty:qty}});
      const operation:StockWriteOperation=admin?"cycleCountCommit":"cycleCountProposal";
      const body:any=admin?{requestKey:crypto.randomUUID(),confirm:true,counts:payload}:{requestKey:crypto.randomUUID(),counts:payload};
      const intent=prepareStockWriteIntent(session.user.id,operation,today(),body);
      setPendingStockIntent(intent);
      await submitStockIntent(intent,false);
    }catch(e:any){
      setMsg(stockError(e.message));
      if(e.message==="stock_recovery_unavailable")setStockRecoveryBlocked(true);
    }
  }
  function reviewCountProposal(p:CountProposal,approve:boolean){
    if(!admin)return;
    if(pendingStockIntent||stockRecoveryBlocked){setMsg(stockError(stockRecoveryBlocked?"stock_recovery_unavailable":"pending_stock_write_exists"));return}
    setCountReview({proposal:p,approve,reason:""});
    setMsg("");
  }
  async function confirmCountReview(){
    const review=countReview;if(!review)return;
    if(pendingStockIntent||stockRecoveryBlocked){setMsg(stockError(stockRecoveryBlocked?"stock_recovery_unavailable":"pending_stock_write_exists"));return}
    if(!review.approve&&review.reason.trim().length<2){setMsg("กรุณาระบุเหตุผลที่ตีกลับอย่างน้อย 2 ตัวอักษร");return}
    try{
      const p=review.proposal;
      const operation:StockWriteOperation=review.approve?"cycleCountProposalApprove":"cycleCountProposalReject";
      const body:any=review.approve
        ?{requestKey:crypto.randomUUID(),proposalId:p.id,confirm:true,note:"Owner reviewed physical count"}
        :{requestKey:crypto.randomUUID(),proposalId:p.id,reason:review.reason.trim()};
      const intent=prepareStockWriteIntent(session.user.id,operation,p.date||today(),body);
      setPendingStockIntent(intent);
      const result=await submitStockIntent(intent,false);
      if(result)setCountReview(null);
    }catch(e:any){
      setMsg(stockError(e.message));
      if(e.message==="stock_recovery_unavailable")setStockRecoveryBlocked(true);
    }
  }

  async function savePurchaseEdit(){
    if(!purchaseEdit)return;
    if(stockRecoveryBlocked){setMsg(stockError("stock_recovery_unavailable"));return}
    if(pendingStockIntent){setMsg(stockError("pending_stock_write_exists"));return}
    try{
      const p=purchaseEdit.purchase;
      const body:any={requestKey:crypto.randomUUID(),purchaseId:p.id,totalCost:p.totalCost,purchaseDate:p.purchaseDate,supplier:p.supplier,sourceUrl:p.sourceUrl,imageUrl:p.imageUrl,note:p.note,packageQty:p.packageQty,packageUnit:p.packageUnit,packSize:p.packSize,packSizeUnit:p.packSizeUnit,paymentMethod:p.paymentMethod||"bank"};
      const intent=prepareStockWriteIntent(session.user.id,"purchaseEdit",today(),body);
      setPendingStockIntent(intent);
      await submitStockIntent(intent,false);
    }catch(e:any){
      setMsg(stockError(e.message));
      if(e.message==="stock_recovery_unavailable")setStockRecoveryBlocked(true);
    }
  }

  async function cancelPurchase(x:Ingredient,p:Purchase){
    if(p.cancelled)return;
    if(stockRecoveryBlocked){setMsg(stockError("stock_recovery_unavailable"));return}
    if(pendingStockIntent){setMsg(stockError("pending_stock_write_exists"));return}
    const reason=window.prompt("เหตุผลที่ยกเลิกรับเข้า "+x.name+"\nเช่น กรอกวัตถุดิบผิด / รับเข้าซ้ำ","");
    if(!reason?.trim())return;
    if(!window.confirm("ยกเลิกรายการรับเข้า?\n\n"+x.name+"\n"+p.quantityReceived.toLocaleString()+" "+p.usageUnit+" · ฿"+compactMoney(p.totalCost)+"\n\nระบบจะหัก Stock และ Purchase Spend ของรายการนี้ พร้อมคืนราคาซื้อก่อนหน้า"))return;
    try{
      const body:any={requestKey:crypto.randomUUID(),purchaseId:p.id,confirm:"CANCEL PURCHASE",reason:reason.trim()};
      const intent=prepareStockWriteIntent(session.user.id,"purchaseCancel",today(),body);
      setPendingStockIntent(intent);
      await submitStockIntent(intent,false);
    }catch(e:any){
      setMsg(stockError(e.message));
      if(e.message==="stock_recovery_unavailable")setStockRecoveryBlocked(true);
    }
  }

  async function purgeIngredient(x:Ingredient,detachRecipes=false){
    if(Math.abs(Number(x.qty||0))>1e-9){setMsg("ลบถาวรไม่ได้ เพราะยังมี Stock คงเหลือ "+x.qty.toLocaleString()+" "+x.unit+" · กรุณานับ/ปรับให้เป็น 0 ก่อน");return}
    const promptText=detachRecipes
      ?"วัตถุดิบนี้ยังถูกใช้ในสูตร\nระบบจะเอาออกจากสูตรปัจจุบันทุกเมนู สร้าง Recipe Version ใหม่ แล้วลบออกจาก Stock Master\n\nประวัติ Audit/Recipe Version เดิมยังเก็บไว้\n\nดำเนินการต่อ?"
      :"ลบ "+x.name+" ออกจาก Stock Master ถาวร?\n\nใช้เฉพาะข้อมูลทดลองที่กรอกผิด และ Stock ต้องเป็น 0\nประวัติ Audit เดิมจะยังเก็บไว้";
    if(!window.confirm(promptText))return;
    setBusy(true);setMsg("");
    try{
      const r=await api<any>("/api/stock/ingredients/"+encodeURIComponent(x.id)+"/purge",{method:"DELETE",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({confirm:"DELETE INGREDIENT",detachRecipes})});
      setMaster(null);
      setMsg("ลบ "+x.name+" ออกจาก Stock Master แล้ว"+(r.detachedRecipes?.length?" · ตัดออกจากสูตร "+r.detachedRecipes.length+" รายการและสร้าง Recipe Version ใหม่":""));
      await load();
    }catch(e:any){
      if(e.message==="ingredient_in_use"&&!detachRecipes){
        setBusy(false);
        if(window.confirm(x.name+" ยังถูกใช้ในสูตรเมนู\n\nต้องการเอาวัตถุดิบนี้ออกจากสูตรทั้งหมดแล้วลบ Stock Master หรือไม่?"))return purgeIngredient(x,true);
        setMsg("ยังไม่ได้ลบ · วัตถุดิบนี้ยังถูกใช้ในสูตร");
        return;
      }
      const map:Record<string,string>={
        ingredient_purge_requires_zero_stock:"ลบไม่ได้ เพราะ Stock ยังไม่เป็น 0 · กรุณานับสต๊อกจริงหรือปรับยอดให้ถูกต้องก่อน",
        ingredient_purge_active_purchase:"ลบไม่ได้ เพราะยังมีรายการรับเข้าที่ยังใช้งานอยู่ · หากกรอกผิดให้กด “ยกเลิกรับเข้า” ก่อน",
        ingredient_purge_would_empty_recipe:"ลบไม่ได้ เพราะจะทำให้สูตรบางเมนูไม่มีวัตถุดิบเหลือเลย · กรุณาแก้สูตรเมนูนั้นก่อน",
        ingredient_purge_confirmation_required:"การยืนยันลบไม่ถูกต้อง"
      };
      setMsg(map[e.message]||e.message);
    }finally{setBusy(false)}
  }

  function stockDialogFeedback(){return <>{msg&&<p role="alert" className="my-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{msg}</p>}{pendingStockIntent&&<button disabled={busy} onClick={()=>submitStockIntent(pendingStockIntent,true)} className="my-2 min-h-11 w-full rounded-xl bg-amber-900 px-3 text-sm font-bold text-white disabled:opacity-40">ตรวจรายการสต็อกเดิม</button>}</>}

  return <section className="soft-scroll h-full overflow-auto p-3 sm:p-5 md:p-7">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="gold m-0 text-[9px] font-bold tracking-[.26em] sm:text-[10px]">INVENTORY</p><h1 className="mt-1 text-xl font-semibold sm:text-2xl">วัตถุดิบและบรรจุภัณฑ์</h1><p className="mt-1 text-xs text-slate-500">นับเป็นกล่อง/แพ็กได้ · สูตรหักใช้ตามหน่วยจริงแยกกัน</p></div>
      <div className="flex flex-wrap gap-2">{admin&&<button onClick={()=>openMaster()} className="flex min-h-11 items-center gap-2 rounded-full bg-[#d4af37] px-4 text-xs font-bold text-black"><Plus size={15}/>เพิ่มวัตถุดิบ</button>}<button onClick={openCount} className="min-h-11 rounded-full border border-slate-300 bg-white px-4 text-xs font-bold">{admin?"นับของจริง":"ส่งผลนับของจริง"}</button></div>
    </header>

    {data?.openingInventory&&<details className="mt-3 rounded-2xl border border-slate-300 bg-white p-3"><summary className="min-h-11 cursor-pointer py-3 text-sm font-bold text-slate-800">ยอดยกมาก่อนเปิดใช้จริง</summary><p className="mt-1 text-xs text-slate-600">ตรวจวัตถุดิบและจำนวนตั้งต้นให้ตรงกับของจริง ข้อมูลที่ใช้ทดสอบต้องตั้งยอดจริงใหม่ก่อนเริ่มขาย และยืนยันต้นทุนจากหลักฐานซื้อ</p><ul aria-label="รายการยอดยกมา" className="mt-3 divide-y divide-slate-200">{data.openingInventory.items.map(item=><li key={item.id} className="flex justify-between gap-3 py-2 text-sm"><span>{item.name}</span><b className="shrink-0">{item.qty.toLocaleString("th-TH")} {item.unit}</b></li>)}</ul></details>}

    {pendingStockIntent&&<div className="mt-3 rounded-2xl border border-red-300 bg-red-50 p-3 text-sm text-red-900"><b>มีรายการ Stock เดิมที่ยังไม่ทราบผล</b><p className="mt-1 text-xs">ระบบล็อกการปรับ Stock ใหม่และจะส่ง Request เดิมซ้ำอย่างปลอดภัยเมื่อเชื่อมต่อ · {pendingStockIntent.operation} · Request …{pendingStockIntent.body.requestKey.slice(-8)}</p><button disabled={busy} onClick={()=>submitStockIntent(pendingStockIntent,true)} className="mt-2 min-h-11 rounded-xl bg-red-800 px-4 text-xs font-bold text-white disabled:opacity-40">ตรวจผล Request เดิม</button></div>}
    {stockRecoveryBlocked&&<div className="mt-3 rounded-2xl border border-red-400 bg-red-50 p-3 text-sm text-red-900"><b>อ่าน Recovery ของ Stock ไม่ได้</b><p className="mt-1 text-xs">ระบบหยุดรายการ Stock ใหม่แบบ Fail Closed เพื่อป้องกันตัด/เพิ่ม Stock ซ้ำ กรุณาแก้ storage แล้วรีเฟรช</p></div>}
    {msg&&!txOpen&&!master&&!countOpen&&!countReview&&!ingredientReview&&!purchaseEdit&&<div className="mt-3 flex items-start justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm"><span>{msg}</span><button onClick={()=>setMsg("")}><X size={16}/></button></div>}
    {low.length>0&&<div className="mt-3 rounded-[20px] border border-amber-300 bg-amber-50 p-3"><div className="flex items-center gap-2 text-sm font-semibold text-amber-800"><AlertTriangle size={16}/>{low.length} รายการถึง Safety Stock</div></div>}
    {admin&&countProposals.filter(x=>x.status==="pending").length>0&&<div className="mt-3 rounded-[20px] border border-blue-200 bg-blue-50 p-3"><div className="flex items-center gap-2 text-sm font-semibold text-blue-800"><AlertTriangle size={16}/>รอ Owner ตรวจผลนับ {countProposals.filter(x=>x.status==="pending").length} รายการ</div><div className="mt-2 space-y-2">{countProposals.filter(x=>x.status==="pending").slice(0,5).map(p=><div key={p.id} className="rounded-2xl border border-blue-100 bg-white p-3 text-sm"><div className="flex flex-wrap items-start justify-between gap-2"><div><b>{p.submittedBy}</b><small className="ml-2 text-slate-500">{new Date(p.submittedAt).toLocaleTimeString("th-TH",{timeZone:"Asia/Bangkok",hour:"2-digit",minute:"2-digit"})}</small><div className="mt-1 text-xs text-slate-500">{p.adjustments.filter(x=>Math.abs(Number(x.variance||0))>0.000001).slice(0,4).map(x=>x.name+" "+(x.variance>0?"+":"")+Number(x.variance).toLocaleString()+" "+x.unit).join(" · ")||"นับตรงทุกรายการ"}</div></div><div className="flex gap-2"><button disabled={busy} onClick={()=>reviewCountProposal(p,false)} className="min-h-10 rounded-xl border border-slate-300 px-3 text-xs">ตีกลับ</button><button disabled={busy} onClick={()=>reviewCountProposal(p,true)} className="min-h-10 rounded-xl bg-[#d4af37] px-3 text-xs font-bold text-black">อนุมัติ</button></div></div></div>)}</div></div>}
    {!admin&&countProposals.some(x=>x.status==="pending")&&<div className="mt-3 rounded-[20px] border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">ผลนับล่าสุดกำลังรอ Owner ตรวจ · ระบบยังไม่เปลี่ยนยอด Stock</div>}

    <section aria-label="ของที่ทำให้เมนูหยุดขาย" className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-amber-950">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-bold">ของที่ทำให้เมนูหยุดขาย</h2><button aria-label="ตรวจข้อมูลล่าสุด" disabled={refreshing} aria-busy={refreshing} onClick={()=>load().catch(()=>{})} className="min-h-11 rounded-xl border border-amber-300 bg-white px-3 text-xs font-bold">ตรวจใหม่</button></div>
      <p className="mt-1 text-xs">ตรวจของจริงก่อนรับเข้าหรือนับใหม่ · ระบบไม่เติมยอดให้เอง</p>
      {loadError?<p role="alert" className="mt-2 text-sm font-semibold text-red-800">ยังโหลดข้อมูลสต็อกล่าสุดไม่ได้ กรุณาตรวจใหม่ก่อนใช้รายการของขาด</p>:!data?<p role="status" className="mt-2 text-xs">กำลังโหลดข้อมูลสต็อก…</p>:!data.attention?<p role="status" className="mt-2 text-xs">ยังอ่านรายการของขาดไม่ได้ กรุณาตรวจข้อมูลล่าสุดอีกครั้ง</p>:<>
        <p role="status" className="mt-2 text-xs">{data.attention.blockedMenus?data.attention.ingredients.length+" วัตถุดิบ · กระทบ "+data.attention.blockedMenus+" เมนู (รวมบางสูตรที่ขายไม่ได้)":"ไม่พบของขาดที่ทำให้เมนูหยุดขายจากข้อมูลล่าสุด"}</p>
        {data.attention.missingReferences>0&&<p className="mt-2 text-xs">มีสูตรอ้างอิงวัตถุดิบที่ไม่พบหรือเก็บแล้ว {data.attention.missingReferences} รายการ ให้เจ้าของร้านตรวจสูตรก่อนรับเข้า</p>}
      </>}
      <div className="mt-3 flex flex-wrap gap-2"><button aria-label="เฉพาะของที่ทำให้เมนูหยุดขาย" aria-pressed={attentionOnly} onClick={()=>router.replace("/stock?attention=shortage",{scroll:false})} className={"min-h-11 rounded-xl border border-amber-400 px-3 text-xs font-bold "+(attentionOnly?"bg-amber-100":"bg-white")}>ของที่ขาด</button>{attentionOnly&&<button aria-label="ดูวัตถุดิบทั้งหมด" onClick={()=>router.replace("/stock",{scroll:false})} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700">ดูทั้งหมด</button>}</div>
    </section>

    <div className="mt-3 grid gap-2 sm:grid-cols-[auto_1fr]"><div className="glass flex rounded-full p-1"><button onClick={()=>setTab("active")} className={"min-h-11 rounded-full px-4 py-2 text-xs "+(tab==="active"?"bg-[#d4af37] font-bold text-black":"text-slate-600")}>ใช้งาน</button><button onClick={()=>{setTab("archived");router.replace("/stock",{scroll:false})}} className={"min-h-11 rounded-full px-4 py-2 text-xs "+(tab==="archived"?"bg-[#d4af37] font-bold text-black":"text-slate-600")}>เก็บแล้ว</button></div><div className="glass flex items-center gap-2 rounded-full px-3 py-2.5"><Search size={17} className="text-slate-500"/><input aria-label="ค้นหาวัตถุดิบ / บรรจุภัณฑ์" value={q} onChange={e=>setQ(e.target.value)} placeholder="ค้นหาวัตถุดิบ / บรรจุภัณฑ์" className="w-full bg-transparent outline-none"/></div></div>

    <div className="mt-3 grid gap-2 lg:grid-cols-2 2xl:grid-cols-3">
      {rows.map(x=><article aria-label={x.name} key={x.id} className={"glass card p-4 "+(x.lowStock?"border-amber-300":"")}>
        <div className="flex items-start justify-between gap-3"><div><small className="text-[9px] uppercase tracking-widest text-slate-400">{x.id}</small><h2 className="mt-1 font-semibold">{x.name}</h2></div>{x.archived?<span className="rounded-full bg-slate-100 px-2 py-1 text-[10px]">เก็บแล้ว</span>:x.lowStock?<span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] text-amber-700">ใกล้หมด</span>:null}</div>
        <div className="mt-3 flex items-end justify-between gap-3"><div><small className="text-slate-500">คงเหลือที่สูตรใช้ได้</small><div className="mt-1 text-2xl font-semibold text-[#765b08]">{x.qty.toLocaleString()} <span className="text-xs text-slate-500">{x.unit}</span></div>{x.purchaseProfile&&<small className="mt-1 block text-slate-500">1 {x.purchaseProfile.packageUnit} = {Number(x.purchaseProfile.quantityPerPackage||0).toLocaleString()} {x.unit}</small>}</div><div className="text-right text-xs text-slate-500">ต้นทุนล่าสุด<br/><b className="text-slate-700">฿{x.unitCost.toFixed(4)}/{x.unit}</b></div></div>
        {attentionOnly&&<p className="mt-2 break-words text-xs font-semibold text-amber-900">กระทบเมนู: {data?.attention?.ingredients.find(row=>row.id===x.id)?.menuNames.join(", ")}</p>}
        {!x.archived&&<><p className="mt-3 text-[11px] text-slate-500">ต้นทุนซื้อจริงต้องบันทึกจาก “รับเข้า” เพื่อเก็บราคา วันที่ และแหล่งซื้อย้อนหลัง</p><div className="mt-4 grid grid-cols-2 gap-2"><button onClick={()=>openPurchase(x)} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-emerald-300 text-xs font-semibold text-emerald-700"><ArrowUpCircle size={15}/>รับเข้า</button><button onClick={()=>openWaste(x)} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-red-200 text-xs font-semibold text-red-600"><ArrowDownCircle size={15}/>ของเสีย</button></div></>}
        {admin&&<details className="mt-2 rounded-xl border border-slate-200 px-3"><summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold text-slate-700">จัดการข้อมูลวัตถุดิบ</summary><div className="grid grid-cols-2 gap-2 pb-3">{x.archived?<><button onClick={()=>ingredientAction(x,"restore")} className="min-h-11 rounded-2xl border border-amber-300 text-xs font-semibold text-amber-700"><RotateCcw size={14} className="mr-1 inline"/>กู้คืน</button><button onClick={()=>purgeIngredient(x)} className="min-h-11 rounded-2xl border border-red-200 text-xs font-semibold text-red-600"><Trash2 size={14} className="mr-1 inline"/>ลบถาวร</button></>:<><button onClick={()=>openMaster(x)} className="min-h-11 rounded-2xl border border-slate-200 text-xs text-slate-700"><Edit3 size={14} className="mr-1 inline"/>แก้ข้อมูลวัตถุดิบ</button>{latestPurchase(x)?<button onClick={()=>{setMsg("");setPurchaseEdit({ingredient:x,purchase:{...latestPurchase(x)!}})}} className="min-h-11 rounded-2xl border border-slate-200 text-xs text-slate-700">แก้ข้อมูลซื้อล่าสุด</button>:<button onClick={()=>ingredientAction(x,"reset")} className="min-h-11 rounded-2xl border border-red-200 text-xs text-red-600">ล้างข้อมูลทดลอง</button>}</>}</div></details>}
      </article>)}
    </div>

    {data&&!loadError&&(!attentionOnly||data.attention)&&rows.length===0&&<p role="status" className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">{q.trim()?"ไม่พบรายการตามคำค้น":attentionOnly?"ไม่มีวัตถุดิบในรายการของขาดที่แสดงได้ ดูวัตถุดิบทั้งหมดเพื่อตรวจรายการอื่น":"ยังไม่มีวัตถุดิบในหมวดนี้"}</p>}

    {admin&&purchaseHistory.length>0&&<div className="glass card mt-4 overflow-hidden p-2"><div className="p-3"><p className="text-[10px] tracking-[.25em] text-slate-500">PURCHASE HISTORY</p><h2 className="mt-1 text-base">ข้อมูลซื้อที่นำกลับมาใช้ซ้ำได้ / รับเข้า</h2><p className="mt-1 text-xs text-slate-500">ถ้ากรอกวัตถุดิบผิด ให้ใช้ “ยกเลิกรับเข้า” แทนการลบ Stock Master</p></div><div className="soft-scroll max-h-[340px] overflow-auto"><table className="w-full min-w-[780px] text-sm"><thead className="sticky top-0 bg-slate-100 text-left text-[10px] text-slate-500"><tr><th className="p-3">รายการ</th><th>วันที่</th><th>ร้าน/แหล่ง</th><th>จำนวนรับ</th><th>ราคา</th><th>แพ็ก</th><th>สถานะ / จัดการ</th></tr></thead><tbody>{purchaseHistory.map(({ingredient,p})=><tr key={p.id} className={"border-t border-slate-100 "+(p.cancelled?"bg-slate-50 text-slate-400":"")}><td className="p-3"><b className={p.cancelled?"line-through":""}>{ingredient.name}</b>{p.cancelled&&p.cancelReason&&<small className="mt-1 block max-w-[220px]">เหตุผล: {p.cancelReason}</small>}</td><td>{p.purchaseDate}</td><td>{p.supplier||"—"}</td><td>{p.quantityReceived.toLocaleString()} {p.usageUnit}</td><td>฿{compactMoney(p.totalCost)}</td><td>{p.packageQty||"—"} {p.packageUnit}</td><td>{p.cancelled?<span className="rounded-full bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600">ยกเลิกแล้ว</span>:<div className="flex gap-2"><button disabled={busy} onClick={()=>{setMsg("");setPurchaseEdit({ingredient,purchase:{...p}})}} className="rounded-full border px-3 py-1.5 text-xs disabled:opacity-40">แก้</button><button disabled={busy} onClick={()=>cancelPurchase(ingredient,p)} className="rounded-full border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 disabled:opacity-40">ยกเลิกรับเข้า</button></div>}</td></tr>)}</tbody></table></div></div>}

    <div className="glass card mt-4 overflow-hidden p-2"><div className="p-3"><p className="text-[10px] tracking-[.25em] text-slate-500">RECENT LEDGER</p><h2 className="mt-1 text-base">การเคลื่อนไหว Stock</h2></div><div className="soft-scroll max-h-[260px] overflow-auto"><table className="w-full min-w-[560px] text-sm"><thead className="sticky top-0 bg-slate-100 text-left text-[10px] text-slate-500"><tr><th className="p-3">รายการ</th><th>ประเภท</th><th>จำนวน</th><th>เวลา</th></tr></thead><tbody>{(data?.transactions||[]).map(t=><tr key={t.id} className="border-t border-slate-100"><td className="p-3">{data?.ingredients.find(i=>i.id===t.ingredientId)?.name||t.ingredientId}</td><td>{t.type}</td><td className={t.qtyDelta>=0?"text-emerald-700":"text-red-600"}>{t.qtyDelta>0?"+":""}{t.qtyDelta.toLocaleString()} {t.unit}</td><td className="text-slate-500">{new Date(t.createdAt).toLocaleString("th-TH")}</td></tr>)}</tbody></table></div></div>

    {ingredientReview&&<div className="field-modal-overlay fixed inset-0 z-[82] grid place-items-center bg-black/65">
      <ModalFocus labelId="stock-ingredient-review-title" onEscape={busy?undefined:()=>setIngredientReview(null)} className="field-modal-panel glass card soft-scroll w-full max-w-lg overflow-auto p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div><p className="gold text-[10px] font-black tracking-[.22em]">GUIDED STOCK</p><h3 id="stock-ingredient-review-title" className="mt-1 text-xl font-black">{ingredientReview.action==="archive"?"เก็บรายการออกจากงานประจำ":"ล้างข้อมูลทดลอง"}</h3><p className="mt-1 text-xs text-slate-500">{ingredientReview.ingredient.name}</p></div>
          <button disabled={busy} onClick={()=>setIngredientReview(null)} aria-label="ปิดการตรวจ Stock" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl disabled:opacity-40"><X size={18}/></button>
        </div>
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-3"><span className="text-sm text-slate-600">คงเหลือปัจจุบัน</span><b className="text-xl text-[#765b08]">{ingredientReview.ingredient.qty.toLocaleString()} {ingredientReview.ingredient.unit}</b></div>
          <p className="mt-2 text-xs text-slate-500">ต้นทุนล่าสุด ฿{ingredientReview.ingredient.unitCost.toFixed(4)}/{ingredientReview.ingredient.unit}</p>
        </div>
        {ingredientReview.action==="archive"?<div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><b>ผลลัพธ์:</b> ซ่อนจากรายการใช้งาน แต่ประวัติ Stock/Audit ยังคงอยู่ · ถ้ายังถูกใช้ในสูตร ระบบจะไม่อนุญาตให้เก็บ</div>:<div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-xs text-red-800"><b>ผลลัพธ์:</b> ยอดคงเหลือและต้นทุนล่าสุดจะกลับเป็น 0 · ใช้สำหรับข้อมูลทดลองเท่านั้น · Audit เดิมยังเก็บไว้</div>}
        <button disabled={busy} onClick={confirmIngredientReview} className={"mt-4 min-h-12 w-full rounded-2xl px-4 text-sm font-black text-white disabled:opacity-40 "+(ingredientReview.action==="reset"?"bg-red-700":"bg-amber-700")}>{busy?"กำลังบันทึก…":ingredientReview.action==="reset"?"ยืนยันล้างข้อมูลทดลอง":"ยืนยันเก็บรายการ"}</button>
      {stockDialogFeedback()}</ModalFocus>
    </div>}

    {countReview&&<div className="field-modal-overlay fixed inset-0 z-[83] grid place-items-center bg-black/65">
      <ModalFocus labelId="stock-count-review-title" onEscape={busy||!!pendingStockIntent?undefined:()=>setCountReview(null)} className="field-modal-panel glass card soft-scroll w-full max-w-lg overflow-auto p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div><p className="gold text-[10px] font-black tracking-[.22em]">COUNT REVIEW</p><h3 id="stock-count-review-title" className="mt-1 text-xl font-black">{countReview.approve?"อนุมัติผลนับ Stock":"ตีกลับผลนับ Stock"}</h3><p className="mt-1 text-xs text-slate-500">ผู้ส่ง {countReview.proposal.submittedBy}</p></div>
          <button disabled={busy||!!pendingStockIntent} onClick={()=>setCountReview(null)} aria-label="ปิดการตรวจผลนับ" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl disabled:opacity-40"><X size={18}/></button>
        </div>
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-3"><span className="text-sm">รายการมีส่วนต่าง</span><b className="text-xl">{countReview.proposal.adjustments.filter(x=>Math.abs(Number(x.variance||0))>0.000001).length}</b></div>
          <div className="mt-2 space-y-1 text-xs text-slate-600">{countReview.proposal.adjustments.filter(x=>Math.abs(Number(x.variance||0))>0.000001).slice(0,6).map(x=><div key={x.ingredientId} className="flex justify-between gap-3"><span className="truncate">{x.name}</span><b className={x.variance<0?"text-red-700":"text-emerald-700"}>{x.variance>0?"+":""}{Number(x.variance).toLocaleString()} {x.unit}</b></div>)}</div>
        </div>
        {countReview.approve?<div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><b>อนุมัติ:</b> Server จะตรวจว่าข้อมูลยังไม่เปลี่ยน แล้วจึงปรับ Stock และเขียน Audit Log · ถ้า Stock เปลี่ยนหลังนับ ระบบจะไม่ปรับยอดเก่า</div>:<div className="mt-3"><label className="text-xs font-semibold text-slate-700">เหตุผลที่ตีกลับ</label><textarea value={countReview.reason} onChange={e=>setCountReview(v=>v?{...v,reason:e.target.value}:v)} rows={3} placeholder="เช่น จำนวนแพ็กไม่ตรง กรุณานับใหม่" className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none"/></div>}
        <button disabled={busy||!!pendingStockIntent||(!countReview.approve&&countReview.reason.trim().length<2)} onClick={confirmCountReview} className={"mt-4 min-h-12 w-full rounded-2xl px-4 text-sm font-black text-white disabled:opacity-40 "+(countReview.approve?"bg-[#1F4D3A]":"bg-red-700")}>{busy?"กำลังตรวจและบันทึก…":countReview.approve?"ยืนยันอนุมัติผลนับ":"ยืนยันตีกลับให้นับใหม่"}</button>
      {stockDialogFeedback()}</ModalFocus>
    </div>}

    {txOpen&&<div className="field-modal-overlay fixed inset-0 z-[80] grid place-items-center overflow-auto bg-black/70"><ModalFocus labelId="stock-transaction-title" onEscape={busy?undefined:()=>setTxOpen(null)} className="field-modal-panel glass card soft-scroll my-4 w-full max-w-lg overflow-auto p-4 sm:p-6">
      <div className="flex justify-between gap-3"><div><p className="gold text-[10px] tracking-[.25em]">{type==="PURCHASE"?"รับเข้าวัตถุดิบ":"บันทึกของเสีย"}</p><h3 id="stock-transaction-title" className="mt-1 text-lg">{txOpen.name}</h3></div><button disabled={busy} aria-label="ปิดรายการสต๊อก" onClick={()=>setTxOpen(null)} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl disabled:opacity-40"><X/></button></div>
      <div className="mt-4 grid min-w-0 gap-3">{type==="WASTE"?<>
        <label className="text-xs text-slate-600">จำนวนของเสีย ({txOpen.unit})<input inputMode="decimal" value={wasteQty} onChange={e=>setWasteQty(e.target.value)} className="mt-1 w-full rounded-2xl border bg-slate-50 px-4 py-3 text-base"/></label>
        <label className="text-xs text-slate-600">เหตุผล / หมายเหตุ<input value={note} onChange={e=>setNote(e.target.value)} className="mt-1 w-full rounded-2xl border bg-slate-50 px-4 py-3 text-base"/></label>
      </>:<>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="min-w-0 text-xs font-semibold text-slate-700">ราคาซื้อรวม (บาท)<input inputMode="decimal" value={purchaseCost} onChange={e=>setPurchaseCost(e.target.value)} placeholder="เช่น 199" className="mt-1 w-full min-w-0 rounded-2xl border bg-slate-50 px-4 py-3 text-lg font-semibold"/></label>
          <label className="min-w-0 text-xs text-slate-600">วันที่ซื้อ<input type="date" max={today()} value={purchaseDate} onChange={e=>setPurchaseDate(e.target.value)} className="mt-1 w-full min-w-0 max-w-full rounded-2xl border bg-slate-50 px-3 py-3 text-base"/></label>
        </div>
        <label className="min-w-0 text-xs text-slate-600">ช่องทางที่จ่ายค่าของ<select aria-label="ช่องทางที่จ่ายค่าของ" value={purchasePaymentMethod} onChange={e=>setPurchasePaymentMethod(e.target.value)} className="mt-1 w-full min-w-0 rounded-2xl border bg-white px-4 py-3 text-base"><option value="bank">โอน/บัญชีธนาคาร</option><option value="cash">เงินสดจากลิ้นชัก</option><option value="other">ช่องทางอื่น</option></select></label>
        {purchasePaymentMethod==="cash"&&<p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">รายการนี้จะถูกหักออกจาก Expected Cash ตอนปิดวัน</p>}
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <label className="min-w-0 text-xs text-slate-600">จำนวนแพ็ก<input inputMode="decimal" value={packageQty} onChange={e=>setPackageQty(e.target.value)} className="mt-1 w-full min-w-0 rounded-2xl border bg-slate-50 px-4 py-3 text-base"/></label>
          <label className="min-w-0 text-xs text-slate-600">หน่วยซื้อ<select aria-label="หน่วยซื้อ" value={packageUnit} onChange={e=>setPackageUnit(e.target.value)} className="mt-1 w-full min-w-0 rounded-2xl border bg-white px-3 py-3 text-base">{packageUnits.map(u=><option key={u}>{u}</option>)}</select></label>
          <label className="min-w-0 text-xs text-slate-600">ปริมาณต่อ 1 {packageUnit}<input inputMode="decimal" value={packSize} onChange={e=>setPackSize(e.target.value)} className="mt-1 w-full min-w-0 rounded-2xl border bg-slate-50 px-4 py-3 text-base"/></label>
          <label className="min-w-0 text-xs text-slate-600">หน่วยต่อแพ็ก<select aria-label="หน่วยต่อแพ็ก" value={packSizeUnit} onChange={e=>setPackSizeUnit(e.target.value)} className="mt-1 w-full min-w-0 rounded-2xl border bg-white px-3 py-3 text-base"><option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">L</option><option value="piece">ชิ้น</option><option value="set">ชุด</option><option value="serve">เสิร์ฟ</option></select></label>
        </div>
        <div role="status" className="rounded-2xl bg-slate-50 p-3 text-sm"><span className="text-slate-600">ระบบจะเพิ่มเข้าหน่วยที่สูตรใช้</span><b className="mt-1 block">{previewReceived(packageQty,packSize,packSizeUnit,txOpen.unit).label}</b></div>
        <details className="min-w-0 rounded-xl border border-slate-200 px-3"><summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold text-slate-700">รายละเอียดเพิ่มเติม / ใช้ข้อมูลซื้อเดิม</summary><div className="grid min-w-0 gap-3 pb-3">
          <label className="min-w-0 text-xs text-slate-600">ใช้ข้อมูลซื้อเดิม<select aria-label="ใช้ข้อมูลซื้อเดิม" value={presetId} onChange={e=>{const p=txOpen.recentPurchases.find(p=>p.id===e.target.value&&!p.cancelled);setFromPurchase(txOpen,p)}} className="mt-1 w-full min-w-0 rounded-2xl border bg-white px-3 py-3 text-base"><option value="">ไม่ใช้</option>{txOpen.recentPurchases.filter(p=>!p.cancelled).map(p=><option key={p.id} value={p.id}>{p.purchaseDate} · ฿{compactMoney(p.totalCost)}</option>)}</select></label>
          <p className="text-xs text-slate-600">เรียกราคาและข้อมูลแพ็กเดิม วันที่ซื้อที่เลือกไว้จะไม่เปลี่ยน</p>
          <label className="text-xs text-slate-600">ร้าน / แหล่งซื้อ<input value={supplier} onChange={e=>setSupplier(e.target.value)} placeholder="เช่น Makro, Shopee, ร้านประจำ" className="mt-1 w-full min-w-0 rounded-2xl border bg-slate-50 px-4 py-3 text-base"/></label>
          <label className="text-xs text-slate-600">ลิงก์สินค้า / แหล่งซื้อ<input value={sourceUrl} onChange={e=>setSourceUrl(e.target.value)} placeholder="ใส่ https://... หรือ shopee.co.th/..." className="mt-1 w-full min-w-0 rounded-2xl border bg-slate-50 px-4 py-3 text-base"/></label>
          <label className="text-xs text-slate-600">หมายเหตุรับเข้า<input value={note} onChange={e=>setNote(e.target.value)} className="mt-1 w-full min-w-0 rounded-2xl border bg-slate-50 px-4 py-3 text-base"/></label>
          <label className="text-xs text-slate-600">ลิงก์รูปสินค้า (ถ้ามี)<input value={imageUrl} onChange={e=>setImageUrl(e.target.value)} className="mt-1 w-full min-w-0 rounded-2xl border bg-slate-50 px-4 py-3 text-base"/></label>
        </div></details>
      </>}</div>
      <div className="sticky bottom-0 -mx-4 mt-4 border-t border-slate-200 bg-white/95 px-4 pb-1 pt-3 backdrop-blur sm:-mx-6 sm:px-6">
        {stockDialogFeedback()}
        {type==="PURCHASE"&&<p className="mb-2 break-words text-xs text-slate-700">รับเข้า {previewReceived(packageQty,packSize,packSizeUnit,txOpen.unit).label} · {purchaseCostLabel(purchaseCost)} · {purchaseDate}</p>}
        <button disabled={busy||(type==="PURCHASE"&&!pendingStockIntent&&(!purchaseCost.trim()||!Number.isFinite(Number(purchaseCost))||!(Number(purchaseCost)>=0)||!(previewReceived(packageQty,packSize,packSizeUnit,txOpen.unit).qty>0)))||(type==="WASTE"&&!(Number(wasteQty)>0))} onClick={saveTx} className="min-h-12 w-full rounded-full bg-[#d4af37] font-bold text-black disabled:opacity-40">{busy?"กำลังบันทึก...":"ยืนยันและบันทึก"}</button>
      </div>
    </ModalFocus></div>}

    {master&&<div className="field-modal-overlay fixed inset-0 z-[80] grid place-items-center overflow-auto bg-black/70"><ModalFocus labelId="stock-master-title" onEscape={busy?undefined:()=>{setMaster(null);setMasterMsg("")}} className="field-modal-panel glass card soft-scroll w-full max-w-md overflow-auto p-5"><div className="flex justify-between"><div><p className="gold text-[10px] tracking-[.25em]">STOCK MASTER</p><h3 id="stock-master-title" className="mt-1 text-lg">{master.id?"แก้ไขรายการ":"เพิ่มรายการใหม่"}</h3>{master.id&&<p className="mt-1 text-[11px] text-slate-500">ID: {master.id} · โหลดข้อมูลล่าสุดจากฐานข้อมูลเมื่อเปิดหน้าต่างนี้</p>}</div><button disabled={busy} aria-label="ปิด Stock Master" onClick={()=>{setMaster(null);setMasterMsg("")}} className="grid h-11 w-11 place-items-center rounded-xl disabled:opacity-40"><X/></button></div>
      <div className="mt-4 grid gap-3">
        {masterMsg&&<div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">{masterMsg}</div>}
        <label className="text-xs text-slate-500">ชื่อรายการ<input value={master.name||""} onChange={e=>setMaster({...master,name:e.target.value})} placeholder="ชื่อวัตถุดิบ/บรรจุภัณฑ์" className="mt-1 w-full rounded-2xl border bg-slate-50 px-4 py-3 text-base"/></label>
        {master.id&&<div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs">
          <div className="flex items-center justify-between gap-3"><span className="text-slate-500">หน่วยที่สูตร/Stock ใช้</span><b>{usageUnitLabel(master.originalUnit||master.unit)}</b></div>
          {master.purchaseProfile?.packageUnit&&<><div className="mt-2 flex items-center justify-between gap-3"><span className="text-slate-500">หน่วยซื้อ/นับล่าสุด</span><b>{master.purchaseProfile.packageUnit}</b></div><div className="mt-1 text-slate-600">1 {master.purchaseProfile.packageUnit} = {Number(master.purchaseProfile.quantityPerPackage||0).toLocaleString()} {master.purchaseProfile.usageUnit||master.originalUnit||master.unit}</div></>}
          {!master.purchaseProfile?.packageUnit&&<p className="mt-2 text-slate-500">ยังไม่มีข้อมูลแพ็กจากรายการรับเข้าล่าสุด · บันทึกจากปุ่ม “รับเข้า” ก่อน</p>}
        </div>}
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-500">หน่วยตัดสูตร<select value={master.unit||"piece"} disabled={!!master.id&&Number(master.qty||0)!==0} onChange={e=>setMaster({...master,unit:e.target.value})} className="mt-1 w-full rounded-2xl border bg-white px-3 py-3 disabled:bg-slate-100 disabled:text-slate-500">{usageUnits.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
          <label className="text-xs text-slate-500">Safety Stock<input type="number" min="0" value={Number(master.safetyStock)||0} onChange={e=>setMaster({...master,safetyStock:Number(e.target.value)})} placeholder="Safety Stock" className="mt-1 w-full rounded-2xl border bg-slate-50 px-3 py-3"/></label>
        </div>
        {!!master.id&&Number(master.qty||0)!==0&&<p className="text-[11px] text-slate-500">หน่วยตัดสูตรถูกล็อกเพราะมียอดคงเหลือ {Number(master.qty||0).toLocaleString()} {master.originalUnit||master.unit} · คุณยังแก้ชื่อและข้อมูล Master อื่นได้ตามปกติ</p>}
        {master.purchaseProfile?.packageUnit&&<p className="text-[11px] text-[#765b08]">“{master.purchaseProfile.packageUnit}” เป็นหน่วยซื้อ/หน่วยนับ ไม่ใช่หน่วยตัดสูตร · แก้ขนาดแพ็กได้ที่ “แก้ข้อมูลซื้อล่าสุด”</p>}
        <label className="text-xs text-slate-500">ประเภทต้นทุน<select value={master.costKind||"other"} onChange={e=>setMaster({...master,costKind:e.target.value,wasteMargin:["syrup","concentrate"].includes(e.target.value)?(master.wasteMargin||.05):0})} className="mt-1 w-full rounded-2xl border bg-white px-3 py-3"><option value="other">ทั่วไป/บรรจุภัณฑ์</option><option value="powder">ผง</option><option value="milk">นม</option><option value="water">น้ำ</option><option value="syrup">ไซรัป</option><option value="concentrate">น้ำเข้มข้น</option></select></label>
        {["syrup","concentrate"].includes(master.costKind||"")&&<input type="number" min="0" max="50" value={Math.round(Number(master.wasteMargin||0)*100)} onChange={e=>setMaster({...master,wasteMargin:Number(e.target.value)/100})} placeholder="% เผื่อสูญเสีย" className="rounded-2xl border bg-slate-50 px-4 py-3"/>}
        <button disabled={busy||String(master.name||"").trim().length<2} onClick={saveMaster} className="min-h-12 rounded-full bg-[#d4af37] font-bold text-black disabled:opacity-40">{busy?"กำลังบันทึก...":"บันทึก Master"}</button>
        {master.id&&<div className="rounded-2xl bg-slate-50 p-3 text-xs text-slate-600"><b>เก็บรายการ</b> = ซ่อนและกู้คืนได้ · <b>ลบถาวร</b> = เอาออกจาก Stock Master โดยต้องมียอด 0 และไม่มีรายการรับเข้าที่ยังใช้งาน</div>}
        {master.id&&!master.archived&&<><button onClick={()=>ingredientAction(master as Ingredient,"reset")} className="min-h-11 rounded-full border border-red-200 text-sm text-red-600">ล้างยอด/ราคาทดลอง</button><button onClick={()=>ingredientAction(master as Ingredient,"archive")} className="min-h-11 rounded-full border border-slate-300 text-sm text-slate-600"><Archive size={14} className="mr-1 inline"/>เก็บรายการ</button></>}
        {master.id&&<button onClick={()=>purgeIngredient(master as Ingredient)} className="min-h-11 rounded-full border border-red-300 text-sm font-semibold text-red-700"><Trash2 size={14} className="mr-1 inline"/>ลบถาวร (ข้อมูลทดลอง)</button>}
      </div>{stockDialogFeedback()}</ModalFocus></div>}

    {countOpen&&<div className="field-modal-overlay fixed inset-0 z-[80] grid place-items-center overflow-auto bg-black/70"><ModalFocus labelId="stock-daily-count-title" onEscape={busy?undefined:()=>setCountOpen(false)} className="field-modal-panel glass card soft-scroll w-full max-w-xl overflow-auto p-5"><div className="flex justify-between"><div><p className="gold text-[10px] tracking-[.25em]">DAILY COUNT</p><h3 id="stock-daily-count-title" className="mt-1 text-lg">นับของจริง</h3><p className="text-xs text-slate-500">นับเป็นกล่อง/แพ็กก่อน ระบบค่อยแปลงเป็นหน่วยใช้ในสูตร</p></div><button disabled={busy} aria-label="ปิดการนับสต๊อก" onClick={()=>setCountOpen(false)} className="grid h-11 w-11 place-items-center rounded-xl disabled:opacity-40"><X/></button></div><div className="mt-4 space-y-2">{active.map(x=>{const per=Number(x.purchaseProfile?.quantityPerPackage)||0,row=counts[x.id]||{packs:"",loose:"",base:""};return <div key={x.id} className="rounded-2xl border bg-white p-3"><div className="flex justify-between"><b className="text-sm">{x.name}</b><small className="text-slate-500">ระบบ {x.qty.toLocaleString()} {x.unit}</small></div>{per>0?<div className="mt-2 grid grid-cols-2 gap-2"><label className="text-xs text-slate-500">จำนวน {x.purchaseProfile?.packageUnit}<input inputMode="decimal" value={row.packs} onChange={e=>setCounts({...counts,[x.id]:{...row,packs:e.target.value}})} className="mt-1 w-full rounded-xl border bg-slate-50 px-3 py-2 text-base"/></label><label className="text-xs text-slate-500">เศษ/เปิดแล้ว ({x.unit})<input inputMode="decimal" value={row.loose} onChange={e=>setCounts({...counts,[x.id]:{...row,loose:e.target.value}})} className="mt-1 w-full rounded-xl border bg-slate-50 px-3 py-2 text-base"/></label><small className="col-span-2 text-[#765b08]">รวม = {(Number(row.packs||0)*per+Number(row.loose||0)).toLocaleString()} {x.unit} · 1 {x.purchaseProfile?.packageUnit} = {per.toLocaleString()} {x.unit}</small></div>:<label className="mt-2 block text-xs text-slate-500">จำนวนจริง ({x.unit})<input inputMode="decimal" value={row.base} onChange={e=>setCounts({...counts,[x.id]:{...row,base:e.target.value}})} className="mt-1 w-full rounded-xl border bg-slate-50 px-3 py-2 text-base"/></label>}</div>})}</div><button disabled={busy} onClick={saveCount} className="mt-4 min-h-12 w-full rounded-full bg-[#d4af37] font-bold text-black">{admin?"ยืนยันและปรับ Stock":"ส่งผลนับให้ Owner ตรวจ"}</button><p className="mt-2 text-center text-xs text-slate-500">{admin?"Owner action · การยืนยันจะเขียน Adjustment และ Audit Log":"พนักงานบันทึกผลนับได้ แต่ยอด Stock จะยังไม่เปลี่ยนจนกว่า Owner อนุมัติ"}</p>{stockDialogFeedback()}</ModalFocus></div>}

    {purchaseEdit&&<div className="field-modal-overlay fixed inset-0 z-[80] grid place-items-center overflow-auto bg-black/70"><ModalFocus labelId="stock-purchase-edit-title" onEscape={busy?undefined:()=>setPurchaseEdit(null)} className="field-modal-panel glass card soft-scroll w-full max-w-lg overflow-auto p-5"><div className="flex justify-between"><div><p className="gold text-[10px] tracking-[.25em]">EDIT PURCHASE</p><h3 id="stock-purchase-edit-title" className="mt-1 text-lg">{purchaseEdit.ingredient.name}</h3><p className="text-xs text-slate-500">แก้ราคา/แหล่งซื้อได้ · ถ้าจำนวนของจริงผิดให้ใช้ “นับสต๊อกจริง”</p></div><button disabled={busy} aria-label="ปิดการแก้ไขการซื้อ" onClick={()=>setPurchaseEdit(null)} className="grid h-11 w-11 place-items-center rounded-xl disabled:opacity-40"><X/></button></div><div className="mt-4 grid gap-3"><label className="text-xs text-slate-500">ราคาซื้อรวม<input type="number" value={purchaseEdit.purchase.totalCost} onChange={e=>setPurchaseEdit({...purchaseEdit,purchase:{...purchaseEdit.purchase,totalCost:Number(e.target.value)}})} className="mt-1 w-full rounded-2xl border bg-slate-50 px-4 py-3 text-lg font-semibold"/></label><input type="date" max={today()} value={purchaseEdit.purchase.purchaseDate} onChange={e=>setPurchaseEdit({...purchaseEdit,purchase:{...purchaseEdit.purchase,purchaseDate:e.target.value}})} className="rounded-2xl border bg-slate-50 px-4 py-3"/><input value={purchaseEdit.purchase.supplier} onChange={e=>setPurchaseEdit({...purchaseEdit,purchase:{...purchaseEdit.purchase,supplier:e.target.value}})} placeholder="ร้าน / แหล่งซื้อ" className="rounded-2xl border bg-slate-50 px-4 py-3"/><select value={purchaseEdit.purchase.paymentMethod||"bank"} onChange={e=>setPurchaseEdit({...purchaseEdit,purchase:{...purchaseEdit.purchase,paymentMethod:e.target.value}})} className="rounded-2xl border bg-white px-4 py-3"><option value="bank">จ่ายผ่านโอน/ธนาคาร</option><option value="cash">จ่ายเงินสดจากลิ้นชัก</option><option value="other">ช่องทางอื่น</option></select><div className="grid grid-cols-2 gap-2"><input type="number" min="0" step="any" value={purchaseEdit.purchase.packageQty??""} onChange={e=>setPurchaseEdit({...purchaseEdit,purchase:{...purchaseEdit.purchase,packageQty:e.target.value===""?null:Number(e.target.value)}})} placeholder="จำนวนแพ็ก" className="rounded-2xl border bg-slate-50 px-4 py-3"/><select value={purchaseEdit.purchase.packageUnit} onChange={e=>setPurchaseEdit({...purchaseEdit,purchase:{...purchaseEdit.purchase,packageUnit:e.target.value}})} className="rounded-2xl border bg-white px-3 py-3">{packageUnits.map(u=><option key={u}>{u}</option>)}</select></div><div className="grid grid-cols-2 gap-2"><input type="number" min="0" step="any" value={purchaseEdit.purchase.packSize??""} onChange={e=>setPurchaseEdit({...purchaseEdit,purchase:{...purchaseEdit.purchase,packSize:e.target.value===""?null:Number(e.target.value)}})} placeholder={"ปริมาณต่อ 1 "+purchaseEdit.purchase.packageUnit} className="rounded-2xl border bg-slate-50 px-4 py-3"/><select value={purchaseEdit.purchase.packSizeUnit} onChange={e=>setPurchaseEdit({...purchaseEdit,purchase:{...purchaseEdit.purchase,packSizeUnit:e.target.value}})} className="rounded-2xl border bg-white px-3 py-3"><option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">L</option><option value="piece">ชิ้น</option><option value="set">ชุด</option><option value="serve">เสิร์ฟ</option></select></div><div className="rounded-2xl bg-amber-50 p-3 text-xs text-amber-800">ถ้าแก้จำนวนแพ็ก/ขนาด ระบบจะคำนวณส่วนต่างและปรับ Stock ปัจจุบันให้ พร้อมบันทึก Audit</div><input value={purchaseEdit.purchase.sourceUrl} onChange={e=>setPurchaseEdit({...purchaseEdit,purchase:{...purchaseEdit.purchase,sourceUrl:e.target.value}})} placeholder="ลิงก์สินค้า" className="rounded-2xl border bg-slate-50 px-4 py-3"/><input value={purchaseEdit.purchase.note} onChange={e=>setPurchaseEdit({...purchaseEdit,purchase:{...purchaseEdit.purchase,note:e.target.value}})} placeholder="สถานที่/สาขา/หมายเหตุ" className="rounded-2xl border bg-slate-50 px-4 py-3"/><button disabled={busy} onClick={savePurchaseEdit} className="min-h-12 rounded-full bg-[#d4af37] font-bold text-black">บันทึกการแก้ไข</button></div>{stockDialogFeedback()}</ModalFocus></div>}
  </section>;
}
