"use client";
import {useEffect,useMemo,useState} from "react";
import {AlertTriangle,ArrowDownCircle,ArrowUpCircle,Pencil,Search,X} from "lucide-react";
import AuthGate from "@/components/auth-gate";
import {api,type Session} from "@/lib/api-client";

type Ingredient={id:string;name:string;qty:number;unit:string;safetyStock:number;unitCost:number;lowStock:boolean};
type Tx={id:string;ingredientId:string;type:string;qtyDelta:number;unit:string;reason:string;createdAt:number};
type Overview={revision:number;ingredients:Ingredient[];transactions:Tx[]};

export default function Stock(){return <AuthGate>{s=><StockView session={s}/>}</AuthGate>}

function StockView({session}:{session:Session}){
  const [data,setData]=useState<Overview|null>(null),[q,setQ]=useState(""),[txOpen,setTxOpen]=useState<Ingredient|null>(null),[edit,setEdit]=useState<Ingredient|null>(null);
  const [type,setType]=useState<"PURCHASE"|"WASTE">("PURCHASE"),[qty,setQty]=useState(""),[reason,setReason]=useState(""),[busy,setBusy]=useState(false),[msg,setMsg]=useState("");
  const admin=session.user.role==="admin";
  const load=()=>api<Overview>("/api/stock/overview").then(setData);
  useEffect(()=>{load().catch(()=>{})},[]);
  const rows=useMemo(()=>((data?.ingredients)||[]).filter(x=>(x.name+" "+x.id).toLowerCase().includes(q.toLowerCase())),[data,q]);
  const low=(data?.ingredients||[]).filter(x=>x.lowStock);

  async function saveTx(){
    if(!txOpen)return;const n=Number(qty);if(!Number.isFinite(n)||n<=0)return;
    setBusy(true);setMsg("");
    try{
      await api("/api/stock/transactions",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({
        requestKey:crypto.randomUUID(),ingredientId:txOpen.id,type,qtyDelta:type==="PURCHASE"?n:-n,unit:txOpen.unit,
        referenceType:type==="PURCHASE"?"purchase":"waste",referenceId:"manual-"+Date.now(),reason:reason||"Stock adjustment"
      })});
      setTxOpen(null);setQty("");setReason("");await load();
    }catch(e:any){setMsg(e.message==="stock_shortage"?"จำนวนตัดออกมากกว่าสต็อกคงเหลือ":e.message)}
    finally{setBusy(false)}
  }

  async function saveIngredient(){
    if(!edit)return;setBusy(true);setMsg("");
    try{
      await api("/api/stock/ingredients/"+encodeURIComponent(edit.id),{method:"PATCH",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({safetyStock:Number(edit.safetyStock)||0,unitCost:Number(edit.unitCost)||0})});
      setEdit(null);await load();
    }catch(e:any){setMsg(e.message)}finally{setBusy(false)}
  }

  return <section className="soft-scroll h-full overflow-auto p-5 md:p-7">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="gold m-0 text-[10px] font-bold tracking-[.3em]">INVENTORY</p><h1 className="mt-1 text-2xl font-semibold">STOCK MANAGEMENT</h1></div>
      <div className={"rounded-full px-4 py-2 text-xs "+(low.length?"bg-amber-400/10 text-amber-300":"bg-emerald-400/10 text-emerald-300")}>{low.length?low.length+" LOW STOCK":"STOCK OK"}</div>
    </header>

    {low.length>0&&<div className="mt-5 rounded-[28px] border border-amber-400/20 bg-amber-400/[.06] p-4"><div className="flex items-center gap-2 text-sm font-semibold text-amber-300"><AlertTriangle size={17}/>Safety stock alert</div><div className="mt-3 flex flex-wrap gap-2">{low.map(x=><span key={x.id} className="rounded-full bg-black/25 px-3 py-2 text-xs">{x.name}: {x.qty.toLocaleString()} {x.unit} / min {x.safetyStock.toLocaleString()}</span>)}</div></div>}

    <div className="glass mt-5 flex items-center gap-3 rounded-full px-4 py-3"><Search size={18} className="text-neutral-500"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="ค้นหาวัตถุดิบ" className="w-full bg-transparent outline-none"/></div>

    <div className="mt-4 grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
      {rows.map(x=><div key={x.id} className={"glass card p-5 "+(x.lowStock?"border-amber-400/25":"")}>
        <div className="flex items-start justify-between gap-3"><div><small className="text-[10px] uppercase tracking-widest text-neutral-500">{x.id}</small><h2 className="mt-1 text-base font-semibold">{x.name}</h2></div>{x.lowStock&&<span className="rounded-full bg-amber-400/10 px-3 py-1 text-[10px] font-bold text-amber-300">LOW</span>}</div>
        <div className="mt-5 flex items-end justify-between"><div><small className="text-neutral-500">คงเหลือ</small><div className="mt-1 text-3xl font-semibold gold">{x.qty.toLocaleString()} <span className="text-sm text-neutral-500">{x.unit}</span></div></div><div className="text-right text-xs text-neutral-500">Min {x.safetyStock.toLocaleString()}<br/>Cost ฿{x.unitCost.toFixed(4)}/{x.unit}</div></div>
        <div className="mt-5 grid grid-cols-2 gap-2"><button onClick={()=>{setType("PURCHASE");setTxOpen(x)}} className="flex items-center justify-center gap-2 rounded-full border border-emerald-400/20 py-2.5 text-xs font-semibold text-emerald-300"><ArrowUpCircle size={15}/>รับเข้า</button><button onClick={()=>{setType("WASTE");setTxOpen(x)}} className="flex items-center justify-center gap-2 rounded-full border border-red-400/20 py-2.5 text-xs font-semibold text-red-300"><ArrowDownCircle size={15}/>ของเสีย</button></div>
        {admin&&<button onClick={()=>setEdit({...x})} className="mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-white/10 py-2.5 text-xs text-neutral-400"><Pencil size={14}/>Safety / Cost</button>}
      </div>)}
    </div>

    <div className="glass card mt-5 overflow-hidden p-2"><div className="p-4"><p className="text-[10px] tracking-[.25em] text-neutral-500">RECENT LEDGER</p><h2 className="mt-1 text-base">STOCK TRANSACTIONS</h2></div><div className="soft-scroll max-h-[340px] overflow-auto"><table className="w-full text-sm"><thead className="sticky top-0 bg-[#151515] text-left text-[10px] uppercase tracking-widest text-neutral-500"><tr><th className="p-4">Ingredient</th><th>Type</th><th>Qty</th><th>Reason</th><th>Time</th></tr></thead><tbody>{(data?.transactions||[]).map(x=><tr key={x.id} className="border-t border-white/5"><td className="p-4">{x.ingredientId}</td><td className="text-neutral-400">{x.type}</td><td className={x.qtyDelta>=0?"text-emerald-300":"text-red-300"}>{x.qtyDelta>0?"+":""}{x.qtyDelta.toLocaleString()} {x.unit}</td><td className="text-neutral-500">{x.reason||"—"}</td><td className="text-neutral-500">{new Date(x.createdAt).toLocaleString("th-TH")}</td></tr>)}</tbody></table></div></div>

    {txOpen&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"><div className="glass card w-full max-w-md p-6"><div className="flex justify-between"><div><p className="gold text-[10px] tracking-[.25em]">{type}</p><h3 className="mt-1 text-xl">{txOpen.name}</h3></div><button onClick={()=>setTxOpen(null)}><X/></button></div><div className="mt-5 grid gap-3"><input inputMode="decimal" value={qty} onChange={e=>setQty(e.target.value)} placeholder={"จำนวน ("+txOpen.unit+")"} className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 outline-none"/><input value={reason} onChange={e=>setReason(e.target.value)} placeholder="หมายเหตุ" className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 outline-none"/><button disabled={busy||!(Number(qty)>0)} onClick={saveTx} className="rounded-full bg-[#d4af37] py-3 font-bold text-black disabled:opacity-40">{busy?"SAVING...":"SAVE TRANSACTION"}</button>{msg&&<p className="text-center text-sm text-red-300">{msg}</p>}</div></div></div>}

    {edit&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"><div className="glass card w-full max-w-md p-6"><div className="flex justify-between"><div><p className="gold text-[10px] tracking-[.25em]">ADMIN SETTINGS</p><h3 className="mt-1 text-xl">{edit.name}</h3></div><button onClick={()=>setEdit(null)}><X/></button></div><div className="mt-5 grid gap-3"><label className="text-xs text-neutral-500">Safety stock ({edit.unit})</label><input type="number" min="0" value={edit.safetyStock} onChange={e=>setEdit({...edit,safetyStock:Number(e.target.value)})} className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 outline-none"/><label className="text-xs text-neutral-500">Standard unit cost (บาท/{edit.unit})</label><input type="number" min="0" step="0.0001" value={edit.unitCost} onChange={e=>setEdit({...edit,unitCost:Number(e.target.value)})} className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 outline-none"/><button disabled={busy} onClick={saveIngredient} className="rounded-full bg-[#d4af37] py-3 font-bold text-black disabled:opacity-40">{busy?"SAVING...":"SAVE SETTINGS"}</button>{msg&&<p className="text-center text-sm text-red-300">{msg}</p>}</div></div></div>}
  </section>
}
