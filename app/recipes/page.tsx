"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {MinusCircle,Plus,Pencil,X} from "lucide-react";
import AuthGate from "@/components/auth-gate";
import {api,type Session} from "@/lib/api-client";
import {prepareRecipeMutationIntent,readRecipeMutationIntent,sendRecipeMutationIntent,type RecipeMutationBody,type RecipeMutationIntent} from "@/lib/recipe-mutation-recovery";

type Ingredient={id:string;name:string;unit:string;qty:number;unitCost:number;standardUnitCost:number;archived:boolean};
type Variant={label:string;recipeVersion:number|null;recipe:{items:Record<string,number>}};
type Menu={id:string;name:string;enabled:boolean;variants:Variant[]};
type Comment={id:string;menuId:string;variant:string;recipeVersion:number|null;authorType:"customer"|"owner"|"custom";authorName:string;text:string;createdAt:number;updatedAt:number;history?:{text:string;authorName:string;authorType:string;updatedAt:number}[]};
type Drift={updateId:string;menuId:string;menuName:string;variant:string;from:Record<string,number>;to:Record<string,number>};
type Data={ingredients:Ingredient[];menus:Menu[];versions:any[];comments:Comment[];approvedDrift:Drift[]};
type Line={key:string;ingredientId:string;qty:string};

const key=()=>crypto.randomUUID();
export default function Recipes(){return <AuthGate>{s=><View session={s}/>}</AuthGate>}

function View({session}:{session:Session}){
  const [data,setData]=useState<Data|null>(null),[menuId,setMenuId]=useState(""),[variant,setVariant]=useState(""),[lines,setLines]=useState<Line[]>([]),[msg,setMsg]=useState(""),[busy,setBusy]=useState(false);
  const [authorType,setAuthorType]=useState<Comment["authorType"]>("customer"),[authorName,setAuthorName]=useState(""),[commentText,setCommentText]=useState(""),[editing,setEditing]=useState<Comment|null>(null);
  const [pendingRecipeIntent,setPendingRecipeIntent]=useState<RecipeMutationIntent|null>(null),[recipeRecoveryBlocked,setRecipeRecoveryBlocked]=useState(false);
  const recipeRecoveryRef=useRef(false);
  const load=()=>api<Data>("/api/admin/recipes").then(d=>{setData(d);if(!menuId&&d.menus[0])setMenuId(d.menus[0].id)});
  useEffect(()=>{if(session.user.role==="admin")load().catch(()=>{})},[]);
  const menu=useMemo(()=>data?.menus.find(x=>x.id===menuId)||null,[data,menuId]);
  const currentVariant=menu?.variants.find(x=>x.label===variant)||null;
  const ingredients=useMemo(()=>(data?.ingredients||[]).filter(x=>!x.archived),[data]);
  const byId=useMemo(()=>Object.fromEntries((data?.ingredients||[]).map(x=>[x.id,x])),[data]);
  const comments=useMemo(()=>(data?.comments||[]).filter(x=>x.menuId===menuId&&x.variant===variant),[data,menuId,variant]);

  function loadVariant(v?:Variant|null){
    const entries=Object.entries(v?.recipe?.items||{});
    setLines(entries.length?entries.map(([ingredientId,qty])=>({key:key(),ingredientId,qty:String(qty)})):[{key:key(),ingredientId:"",qty:""}]);
  }
  useEffect(()=>{if(menu){const v=menu.variants[0];setVariant(v?.label||"");loadVariant(v)}},[menuId,data?.menus]);
  useEffect(()=>{if(menu)loadVariant(menu.variants.find(x=>x.label===variant))},[variant]);
  useEffect(()=>{if(authorType==="owner")setAuthorName(session.user.username);else if(authorName===session.user.username)setAuthorName("")},[authorType]);

  const recipeCost=useMemo(()=>lines.reduce((sum,l)=>{const i=byId[l.ingredientId],qty=Number(l.qty);return sum+(i&&qty>0?qty*Number(i.standardUnitCost||i.unitCost||0):0)},0),[lines,byId]);

  function recipeError(code:string){
    const map:Record<string,string>={
      invalid_request_key:"ระบบสร้างรหัสป้องกันรายการซ้ำไม่สำเร็จ",
      invalid_recipe:"ข้อมูลสูตรไม่ถูกต้อง",
      invalid_recipe_qty:"ปริมาณวัตถุดิบในสูตรไม่ถูกต้อง",
      empty_recipe:"สูตรต้องมีอย่างน้อย 1 รายการ",
      ingredient_missing:"มีวัตถุดิบในสูตรที่ไม่อยู่ใน Stock Master",
      menu_not_found:"ไม่พบเมนูนี้แล้ว · กรุณารีเฟรช",
      variant_not_found:"ไม่พบ Variant นี้แล้ว · กรุณารีเฟรช",
      approved_recipe_update_required:"ไม่พบรหัสสูตรอนุมัติที่ต้องปรับ",
      approved_recipe_update_not_found:"ไม่พบ FIELD Approved Master รายการนี้",
      approved_recipe_menu_not_found:"ไม่พบเมนูของสูตรอนุมัติ",
      approved_recipe_not_legacy_match:"สูตรปัจจุบันเปลี่ยนจากจุดเริ่มต้นแล้ว · กรุณารีเฟรชก่อนปรับ",
      invalid_recipe_comment:"ความคิดเห็นไม่ถูกต้อง",
      comment_author_required:"กรุณาระบุชื่อผู้ให้ความเห็น",
      pending_recipe_mutation_exists:"มีการบันทึกสูตร/ความคิดเห็นก่อนหน้าที่ยังไม่ทราบผล · ต้องตรวจรายการเดิมก่อน",
      recipe_ack_unknown:"Server ยังยืนยันรายการเดิมไม่ครบ · ระบบเก็บ Request เดิมไว้ ห้ามสร้าง Version/Comment ใหม่แทน",
      recipe_recovery_unavailable:"อ่าน/บันทึกข้อมูลป้องกันรายการซ้ำไม่ได้ · ระบบหยุดการเขียน Recipe ชั่วคราว",
      request_key_conflict:"Request เดิมถูกผูกกับข้อมูลหรือผู้ใช้อื่น · หยุดรายการใหม่และตรวจ Audit/Recipe เดิม",
      network_unavailable:"การเชื่อมต่อขาดระหว่างบันทึก · ยังไม่ทราบผล ระบบเก็บ Request เดิมไว้และจะตรวจซ้ำ",
      offline_write_blocked:"ออฟไลน์อยู่ · ระบบเก็บ Request เดิมไว้และจะตรวจเมื่อเชื่อมต่อ"
    };
    return map[code]||code;
  }

  function recipeRequest(body:RecipeMutationBody){
    if(body.operation==="publish")return "/api/admin/recipes/publish";
    if(body.operation==="reconcile")return "/api/admin/recipes/reconcile";
    return "/api/admin/recipes/comments";
  }

  async function submitRecipeIntent(intent:RecipeMutationIntent,recovery=false){
    if(recipeRecoveryRef.current)return null;
    recipeRecoveryRef.current=true;setBusy(true);setMsg("");
    try{
      const result=await sendRecipeMutationIntent(intent,body=>api<any>(recipeRequest(body),{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)}));
      setPendingRecipeIntent(null);setRecipeRecoveryBlocked(false);
      if(intent.body.operation==="publish")setMsg((recovery?"ตรวจ Request เดิมแล้ว · ":"")+"Published v"+result.version);
      else if(intent.body.operation==="reconcile")setMsg((recovery?"ตรวจ Request เดิมแล้ว · ":"")+"ปรับสูตรอนุมัติแล้ว · Published v"+result.version);
      else{
        setEditing(null);setCommentText("");if(authorType!=="owner")setAuthorName("");
        setMsg((recovery?"ตรวจ Request เดิมแล้ว · ":"")+"บันทึกความคิดเห็นแล้ว");
      }
      await load().catch(()=>{});
      return result;
    }catch(e:any){
      try{setPendingRecipeIntent(readRecipeMutationIntent(session.user.id));setRecipeRecoveryBlocked(false)}
      catch{setRecipeRecoveryBlocked(true)}
      setMsg(recipeError(e?.message||"recipe_ack_unknown"));
      await load().catch(()=>{});
      return null;
    }finally{recipeRecoveryRef.current=false;setBusy(false)}
  }

  async function recoverRecipeMutation(){
    if(recipeRecoveryRef.current)return;
    let intent:RecipeMutationIntent|null=null;
    try{intent=readRecipeMutationIntent(session.user.id);setPendingRecipeIntent(intent);setRecipeRecoveryBlocked(false)}
    catch{setRecipeRecoveryBlocked(true);setMsg(recipeError("recipe_recovery_unavailable"));return}
    if(!intent)return;
    if(typeof navigator!=="undefined"&&!navigator.onLine){setMsg("มีรายการ Recipe เดิมรอตรวจ · ห้ามสร้าง Version/Comment ใหม่ เมื่อออนไลน์ระบบจะตรวจ Request เดิม");return}
    await submitRecipeIntent(intent,true);
  }

  useEffect(()=>{
    if(session.user.role!=="admin")return;
    let disposed=false;
    const recover=()=>{if(!disposed)recoverRecipeMutation().catch(()=>{})};
    const visible=()=>{if(document.visibilityState==="visible")recover()};
    recover();
    window.addEventListener("online",recover);window.addEventListener("focus",recover);document.addEventListener("visibilitychange",visible);
    return()=>{disposed=true;window.removeEventListener("online",recover);window.removeEventListener("focus",recover);document.removeEventListener("visibilitychange",visible)};
  },[session.user.id,session.csrf,session.user.role]);

  if(session.user.role!=="admin")return <div className="grid h-full place-items-center text-slate-500">Admin permission required</div>;

  async function publish(){
    if(recipeRecoveryBlocked){setMsg(recipeError("recipe_recovery_unavailable"));return}
    let existing:RecipeMutationIntent|null=null;
    try{existing=readRecipeMutationIntent(session.user.id)}
    catch{setRecipeRecoveryBlocked(true);setMsg(recipeError("recipe_recovery_unavailable"));return}
    if(existing){setPendingRecipeIntent(existing);await submitRecipeIntent(existing,true);return}
    const clean:Record<string,number>={};
    for(const l of lines){if(!l.ingredientId)continue;const qty=Number(l.qty);if(qty>0)clean[l.ingredientId]=(clean[l.ingredientId]||0)+qty}
    if(!Object.keys(clean).length){setMsg("สูตรต้องมีอย่างน้อย 1 รายการ");return}
    try{
      const intent=prepareRecipeMutationIntent(session.user.id,{requestKey:crypto.randomUUID(),operation:"publish",menuId,variant,items:clean});
      setPendingRecipeIntent(intent);
      await submitRecipeIntent(intent,false);
    }catch(e:any){setMsg(recipeError(e?.message||"recipe_recovery_unavailable"));if(e?.message==="recipe_recovery_unavailable")setRecipeRecoveryBlocked(true)}
  }
  async function reconcileApproved(d:Drift){
    if(recipeRecoveryBlocked){setMsg(recipeError("recipe_recovery_unavailable"));return}
    let existing:RecipeMutationIntent|null=null;
    try{existing=readRecipeMutationIntent(session.user.id)}
    catch{setRecipeRecoveryBlocked(true);setMsg(recipeError("recipe_recovery_unavailable"));return}
    if(existing){setPendingRecipeIntent(existing);await submitRecipeIntent(existing,true);return}
    if(!window.confirm("ปรับ "+d.menuName+" · "+d.variant+" ให้ตรง FIELD Approved Master? ระบบจะสร้าง Recipe Version ใหม่และเก็บ Audit เดิมไว้"))return;
    try{
      const intent=prepareRecipeMutationIntent(session.user.id,{requestKey:crypto.randomUUID(),operation:"reconcile",updateId:d.updateId});
      setPendingRecipeIntent(intent);
      await submitRecipeIntent(intent,false);
    }catch(e:any){setMsg(recipeError(e?.message||"recipe_recovery_unavailable"));if(e?.message==="recipe_recovery_unavailable")setRecipeRecoveryBlocked(true)}
  }
  async function saveComment(){
    if(!commentText.trim()||!authorName.trim())return;
    if(editing){
      setBusy(true);setMsg("");
      try{
        const body={authorType,authorName:authorName.trim(),text:commentText.trim()};
        await api("/api/admin/recipes/comments/"+encodeURIComponent(editing.id),{method:"PATCH",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)});
        setEditing(null);setCommentText("");if(authorType!=="owner")setAuthorName("");setMsg("บันทึกความคิดเห็นแล้ว");await load();
      }catch(e:any){setMsg(recipeError(e?.message||"request_failed"))}finally{setBusy(false)}
      return;
    }
    if(recipeRecoveryBlocked){setMsg(recipeError("recipe_recovery_unavailable"));return}
    let existing:RecipeMutationIntent|null=null;
    try{existing=readRecipeMutationIntent(session.user.id)}
    catch{setRecipeRecoveryBlocked(true);setMsg(recipeError("recipe_recovery_unavailable"));return}
    if(existing){setPendingRecipeIntent(existing);await submitRecipeIntent(existing,true);return}
    try{
      const intent=prepareRecipeMutationIntent(session.user.id,{requestKey:crypto.randomUUID(),operation:"commentCreate",menuId,variant,authorType,authorName:authorName.trim(),text:commentText.trim()});
      setPendingRecipeIntent(intent);
      await submitRecipeIntent(intent,false);
    }catch(e:any){setMsg(recipeError(e?.message||"recipe_recovery_unavailable"));if(e?.message==="recipe_recovery_unavailable")setRecipeRecoveryBlocked(true)}
  }
  function beginEdit(c:Comment){setEditing(c);setAuthorType(c.authorType);setAuthorName(c.authorName);setCommentText(c.text)}
  function cancelEdit(){setEditing(null);setCommentText("");setAuthorType("customer");setAuthorName("")}

  return <section className="soft-scroll h-full overflow-auto p-3 sm:p-5 md:p-7">
    <p className="gold m-0 text-[9px] font-bold tracking-[.26em] sm:text-[10px]">R&amp;D CONTROL</p><h1 className="mt-1 text-xl font-semibold sm:text-2xl">RECIPE VERSIONING</h1><p className="mt-1 text-xs text-slate-500">เลือกวัตถุดิบจาก Stock Master · ใส่ปริมาณที่ใช้จริง · ต้นทุนอัปเดตจากราคาซื้อล่าสุด</p>
    {(pendingRecipeIntent||recipeRecoveryBlocked)&&<div role="status" aria-live="polite" aria-atomic="true" className="mt-3 rounded-[20px] border-2 border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"><div className="flex flex-wrap items-center justify-between gap-2"><div><b>{recipeRecoveryBlocked?"ระบบป้องกัน Recipe ซ้ำใช้งานไม่ได้":"มีรายการ Recipe เดิมรอยืนยัน"}</b><p className="mt-1">{recipeRecoveryBlocked?"ระบบหยุดการเขียน Recipe ใหม่จนกว่าจะอ่าน recovery storage ได้":"ห้าม Publish/Reconcile/สร้าง Comment ใหม่แทน · ระบบจะใช้ Request เดิมจนกว่าจะรู้ผลแน่ชัด"}</p></div>{pendingRecipeIntent&&<button disabled={busy} onClick={()=>recoverRecipeMutation()} className="min-h-11 rounded-xl bg-amber-900 px-4 font-bold text-white disabled:opacity-40">ตรวจ Request เดิม</button>}</div></div>}
    {(data?.approvedDrift||[]).length>0&&<div className="mt-3 space-y-2">{data!.approvedDrift.map(d=><div key={d.updateId+":"+d.variant} className="rounded-[20px] border border-amber-300 bg-amber-50 p-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><b className="text-sm text-amber-900">สูตรยังไม่ตรง FIELD Approved Master</b><p className="mt-1 text-xs text-amber-800">{d.menuName} · {d.variant} · {Object.entries(d.from).map(([k,v])=>k+" "+v).join(" + ")} → {Object.entries(d.to).map(([k,v])=>k+" "+v).join(" + ")}</p></div><button disabled={busy||!!pendingRecipeIntent||recipeRecoveryBlocked} onClick={()=>reconcileApproved(d)} className="min-h-11 rounded-full bg-[#d4af37] px-4 text-xs font-bold text-black">ใช้สูตรอนุมัติ</button></div></div>)}</div>}

    <div className="mt-4 grid gap-3 xl:grid-cols-[.8fr_2fr]">
      <div className="glass card p-4"><label className="text-xs text-slate-500">เมนู</label><select value={menuId} onChange={e=>setMenuId(e.target.value)} className="mt-1 w-full rounded-2xl border bg-white px-3 py-3">{data?.menus.map(x=><option key={x.id} value={x.id}>{x.name}{x.enabled?" · เปิดขาย":" · Draft"}</option>)}</select><label className="mt-3 block text-xs text-slate-500">สูตร / Variant</label><select value={variant} onChange={e=>setVariant(e.target.value)} className="mt-1 w-full rounded-2xl border bg-white px-3 py-3">{menu?.variants.map(x=><option key={x.label}>{x.label}</option>)}</select><div className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm"><span className="text-slate-500">Recipe version</span><b className="ml-2">{currentVariant?.recipeVersion||"Legacy"}</b><div className="mt-2 flex justify-between"><span>ต้นทุนวัตถุดิบประมาณ</span><b className="text-[#765b08]">฿{recipeCost.toFixed(2)}</b></div></div><button disabled={busy||!!pendingRecipeIntent||recipeRecoveryBlocked||!menuId||!variant} onClick={publish} className="mt-3 min-h-12 w-full rounded-full bg-[#d4af37] font-bold text-black disabled:opacity-40">{busy?"กำลังบันทึก...":"PUBLISH NEW VERSION"}</button>{msg&&<p className="mt-3 rounded-xl bg-white px-3 py-2 text-center text-sm">{msg}</p>}</div>

      <div className="glass card p-4"><div className="flex items-center justify-between gap-2"><div><h2 className="text-sm font-semibold">รายการในสูตร</h2><p className="text-xs text-slate-500">เลือกจาก Stock Master เท่านั้น</p></div><button onClick={()=>setLines([...lines,{key:key(),ingredientId:"",qty:""}])} className="flex min-h-11 items-center gap-1 rounded-full border px-3 text-xs"><Plus size={14}/>เพิ่มรายการ</button></div>
        <div className="mt-3 space-y-2">{lines.map((l,index)=>{const ing=byId[l.ingredientId],lineCost=ing&&Number(l.qty)>0?Number(l.qty)*Number(ing.standardUnitCost||ing.unitCost||0):0;return <div key={l.key} className="rounded-2xl border bg-white p-3"><div className="grid gap-2 sm:grid-cols-[1fr_120px_44px]"><select value={l.ingredientId} onChange={e=>setLines(lines.map(x=>x.key===l.key?{...x,ingredientId:e.target.value}:x))} className="min-h-11 rounded-xl border bg-white px-3"><option value="">เลือกวัตถุดิบ/บรรจุภัณฑ์</option>{ingredients.map(i=><option key={i.id} value={i.id}>{i.name} · {i.unit}</option>)}</select><input inputMode="decimal" value={l.qty} onChange={e=>setLines(lines.map(x=>x.key===l.key?{...x,qty:e.target.value}:x))} placeholder="จำนวน" className="min-h-11 rounded-xl border bg-slate-50 px-3"/><button onClick={()=>setLines(lines.length===1?[{...l,ingredientId:"",qty:""}]:lines.filter(x=>x.key!==l.key))} className="grid min-h-11 place-items-center rounded-xl border border-red-200 text-red-600" aria-label={"ลบวัตถุดิบลำดับ "+(index+1)}><MinusCircle size={16}/></button></div>{ing&&<div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-slate-500"><span>คงเหลือ {ing.qty.toLocaleString()} {ing.unit} · ต้นทุนมาตรฐาน ฿{Number(ing.standardUnitCost||ing.unitCost||0).toFixed(4)}/{ing.unit}</span><b className="text-[#765b08]">รายการนี้ ฿{lineCost.toFixed(2)}</b></div>}{index===0&&lines.length===1&&!l.ingredientId&&<p className="mt-2 text-xs text-slate-400">เช่น Pure Matcha: ผงมัทฉะ 4 g → น้ำ 170 g → แก้ว/ฝา/น้ำแข็งตามสูตรที่ร้านกำหนด</p>}</div>})}</div>
      </div>
    </div>

    <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_1.25fr]">
      <div className="glass card p-4"><div className="flex items-start justify-between"><div><p className="gold text-[10px] tracking-[.25em]">R&amp;D NOTE</p><h2 className="mt-1 text-base">{editing?"แก้ไขความคิดเห็น":"เพิ่มความคิดเห็น"}</h2></div>{editing&&<button type="button" onClick={cancelEdit} className="grid h-11 w-11 place-items-center rounded-xl" aria-label="ยกเลิกการแก้ไขความคิดเห็น"><X size={18}/></button>}</div><div className="mt-3 grid grid-cols-3 gap-2">{([["customer","CUSTOMER"],["owner","OWNER"],["custom","CUSTOM"]] as const).map(([value,label])=><button key={value} onClick={()=>setAuthorType(value)} className={"min-h-11 rounded-full border text-[10px] font-bold "+(authorType===value?"border-[#d4af37] bg-[#d4af37] text-black":"border-slate-200 text-slate-600")}>{label}</button>)}</div><input value={authorName} onChange={e=>setAuthorName(e.target.value)} disabled={authorType==="owner"} placeholder="ชื่อผู้ให้ความเห็น" className="mt-3 w-full rounded-2xl border bg-slate-50 px-4 py-3"/><textarea value={commentText} onChange={e=>setCommentText(e.target.value)} maxLength={1000} placeholder="ผลการชิม / จุดที่ควรปรับ" className="mt-3 min-h-24 w-full rounded-2xl border bg-slate-50 px-4 py-3"/><button disabled={busy||(!editing&&(!!pendingRecipeIntent||recipeRecoveryBlocked))||commentText.trim().length<2||authorName.trim().length<1} onClick={saveComment} className="mt-3 min-h-11 w-full rounded-full bg-[#d4af37] font-bold text-black disabled:opacity-40">{editing?"UPDATE COMMENT":"SAVE COMMENT"}</button></div>
      <div className="glass card p-4"><h2 className="text-sm tracking-widest">COMMENT HISTORY</h2><div className="mt-3 space-y-2">{comments.map(c=><article key={c.id} className="rounded-2xl border bg-white p-3"><div className="flex justify-between"><div><span className="gold text-[10px] font-bold uppercase">{c.authorType}</span><b className="ml-2 text-sm">{c.authorName}</b></div><button type="button" onClick={()=>beginEdit(c)} className="grid h-11 w-11 place-items-center rounded-xl" aria-label={"แก้ไขความคิดเห็นของ "+c.authorName}><Pencil size={14}/></button></div><p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{c.text}</p><small className="mt-2 block text-slate-500">v{c.recipeVersion||"Legacy"} · {new Date(c.updatedAt||c.createdAt).toLocaleString("th-TH")}</small></article>)}{comments.length===0&&<p className="py-6 text-center text-sm text-slate-500">ยังไม่มีความคิดเห็น</p>}</div></div>
    </div>

    <div className="glass card mt-3 p-4"><h2 className="text-sm tracking-widest">VERSION HISTORY</h2><div className="mt-2 space-y-2">{(data?.versions||[]).slice(0,30).map((v:any)=><div key={v.id} className="flex justify-between rounded-xl bg-white p-3 text-sm"><span>{v.document?.menuName||v.menuId} · {v.document?.variant}</span><b className="gold">v{v.version}</b></div>)}</div></div>
  </section>;
}
