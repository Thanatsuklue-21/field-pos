"use client";

import {useEffect,useMemo,useState} from "react";
import {Pencil,X} from "lucide-react";
import AuthGate from "@/components/auth-gate";
import {api,type Session} from "@/lib/api-client";

type Ingredient={id:string;name:string;unit:string;qty:number;unitCost:number};
type Variant={label:string;recipeVersion:number|null;recipe:{items:Record<string,number>}};
type Menu={id:string;name:string;enabled:boolean;variants:Variant[]};
type Comment={id:string;menuId:string;variant:string;recipeVersion:number|null;authorType:"customer"|"owner"|"custom";authorName:string;text:string;createdAt:number;updatedAt:number;history?:{text:string;authorName:string;authorType:string;updatedAt:number}[]};
type Data={ingredients:Ingredient[];menus:Menu[];versions:any[];comments:Comment[]};

export default function Recipes(){return <AuthGate>{s=><View session={s}/>}</AuthGate>}

function View({session}:{session:Session}){
  const [data,setData]=useState<Data|null>(null),[menuId,setMenuId]=useState(""),[variant,setVariant]=useState(""),[items,setItems]=useState<Record<string,string>>({}),[msg,setMsg]=useState("");
  const [authorType,setAuthorType]=useState<Comment["authorType"]>("customer"),[authorName,setAuthorName]=useState(""),[commentText,setCommentText]=useState(""),[editing,setEditing]=useState<Comment|null>(null),[busy,setBusy]=useState(false);
  const load=()=>api<Data>("/api/admin/recipes").then(d=>{setData(d);if(!menuId&&d.menus[0])setMenuId(d.menus[0].id)});
  useEffect(()=>{if(session.user.role==="admin")load().catch(()=>{})},[]);
  const menu=useMemo(()=>data?.menus.find(x=>x.id===menuId)||null,[data,menuId]);
  const currentVariant=menu?.variants.find(x=>x.label===variant)||null;
  const comments=useMemo(()=>(data?.comments||[]).filter(x=>x.menuId===menuId&&x.variant===variant),[data,menuId,variant]);
  useEffect(()=>{if(menu){const v=menu.variants[0];setVariant(v?.label||"");setItems(Object.fromEntries(Object.entries(v?.recipe?.items||{}).map(([k,v])=>[k,String(v)]))) }},[menuId,data?.menus]);
  useEffect(()=>{if(menu){const v=menu.variants.find(x=>x.label===variant);setItems(Object.fromEntries(Object.entries(v?.recipe?.items||{}).map(([k,v])=>[k,String(v)]))) }},[variant]);
  useEffect(()=>{if(authorType==="owner")setAuthorName(session.user.username);else if(authorName===session.user.username)setAuthorName("")},[authorType]);
  if(session.user.role!=="admin")return <div className="grid h-full place-items-center text-neutral-500">Admin permission required</div>;

  async function publish(){
    const clean:Record<string,number>={};for(const [k,v] of Object.entries(items)){const n=Number(v);if(n>0)clean[k]=n}
    const r=await api<any>("/api/admin/recipes/publish",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({menuId,variant,items:clean})});
    setMsg("Published v"+r.version);await load();
  }

  async function saveComment(){
    if(!commentText.trim()||!authorName.trim())return;setBusy(true);setMsg("");
    try{
      const body={authorType,authorName:authorName.trim(),text:commentText.trim()};
      if(editing)await api("/api/admin/recipes/comments/"+encodeURIComponent(editing.id),{method:"PATCH",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)});
      else await api("/api/admin/recipes/comments",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({...body,menuId,variant})});
      setEditing(null);setCommentText("");if(authorType!=="owner")setAuthorName("");setMsg("บันทึกความคิดเห็นแล้ว");await load();
    }catch(e:any){setMsg(e.message||"บันทึกไม่สำเร็จ")}finally{setBusy(false)}
  }

  function beginEdit(c:Comment){setEditing(c);setAuthorType(c.authorType);setAuthorName(c.authorName);setCommentText(c.text)}
  function cancelEdit(){setEditing(null);setCommentText("");setAuthorType("customer");setAuthorName("")}

  return <section className="soft-scroll h-full overflow-auto p-5 md:p-7">
    <p className="gold m-0 text-[10px] font-bold tracking-[.3em]">R&amp;D CONTROL</p><h1 className="mt-1 text-2xl font-semibold">RECIPE VERSIONING</h1>
    <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_2fr]">
      <div className="glass card p-5"><label className="text-xs text-neutral-500">Menu</label><select value={menuId} onChange={e=>setMenuId(e.target.value)} className="mt-2 w-full rounded-2xl border border-white/10 bg-[#111] px-4 py-3">{data?.menus.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select><label className="mt-4 block text-xs text-neutral-500">Variant</label><select value={variant} onChange={e=>setVariant(e.target.value)} className="mt-2 w-full rounded-2xl border border-white/10 bg-[#111] px-4 py-3">{menu?.variants.map(x=><option key={x.label}>{x.label}</option>)}</select><p className="mt-4 text-xs text-neutral-500">Current version: {currentVariant?.recipeVersion||"Legacy / unversioned"}</p><button onClick={publish} className="mt-5 w-full rounded-full bg-[#d4af37] py-3 font-bold text-black">PUBLISH NEW VERSION</button>{msg&&<p className="mt-3 text-center text-sm text-emerald-300">{msg}</p>}</div>
      <div className="glass card p-5"><h2 className="text-sm tracking-widest">INGREDIENTS</h2><div className="mt-4 grid gap-2 md:grid-cols-2">{data?.ingredients.map(i=><label key={i.id} className="rounded-[20px] border border-white/5 bg-white/[.02] p-3"><span className="text-sm">{i.name}</span><small className="ml-2 text-neutral-500">{i.unit}</small><input inputMode="decimal" value={items[i.id]||""} onChange={e=>setItems({...items,[i.id]:e.target.value})} placeholder="0" className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 outline-none"/></label>)}</div></div>
    </div>

    <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1.25fr]">
      <div className="glass card p-5"><div className="flex items-start justify-between"><div><p className="gold text-[10px] tracking-[.25em]">R&amp;D NOTE</p><h2 className="mt-1 text-base">{editing?"แก้ไขความคิดเห็น":"เพิ่มความคิดเห็น"}</h2></div>{editing&&<button onClick={cancelEdit}><X size={18}/></button>}</div><div className="mt-4 grid grid-cols-3 gap-2">{([["customer","CUSTOMER"],["owner","OWNER"],["custom","CUSTOM"]] as const).map(([value,label])=><button key={value} onClick={()=>setAuthorType(value)} className={"rounded-full border py-2 text-[10px] font-bold "+(authorType===value?"border-[#d4af37] bg-[#d4af37] text-black":"border-white/10 text-neutral-400")}>{label}</button>)}</div><input value={authorName} onChange={e=>setAuthorName(e.target.value)} disabled={authorType==="owner"} placeholder={authorType==="customer"?"ชื่อลูกค้าหรือรหัสผู้ทดสอบ":"ชื่อผู้ให้ความเห็น"} className="mt-3 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 outline-none disabled:opacity-60"/><textarea value={commentText} onChange={e=>setCommentText(e.target.value)} maxLength={1000} placeholder="ผลการชิม สิ่งที่ชอบ หรือจุดที่ควรปรับ" className="mt-3 min-h-28 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 outline-none"/><p className="mt-2 text-xs text-neutral-500">ความคิดเห็นนี้จะผูกกับ {menu?.name||"เมนู"} · {variant||"สูตร"} · recipeVersion {currentVariant?.recipeVersion||"Legacy"}</p><button disabled={busy||commentText.trim().length<2||authorName.trim().length<1} onClick={saveComment} className="mt-4 w-full rounded-full bg-[#d4af37] py-3 font-bold text-black disabled:opacity-40">{busy?"SAVING...":editing?"UPDATE COMMENT":"SAVE COMMENT"}</button></div>
      <div className="glass card p-5"><h2 className="text-sm tracking-widest">COMMENT HISTORY</h2><div className="mt-3 space-y-3">{comments.map(c=><article key={c.id} className="rounded-2xl border border-white/5 bg-white/[.025] p-4"><div className="flex items-start justify-between gap-3"><div><span className="gold text-[10px] font-bold uppercase tracking-widest">{c.authorType}</span><h3 className="mt-1 text-sm font-semibold">{c.authorName}</h3></div><button onClick={()=>beginEdit(c)} className="grid h-8 w-8 place-items-center rounded-full border border-white/10"><Pencil size={13}/></button></div><p className="mt-3 whitespace-pre-wrap text-sm text-neutral-300">{c.text}</p><div className="mt-3 flex flex-wrap gap-2 text-[10px] text-neutral-500"><span>v{c.recipeVersion||"Legacy"}</span><span>{new Date(c.updatedAt||c.createdAt).toLocaleString("th-TH")}</span>{(c.history?.length||0)>0&&<span>แก้ไขแล้ว {c.history!.length} ครั้ง</span>}</div>{(c.history?.length||0)>0&&<details className="mt-3 text-xs text-neutral-500"><summary className="cursor-pointer">ดูข้อความก่อนแก้</summary><div className="mt-2 space-y-2">{c.history!.slice().reverse().map((h,i)=><div key={i} className="rounded-xl bg-black/20 p-3"><p className="text-neutral-400">{h.text}</p><small>{h.authorName} · {new Date(h.updatedAt).toLocaleString("th-TH")}</small></div>)}</div></details>}</article>)}{comments.length===0&&<p className="py-8 text-center text-sm text-neutral-500">ยังไม่มีความคิดเห็นสำหรับสูตรนี้</p>}</div></div>
    </div>

    <div className="glass card mt-4 p-5"><h2 className="text-sm tracking-widest">VERSION HISTORY</h2><div className="mt-3 space-y-2">{(data?.versions||[]).slice(0,30).map((v:any)=><div key={v.id} className="flex justify-between rounded-2xl bg-white/[.025] p-3 text-sm"><span>{v.document?.menuName||v.menuId} · {v.document?.variant}</span><b className="gold">v{v.version}</b></div>)}</div></div>
  </section>
}
