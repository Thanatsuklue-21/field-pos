"use client";
import {useEffect,useMemo,useState} from "react";
import {AlertTriangle,Archive,ArrowDownCircle,ArrowUpCircle,Edit3,Plus,RotateCcw,Search,X} from "lucide-react";
import AuthGate from "@/components/auth-gate";
import {api,type Session} from "@/lib/api-client";

type Purchase={
  id:string;stockTransactionId:string;supplier:string;purchaseDate:string;packageQty:number|null;packageUnit:string;packSize:number|null;packSizeUnit:string;
  quantityReceived:number;usageUnit:string;totalCost:number;unitCost:number;sourceUrl:string;imageUrl:string;note:string;createdAt:number;conversionApproximate:boolean;
};
type PurchaseProfile={packageUnit:string;packSize:number;packSizeUnit:string;quantityPerPackage:number;usageUnit:string;conversionApproximate?:boolean;supplier?:string;sourceUrl?:string;imageUrl?:string;purchaseCost?:number|null;purchaseDate?:string;note?:string;updatedAt?:number};
type Ingredient={id:string;name:string;qty:number;unit:string;safetyStock:number;unitCost:number;costStatus:string;costKind:string;wasteMargin:number;lowStock:boolean;archived:boolean;archivedAt?:number|null;historyResetAt?:number;purchaseProfile?:PurchaseProfile|null;recentPurchases:Purchase[]};
type Tx={id:string;ingredientId:string;type:string;qtyDelta:number;unit:string;reason:string;createdAt:number};
type Overview={revision:number;ingredients:Ingredient[];transactions:Tx[]};
type CountInput={packs:string;loose:string;base:string};

const today=()=>new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Bangkok"});
const packageUnits=["ขวด","ถุง","ถัง","แกลลอน","กล่อง","แพ็ก","ลัง","ชิ้น"];
const usageUnits=[["g","กรัม (g)"],["ml","มิลลิลิตร (ml)"],["piece","ชิ้น"],["serve","เสิร์ฟ"]];

export default function Stock(){return <AuthGate>{s=><StockView session={s}/>}</AuthGate>}

function previewReceived(packageQty:string,packSize:string,fromUnit:string,toUnit:string){
  const packs=Number(packageQty),size=Number(packSize);if(!(packs>0)||!(size>0))return {qty:0,label:"—",approximate:false};
  const from=fromUnit.toLowerCase(),to=toUnit.toLowerCase(),mass:Record<string,number>={g:1,kg:1000},volume:Record<string,number>={ml:1,l:1000};
  let each:number|undefined,approximate=false;
  if(from===to)each=size;
  else if(mass[from]&&mass[to])each=size*mass[from]/mass[to];
  else if(volume[from]&&volume[to])each=size*volume[from]/volume[to];
  else if((mass[from]&&volume[to])||(volume[from]&&mass[to])){const base=mass[from]?size*mass[from]:size*volume[from];each=(to==="kg"||to==="l")?base/1000:base;approximate=true}
  else if(from==="piece"&&(to==="piece"||to==="ชิ้น"))each=size;
  if(each===undefined)return {qty:0,label:"หน่วยไม่เข้ากัน",approximate:false};
  const qty=packs*each;return {qty,label:qty.toLocaleString()+" "+toUnit,approximate};
}
function compactMoney(v:number){return Number(v||0).toLocaleString("th-TH",{minimumFractionDigits:0,maximumFractionDigits:2})}
function latestPurchase(x:Ingredient){return x.recentPurchases?.[0]||null}

function StockView({session}:{session:Session}){
  const admin=session.user.role==="admin";
  const [data,setData]=useState<Overview|null>(null),[q,setQ]=useState(""),[tab,setTab]=useState<"active"|"archived">("active"),[msg,setMsg]=useState(""),[busy,setBusy]=useState(false);
  const [txOpen,setTxOpen]=useState<Ingredient|null>(null),[type,setType]=useState<"PURCHASE"|"WASTE">("PURCHASE"),[wasteQty,setWasteQty]=useState("");
  const [purchaseCost,setPurchaseCost]=useState(""),[purchaseDate,setPurchaseDate]=useState(today()),[supplier,setSupplier]=useState(""),[sourceUrl,setSourceUrl]=useState(""),[imageUrl,setImageUrl]=useState(""),[note,setNote]=useState("");
  const [packageQty,setPackageQty]=useState("1"),[packageUnit,setPackageUnit]=useState("ขวด"),[packSize,setPackSize]=useState(""),[packSizeUnit,setPackSizeUnit]=useState("g"),[presetId,setPresetId]=useState("");
  const [master,setMaster]=useState<Partial<Ingredient>|null>(null),[purchaseEdit,setPurchaseEdit]=useState<{ingredient:Ingredient;purchase:Purchase}|null>(null);
  const [countOpen,setCountOpen]=useState(false),[counts,setCounts]=useState<Record<string,CountInput>>({});

  const load=()=>api<Overview>("/api/stock/overview").then(setData);
  useEffect(()=>{load().catch(()=>{})},[]);
  const rows=useMemo(()=>(data?.ingredients||[]).filter(x=>x.archived===(tab==="archived")&&(x.name+" "+x.id).toLowerCase().includes(q.toLowerCase())),[data,q,tab]);
  const active=(data?.ingredients||[]).filter(x=>!x.archived),low=active.filter(x=>x.lowStock);
  const purchaseHistory=useMemo(()=>(data?.ingredients||[]).flatMap(i=>(i.recentPurchases||[]).map(p=>({ingredient:i,p}))).sort((a,b)=>b.p.createdAt-a.p.createdAt).slice(0,60),[data]);

  function setFromPurchase(x:Ingredient,p?:Purchase|null){
    const profile=x.purchaseProfile;
    setPurchaseCost(String(p?.totalCost??profile?.purchaseCost??""));
    setPurchaseDate(p?.purchaseDate||profile?.purchaseDate||today());
    setSupplier(p?.supplier||profile?.supplier||"");
    setSourceUrl(p?.sourceUrl||profile?.sourceUrl||"");
    setImageUrl(p?.imageUrl||profile?.imageUrl||"");
    setNote(p?.note||profile?.note||"");
    setPackageQty(String(p?.packageQty??1));
    setPackageUnit(p?.packageUnit||profile?.packageUnit||"ขวด");
    setPackSize(String(p?.packSize??profile?.packSize??""));
    setPackSizeUnit(p?.packSizeUnit||profile?.packSizeUnit||((x.unit==="ml")?"ml":x.unit==="piece"?"piece":"g"));
    setPresetId(p?.id||"");
  }
  function openPurchase(x:Ingredient){setMsg("");setType("PURCHASE");setTxOpen(x);setFromPurchase(x,latestPurchase(x))}
  function openWaste(x:Ingredient){setMsg("");setType("WASTE");setTxOpen(x);setWasteQty("");setNote("")}

  async function saveTx(){
    if(!txOpen)return;setBusy(true);setMsg("");
    try{
      const packs=Number(packageQty),size=Number(packSize),waste=Number(wasteQty);
      const body=type==="PURCHASE"?{
        requestKey:crypto.randomUUID(),ingredientId:txOpen.id,type:"PURCHASE",unit:txOpen.unit,referenceType:"purchase",referenceId:"manual-"+Date.now(),reason:note||"รับเข้าสินค้า",
        purchaseCost:Number(purchaseCost),purchaseDate,supplier,packageQty:packs,packageUnit,packSize:size,packSizeUnit,sourceUrl,imageUrl,purchaseNote:note
      }:{
        requestKey:crypto.randomUUID(),ingredientId:txOpen.id,type:"WASTE",qtyDelta:-waste,unit:txOpen.unit,referenceType:"waste",referenceId:"manual-"+Date.now(),reason:note||"ของเสีย"
      };
      await api("/api/stock/transactions",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)});
      setTxOpen(null);setWasteQty("");setMsg("บันทึก Stock แล้ว");await load();
    }catch(e:any){
      const map:Record<string,string>={invalid_purchase_url:"ลิงก์ไม่ถูกต้อง · ใส่ได้ทั้ง https://... หรือโดเมน เช่น shopee.co.th/...",future_purchase_date:"วันที่ซื้อห้ามเป็นอนาคต",purchase_date_closed:"วันที่ซื้อถูก Close Day แล้ว",stock_shortage:"จำนวนคงเหลือไม่พอ",incompatible_stock_unit:"หน่วยต่อบรรจุภัณฑ์ไม่เข้ากับหน่วยที่สูตรใช้"};
      setMsg(map[e.message]||e.message)
    }finally{setBusy(false)}
  }

  async function saveMaster(){
    if(!master)return;setBusy(true);setMsg("");
    try{
      const payload={name:master.name,unit:master.unit,safetyStock:Number(master.safetyStock)||0,costKind:master.costKind||"other",wasteMargin:Number(master.wasteMargin)||0};
      if(master.id)await api("/api/stock/ingredients/"+encodeURIComponent(master.id),{method:"PATCH",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(payload)});
      else await api("/api/stock/ingredients",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(payload)});
      setMaster(null);setMsg("บันทึก Stock Master แล้ว");await load();
    }catch(e:any){
      const map:Record<string,string>={unit_change_requires_zero_stock:"ต้องนับ/ปรับยอดให้เป็น 0 ก่อนเปลี่ยนหน่วย",unit_change_recipe_in_use:"รายการนี้ถูกใช้ในสูตรอยู่ จึงเปลี่ยนหน่วยไม่ได้"};
      setMsg(map[e.message]||e.message)
    }finally{setBusy(false)}
  }
  async function ingredientAction(x:Ingredient,action:"archive"|"restore"|"reset"){
    if(action==="archive"&&!window.confirm("เก็บ "+x.name+" ออกจากรายการใช้งาน? ประวัติจะยังอยู่"))return;
    if(action==="reset"&&!window.confirm("ล้างข้อมูลทดลองของ "+x.name+" ?\nยอดคงเหลือและต้นทุนล่าสุดจะกลับเป็น 0 แต่ประวัติ Audit เดิมยังเก็บไว้"))return;
    setBusy(true);setMsg("");
    try{
      await api("/api/stock/ingredients/"+encodeURIComponent(x.id)+"/"+action,{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(action==="reset"?{confirm:"RESET"}:{})});
      setMaster(null);setMsg(action==="reset"?"ล้างข้อมูลทดลองแล้ว":action==="archive"?"เก็บรายการแล้ว":"กู้คืนรายการแล้ว");await load();
    }catch(e:any){setMsg(e.message==="ingredient_in_use"?"รายการนี้ยังถูกใช้ในสูตรเมนู ต้องเอาออกจากสูตรก่อนเก็บ":e.message)}finally{setBusy(false)}
  }

  function openCount(){
    const next:Record<string,CountInput>={};
    for(const x of active){
      const per=Number(x.purchaseProfile?.quantityPerPackage)||0;
      if(per>0){const packs=Math.floor(x.qty/per),loose=x.qty-packs*per;next[x.id]={packs:String(packs),loose:String(Number(loose.toFixed(4))),base:""}}
      else next[x.id]={packs:"",loose:"",base:String(x.qty)}
    }
    setCounts(next);setCountOpen(true);
  }
  async function saveCount(){
    if(!data)return;setBusy(true);setMsg("");
    try{
      const payload=active.map(x=>{const row=counts[x.id]||{packs:"0",loose:"0",base:String(x.qty)},per=Number(x.purchaseProfile?.quantityPerPackage)||0;return {ingredientId:x.id,countedQty:per>0?Number(row.packs||0)*per+Number(row.loose||0):Number(row.base||0)}});
      await api("/api/stock/cycle-count",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({requestKey:crypto.randomUUID(),confirm:true,counts:payload})});
      setCountOpen(false);setMsg("บันทึกยอดนับจริงแล้ว");await load();
    }catch(e:any){setMsg(e.message)}finally{setBusy(false)}
  }

  async function savePurchaseEdit(){
    if(!purchaseEdit)return;setBusy(true);setMsg("");
    try{
      const p=purchaseEdit.purchase;
      await api("/api/stock/purchases/"+encodeURIComponent(p.id),{method:"PATCH",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({totalCost:p.totalCost,purchaseDate:p.purchaseDate,supplier:p.supplier,sourceUrl:p.sourceUrl,imageUrl:p.imageUrl,note:p.note})});
      setPurchaseEdit(null);setMsg("แก้ข้อมูลซื้อแล้ว");await load();
    }catch(e:any){setMsg(e.message==="purchase_before_reset_read_only"?"รายการนี้อยู่ก่อนจุดล้างข้อมูลทดลอง จึงเก็บไว้อ่านอย่างเดียว":e.message==="invalid_purchase_url"?"ลิงก์ไม่ถูกต้อง":e.message)}finally{setBusy(false)}
  }

  return <section className="soft-scroll h-full overflow-auto p-3 sm:p-5 md:p-7">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="gold m-0 text-[9px] font-bold tracking-[.26em] sm:text-[10px]">INVENTORY</p><h1 className="mt-1 text-xl font-semibold sm:text-2xl">STOCK MANAGEMENT</h1><p className="mt-1 text-xs text-slate-500">นับเป็นกล่อง/แพ็กได้ · สูตรหักใช้ตามหน่วยจริงแยกกัน</p></div>
      <div className="flex flex-wrap gap-2">{admin&&<button onClick={()=>setMaster({name:"",unit:"piece",safetyStock:0,costKind:"other",wasteMargin:0})} className="flex min-h-11 items-center gap-2 rounded-full bg-[#d4af37] px-4 text-xs font-bold text-black"><Plus size={15}/>เพิ่ม Stock</button>}<button onClick={openCount} className="min-h-11 rounded-full border border-slate-300 bg-white px-4 text-xs font-bold">นับสต๊อกจริง</button></div>
    </header>

    {msg&&<div className="mt-3 flex items-start justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm"><span>{msg}</span><button onClick={()=>setMsg("")}><X size={16}/></button></div>}
    {low.length>0&&<div className="mt-3 rounded-[20px] border border-amber-300 bg-amber-50 p-3"><div className="flex items-center gap-2 text-sm font-semibold text-amber-800"><AlertTriangle size={16}/>{low.length} รายการถึง Safety Stock</div></div>}

    <div className="mt-3 grid gap-2 sm:grid-cols-[auto_1fr]"><div className="glass flex rounded-full p-1"><button onClick={()=>setTab("active")} className={"rounded-full px-4 py-2 text-xs "+(tab==="active"?"bg-[#d4af37] font-bold text-black":"text-slate-600")}>ใช้งาน</button><button onClick={()=>setTab("archived")} className={"rounded-full px-4 py-2 text-xs "+(tab==="archived"?"bg-[#d4af37] font-bold text-black":"text-slate-600")}>เก็บแล้ว</button></div><div className="glass flex items-center gap-2 rounded-full px-3 py-2.5"><Search size={17} className="text-slate-500"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="ค้นหาวัตถุดิบ / บรรจุภัณฑ์" className="w-full bg-transparent outline-none"/></div></div>

    <div className="mt-3 grid gap-2 lg:grid-cols-2 2xl:grid-cols-3">
      {rows.map(x=><article key={x.id} className={"glass card p-4 "+(x.lowStock?"border-amber-300":"")}>
        <div className="flex items-start justify-between gap-3"><div><small className="text-[9px] uppercase tracking-widest text-slate-400">{x.id}</small><h2 className="mt-1 font-semibold">{x.name}</h2></div>{x.archived?<span className="rounded-full bg-slate-100 px-2 py-1 text-[10px]">ARCHIVED</span>:x.lowStock?<span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] text-amber-700">LOW</span>:null}</div>
        <div className="mt-3 flex items-end justify-between gap-3"><div><small className="text-slate-500">คงเหลือที่สูตรใช้ได้</small><div className="mt-1 text-2xl font-semibold text-[#765b08]">{x.qty.toLocaleString()} <span className="text-xs text-slate-500">{x.unit}</span></div>{x.purchaseProfile&&<small className="mt-1 block text-slate-500">1 {x.purchaseProfile.packageUnit} = {Number(x.purchaseProfile.quantityPerPackage||0).toLocaleString()} {x.unit}</small>}</div><div className="text-right text-xs text-slate-500">ต้นทุนล่าสุด<br/><b className="text-slate-700">฿{x.unitCost.toFixed(4)}/{x.unit}</b></div></div>
        {!x.archived&&<div className="mt-4 grid grid-cols-2 gap-2"><button onClick={()=>openPurchase(x)} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-emerald-300 text-xs font-semibold text-emerald-700"><ArrowUpCircle size={15}/>รับเข้า</button><button onClick={()=>openWaste(x)} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-red-200 text-xs font-semibold text-red-600"><ArrowDownCircle size={15}/>ของเสีย</button></div>}
        {admin&&<div className="mt-2 grid grid-cols-2 gap-2">{x.archived?<button onClick={()=>ingredientAction(x,"restore")} className="col-span-2 min-h-11 rounded-2xl border border-amber-300 text-xs font-semibold text-amber-700"><RotateCcw size={14} className="mr-1 inline"/>กู้คืน</button>:<><button onClick={()=>setMaster({...x})} className="min-h-11 rounded-2xl border border-slate-200 text-xs text-slate-700"><Edit3 size={14} className="mr-1 inline"/>แก้ Master</button>{latestPurchase(x)?<button onClick={()=>setPurchaseEdit({ingredient:x,purchase:{...latestPurchase(x)!}})} className="min-h-11 rounded-2xl border border-slate-200 text-xs text-slate-700">แก้ข้อมูลซื้อล่าสุด</button>:<button onClick={()=>ingredientAction(x,"reset")} className="min-h-11 rounded-2xl border border-red-200 text-xs text-red-600">ล้างข้อมูลทดลอง</button>}</>}</div>}
      </article>)}
    </div>

    {admin&&purchaseHistory.length>0&&<div className="glass card mt-4 overflow-hidden p-2"><div className="p-3"><p className="text-[10px] tracking-[.25em] text-slate-500">PURCHASE HISTORY</p><h2 className="mt-1 text-base">ข้อมูลซื้อที่นำกลับมาใช้ซ้ำได้</h2></div><div className="soft-scroll max-h-[300px] overflow-auto"><table className="w-full min-w-[620px] text-sm"><thead className="sticky top-0 bg-slate-100 text-left text-[10px] text-slate-500"><tr><th className="p-3">รายการ</th><th>วันที่</th><th>ร้าน/แหล่ง</th><th>ราคา</th><th>แพ็ก</th><th></th></tr></thead><tbody>{purchaseHistory.map(({ingredient,p})=><tr key={p.id} className="border-t border-slate-100"><td className="p-3">{ingredient.name}</td><td>{p.purchaseDate}</td><td>{p.supplier||"—"}</td><td>฿{compactMoney(p.totalCost)}</td><td>{p.packageQty||"—"} {p.packageUnit}</td><td><button onClick={()=>setPurchaseEdit({ingredient,purchase:{...p}})} className="rounded-full border px-3 py-1.5 text-xs">แก้</button></td></tr>)}</tbody></table></div></div>}

    <div className="glass card mt-4 overflow-hidden p-2"><div className="p-3"><p className="text-[10px] tracking-[.25em] text-slate-500">RECENT LEDGER</p><h2 className="mt-1 text-base">การเคลื่อนไหว Stock</h2></div><div className="soft-scroll max-h-[260px] overflow-auto"><table className="w-full min-w-[560px] text-sm"><thead className="sticky top-0 bg-slate-100 text-left text-[10px] text-slate-500"><tr><th className="p-3">รายการ</th><th>ประเภท</th><th>จำนวน</th><th>เวลา</th></tr></thead><tbody>{(data?.transactions||[]).map(t=><tr key={t.id} className="border-t border-slate-100"><td className="p-3">{data?.ingredients.find(i=>i.id===t.ingredientId)?.name||t.ingredientId}</td><td>{t.type}</td><td className={t.qtyDelta>=0?"text-emerald-700":"text-red-600"}>{t.qtyDelta>0?"+":""}{t.qtyDelta.toLocaleString()} {t.unit}</td><td className="text-slate-500">{new Date(t.createdAt).toLocaleString("th-TH")}</td></tr>)}</tbody></table></div></div>

    {txOpen&&<div className="fixed inset-0 z-50 grid place-items-center overflow-auto bg-black/70 p-3"><div className="glass card my-4 w-full max-w-lg p-4 sm:p-6"><div className="flex justify-between"><div><p className="gold text-[10px] tracking-[.25em]">{type}</p><h3 className="mt-1 text-lg">{txOpen.name}</h3></div><button onClick={()=>setTxOpen(null)}><X/></button></div>
      <div className="mt-4 grid gap-3">{type==="WASTE"?<><label className="text-xs text-slate-500">จำนวนของเสีย ({txOpen.unit})</label><input inputMode="decimal" value={wasteQty} onChange={e=>setWasteQty(e.target.value)} className="rounded-2xl border bg-slate-50 px-4 py-3"/><input value={note} onChange={e=>setNote(e.target.value)} placeholder="เหตุผล / หมายเหตุ" className="rounded-2xl border bg-slate-50 px-4 py-3"/></>:<>
        <label className="text-xs font-semibold text-slate-700">1. ราคาซื้อรวม (บาท)</label><input inputMode="decimal" value={purchaseCost} onChange={e=>setPurchaseCost(e.target.value)} placeholder="เช่น 199" className="rounded-2xl border bg-slate-50 px-4 py-3 text-lg font-semibold"/>
        <div className="grid grid-cols-2 gap-2"><div><label className="mb-1 block text-xs text-slate-500">วันที่ซื้อ</label><input type="date" max={today()} value={purchaseDate} onChange={e=>setPurchaseDate(e.target.value)} className="w-full rounded-2xl border bg-slate-50 px-3 py-3"/></div><div><label className="mb-1 block text-xs text-slate-500">ข้อมูลเดิม</label><select value={presetId} onChange={e=>{const p=txOpen.recentPurchases.find(p=>p.id===e.target.value);setFromPurchase(txOpen,p)}} className="w-full rounded-2xl border bg-white px-3 py-3"><option value="">ไม่ใช้</option>{txOpen.recentPurchases.map(p=><option key={p.id} value={p.id}>{p.purchaseDate} · ฿{compactMoney(p.totalCost)}</option>)}</select></div></div>
        <label className="text-xs text-slate-500">ร้าน / แหล่งซื้อ</label><input value={supplier} onChange={e=>setSupplier(e.target.value)} placeholder="เช่น Makro, Shopee, ร้านประจำ" className="rounded-2xl border bg-slate-50 px-4 py-3"/>
        <label className="text-xs text-slate-500">ลิงก์สินค้า/แหล่งซื้อ</label><input value={sourceUrl} onChange={e=>setSourceUrl(e.target.value)} placeholder="ใส่ https://... หรือ shopee.co.th/..." className="rounded-2xl border bg-slate-50 px-4 py-3"/>
        <label className="text-xs font-semibold text-slate-700">2. จำนวนที่ซื้อ</label><div className="grid grid-cols-2 gap-2"><input inputMode="decimal" value={packageQty} onChange={e=>setPackageQty(e.target.value)} placeholder="จำนวนแพ็ก" className="rounded-2xl border bg-slate-50 px-4 py-3"/><select value={packageUnit} onChange={e=>setPackageUnit(e.target.value)} className="rounded-2xl border bg-white px-3 py-3">{packageUnits.map(u=><option key={u}>{u}</option>)}</select></div>
        <div className="grid grid-cols-2 gap-2"><input inputMode="decimal" value={packSize} onChange={e=>setPackSize(e.target.value)} placeholder={"ปริมาณต่อ 1 "+packageUnit} className="rounded-2xl border bg-slate-50 px-4 py-3"/><select value={packSizeUnit} onChange={e=>setPackSizeUnit(e.target.value)} className="rounded-2xl border bg-white px-3 py-3"><option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">L</option><option value="piece">ชิ้น</option></select></div>
        <div className="rounded-2xl bg-slate-50 p-3 text-sm"><span className="text-slate-500">ระบบจะเพิ่มเข้าหน่วยที่สูตรใช้</span><b className="mt-1 block">{previewReceived(packageQty,packSize,packSizeUnit,txOpen.unit).label}</b></div>
        <input value={note} onChange={e=>setNote(e.target.value)} placeholder="สถานที่/สาขา/หมายเหตุ" className="rounded-2xl border bg-slate-50 px-4 py-3"/><input value={imageUrl} onChange={e=>setImageUrl(e.target.value)} placeholder="ลิงก์รูปสินค้า (ถ้ามี)" className="rounded-2xl border bg-slate-50 px-4 py-3"/>
      </>}
      <button disabled={busy||(type==="PURCHASE"&&(purchaseCost.trim()===""||!supplier.trim()||!(Number(packageQty)>0)||!(Number(packSize)>0)))||(type==="WASTE"&&!(Number(wasteQty)>0))} onClick={saveTx} className="min-h-12 rounded-full bg-[#d4af37] font-bold text-black disabled:opacity-40">{busy?"กำลังบันทึก...":"ยืนยันและบันทึก"}</button></div></div></div>}

    {master&&<div className="fixed inset-0 z-50 grid place-items-center overflow-auto bg-black/70 p-3"><div className="glass card w-full max-w-md p-5"><div className="flex justify-between"><div><p className="gold text-[10px] tracking-[.25em]">STOCK MASTER</p><h3 className="mt-1 text-lg">{master.id?"แก้ไขรายการ":"เพิ่มรายการใหม่"}</h3></div><button onClick={()=>setMaster(null)}><X/></button></div><div className="mt-4 grid gap-3"><input value={master.name||""} onChange={e=>setMaster({...master,name:e.target.value})} placeholder="ชื่อวัตถุดิบ/บรรจุภัณฑ์" className="rounded-2xl border bg-slate-50 px-4 py-3"/><div className="grid grid-cols-2 gap-2"><select value={master.unit||"piece"} onChange={e=>setMaster({...master,unit:e.target.value})} className="rounded-2xl border bg-white px-3 py-3">{usageUnits.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><input type="number" min="0" value={Number(master.safetyStock)||0} onChange={e=>setMaster({...master,safetyStock:Number(e.target.value)})} placeholder="Safety Stock" className="rounded-2xl border bg-slate-50 px-3 py-3"/></div><select value={master.costKind||"other"} onChange={e=>setMaster({...master,costKind:e.target.value,wasteMargin:["syrup","concentrate"].includes(e.target.value)?(master.wasteMargin||.05):0})} className="rounded-2xl border bg-white px-3 py-3"><option value="other">ทั่วไป/บรรจุภัณฑ์</option><option value="powder">ผง</option><option value="milk">นม</option><option value="water">น้ำ</option><option value="syrup">ไซรัป</option><option value="concentrate">น้ำเข้มข้น</option></select>{["syrup","concentrate"].includes(master.costKind||"")&&<input type="number" min="0" max="50" value={Math.round(Number(master.wasteMargin||0)*100)} onChange={e=>setMaster({...master,wasteMargin:Number(e.target.value)/100})} placeholder="% เผื่อสูญเสีย" className="rounded-2xl border bg-slate-50 px-4 py-3"/>}<p className="text-xs text-slate-500">ต้นทุนซื้อจริงต้องบันทึกจาก “รับเข้า” หรือแก้ Purchase History เพื่อให้มีวันที่และแหล่งซื้ออ้างอิง</p><button disabled={busy||String(master.name||"").trim().length<2} onClick={saveMaster} className="min-h-12 rounded-full bg-[#d4af37] font-bold text-black">บันทึก Master</button>{master.id&&!master.archived&&<><button onClick={()=>ingredientAction(master as Ingredient,"reset")} className="min-h-11 rounded-full border border-red-200 text-sm text-red-600">ล้างยอด/ราคาทดลอง</button><button onClick={()=>ingredientAction(master as Ingredient,"archive")} className="min-h-11 rounded-full border border-slate-300 text-sm text-slate-600"><Archive size={14} className="mr-1 inline"/>เก็บรายการ</button></>}</div></div></div>}

    {countOpen&&<div className="fixed inset-0 z-50 grid place-items-center overflow-auto bg-black/70 p-3"><div className="glass card soft-scroll max-h-[92vh] w-full max-w-xl overflow-auto p-5"><div className="flex justify-between"><div><p className="gold text-[10px] tracking-[.25em]">DAILY COUNT</p><h3 className="mt-1 text-lg">นับของจริง</h3><p className="text-xs text-slate-500">นับเป็นกล่อง/แพ็กก่อน ระบบค่อยแปลงเป็นหน่วยใช้ในสูตร</p></div><button onClick={()=>setCountOpen(false)}><X/></button></div><div className="mt-4 space-y-2">{active.map(x=>{const per=Number(x.purchaseProfile?.quantityPerPackage)||0,row=counts[x.id]||{packs:"",loose:"",base:""};return <div key={x.id} className="rounded-2xl border bg-white p-3"><div className="flex justify-between"><b className="text-sm">{x.name}</b><small className="text-slate-500">ระบบ {x.qty.toLocaleString()} {x.unit}</small></div>{per>0?<div className="mt-2 grid grid-cols-2 gap-2"><label className="text-xs text-slate-500">จำนวน {x.purchaseProfile?.packageUnit}<input inputMode="decimal" value={row.packs} onChange={e=>setCounts({...counts,[x.id]:{...row,packs:e.target.value}})} className="mt-1 w-full rounded-xl border bg-slate-50 px-3 py-2 text-base"/></label><label className="text-xs text-slate-500">เศษ/เปิดแล้ว ({x.unit})<input inputMode="decimal" value={row.loose} onChange={e=>setCounts({...counts,[x.id]:{...row,loose:e.target.value}})} className="mt-1 w-full rounded-xl border bg-slate-50 px-3 py-2 text-base"/></label><small className="col-span-2 text-[#765b08]">รวม = {(Number(row.packs||0)*per+Number(row.loose||0)).toLocaleString()} {x.unit} · 1 {x.purchaseProfile?.packageUnit} = {per.toLocaleString()} {x.unit}</small></div>:<label className="mt-2 block text-xs text-slate-500">จำนวนจริง ({x.unit})<input inputMode="decimal" value={row.base} onChange={e=>setCounts({...counts,[x.id]:{...row,base:e.target.value}})} className="mt-1 w-full rounded-xl border bg-slate-50 px-3 py-2 text-base"/></label>}</div>})}</div><button disabled={busy} onClick={saveCount} className="mt-4 min-h-12 w-full rounded-full bg-[#d4af37] font-bold text-black">ยืนยันผลตรวจนับ</button></div></div>}

    {purchaseEdit&&<div className="fixed inset-0 z-50 grid place-items-center overflow-auto bg-black/70 p-3"><div className="glass card w-full max-w-lg p-5"><div className="flex justify-between"><div><p className="gold text-[10px] tracking-[.25em]">EDIT PURCHASE</p><h3 className="mt-1 text-lg">{purchaseEdit.ingredient.name}</h3><p className="text-xs text-slate-500">แก้ราคา/แหล่งซื้อได้ · ถ้าจำนวนของจริงผิดให้ใช้ “นับสต๊อกจริง”</p></div><button onClick={()=>setPurchaseEdit(null)}><X/></button></div><div className="mt-4 grid gap-3"><label className="text-xs text-slate-500">ราคาซื้อรวม<input type="number" value={purchaseEdit.purchase.totalCost} onChange={e=>setPurchaseEdit({...purchaseEdit,purchase:{...purchaseEdit.purchase,totalCost:Number(e.target.value)}})} className="mt-1 w-full rounded-2xl border bg-slate-50 px-4 py-3 text-lg font-semibold"/></label><input type="date" max={today()} value={purchaseEdit.purchase.purchaseDate} onChange={e=>setPurchaseEdit({...purchaseEdit,purchase:{...purchaseEdit.purchase,purchaseDate:e.target.value}})} className="rounded-2xl border bg-slate-50 px-4 py-3"/><input value={purchaseEdit.purchase.supplier} onChange={e=>setPurchaseEdit({...purchaseEdit,purchase:{...purchaseEdit.purchase,supplier:e.target.value}})} placeholder="ร้าน / แหล่งซื้อ" className="rounded-2xl border bg-slate-50 px-4 py-3"/><input value={purchaseEdit.purchase.sourceUrl} onChange={e=>setPurchaseEdit({...purchaseEdit,purchase:{...purchaseEdit.purchase,sourceUrl:e.target.value}})} placeholder="ลิงก์สินค้า" className="rounded-2xl border bg-slate-50 px-4 py-3"/><input value={purchaseEdit.purchase.note} onChange={e=>setPurchaseEdit({...purchaseEdit,purchase:{...purchaseEdit.purchase,note:e.target.value}})} placeholder="สถานที่/สาขา/หมายเหตุ" className="rounded-2xl border bg-slate-50 px-4 py-3"/><button disabled={busy} onClick={savePurchaseEdit} className="min-h-12 rounded-full bg-[#d4af37] font-bold text-black">บันทึกการแก้ไข</button></div></div></div>}
  </section>;
}
