"use client";

import {useEffect,useRef,useState} from "react";
import {Plus,ShieldCheck,UserCog,X} from "lucide-react";
import AuthGate from "@/components/auth-gate";
import ModalFocus from "@/components/modal-focus";
import {api,type Session} from "@/lib/api-client";
import {operatorErrorFallback} from "@/lib/operator-error-language.mjs";
import {prepareUserCreateIntent,readUserCreateIntent,sendUserCreateIntent,type UserCreateIntent,type UserCreatePermissions} from "@/lib/user-create-recovery";

type Perms={order?:boolean;queue?:boolean;stock?:boolean;report?:boolean};
type User={id:string;username:string;role:"admin"|"staff";permissions:Perms;active:boolean;created_at?:number};
const keys=["order","queue","stock","report"] as const;
const fullPermissions=(value:Perms):UserCreatePermissions=>({order:value.order===true,queue:value.queue===true,stock:value.stock===true,report:value.report===true});

export default function Users(){return <AuthGate>{s=><View session={s}/>}</AuthGate>}

function View({session}:{session:Session}){
  const [rows,setRows]=useState<User[]>([]),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[msg,setMsg]=useState("");
  const [resetUser,setResetUser]=useState<User|null>(null),[resetPasswordValue,setResetPasswordValue]=useState("");
  const [username,setUsername]=useState(""),[password,setPassword]=useState(""),[role,setRole]=useState<"staff"|"admin">("staff"),[permissions,setPermissions]=useState<Perms>({order:true,queue:true});
  const [pendingCreate,setPendingCreate]=useState<UserCreateIntent|null>(null),[createRecoveryBlocked,setCreateRecoveryBlocked]=useState(false);
  const recoveryRef=useRef(false),passwordRef=useRef("");
  const load=()=>api<{users:User[]}>("/api/admin/users").then(x=>setRows(x.users));

  useEffect(()=>{passwordRef.current=password},[password]);
  useEffect(()=>{if(session.user.role==="admin")load().catch(()=>{})},[session.user.role]);

  function userError(code:string){
    const map:Record<string,string>={
      username_exists:"Username นี้มีอยู่แล้ว",
      invalid_user:"ข้อมูลผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
      staff_needs_order_or_queue:"Staff ต้องมีสิทธิ์ Order หรือ Queue อย่างน้อย 1 อย่าง",
      invalid_request_key:"ระบบสร้างรหัสป้องกัน User ซ้ำไม่สำเร็จ",
      pending_user_create_exists:"มีคำขอสร้าง User ก่อนหน้าที่ยังไม่ทราบผล · ต้องตรวจคำขอเดิมก่อน",
      user_create_password_required:"กรอกรหัสผ่านเดิมเพื่อยืนยันคำขอสร้าง User ที่ค้างอยู่",
      user_create_ack_unknown:"Server ยังยืนยันการสร้าง User เดิมไม่ครบ · ระบบเก็บ Request เดิมไว้ ห้ามสร้าง User ใหม่แทน",
      user_create_recovery_unavailable:"อ่าน/บันทึก recovery ของ User Create ไม่ได้ · ระบบหยุดสร้าง User ใหม่ชั่วคราว",
      user_create_secret_storage_blocked:"ระบบป้องกันไม่ให้บันทึกรหัสผ่านลง recovery storage",
      request_key_conflict:"ข้อมูลคำขอเดิมไม่ตรงกัน · ตรวจ username/role/สิทธิ์และกรอกรหัสผ่านเดิม",
      network_unavailable:"การเชื่อมต่อขาดระหว่างสร้าง User · ยังไม่ทราบผล ระบบเก็บ Request เดิมไว้",
      offline_write_blocked:"ออฟไลน์อยู่ · คำขอเดิมถูกเก็บไว้และจะตรวจเมื่อเชื่อมต่อ"
    };
    return map[code]||code;
  }

  function showIntent(intent:UserCreateIntent){
    setPendingCreate(intent);setOpen(true);setUsername(intent.body.username);setRole(intent.body.role);setPermissions({...intent.body.permissions});
  }

  async function submitUserIntent(intent:UserCreateIntent,secret:string,recovery=false){
    if(recoveryRef.current)return null;
    if(secret.length<10){showIntent(intent);setMsg(userError("user_create_password_required"));return null}
    recoveryRef.current=true;setBusy(true);setMsg("");
    try{
      const result=await sendUserCreateIntent(intent,secret,body=>api<any>("/api/admin/users",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)}));
      setPendingCreate(null);setCreateRecoveryBlocked(false);setOpen(false);setUsername("");setPassword("");passwordRef.current="";setRole("staff");setPermissions({order:true,queue:true});
      setMsg((recovery?"ตรวจคำขอเดิมแล้ว · ":"")+"สร้าง User แล้ว · "+String(result.user?.username||intent.body.username));
      await load().catch(()=>{});
      return result;
    }catch(e:any){
      try{
        const current=readUserCreateIntent(session.user.id);
        setPendingCreate(current);setCreateRecoveryBlocked(false);
        if(current)showIntent(current);
      }catch{setCreateRecoveryBlocked(true)}
      setMsg(userError(e?.message||"user_create_ack_unknown"));
      return null;
    }finally{recoveryRef.current=false;setBusy(false)}
  }

  async function recoverUserCreate(auto=false){
    if(recoveryRef.current)return;
    let intent:UserCreateIntent|null=null;
    try{intent=readUserCreateIntent(session.user.id);setPendingCreate(intent);setCreateRecoveryBlocked(false)}
    catch{setCreateRecoveryBlocked(true);setMsg(userError("user_create_recovery_unavailable"));return}
    if(!intent)return;
    showIntent(intent);
    if(typeof navigator!=="undefined"&&!navigator.onLine){setMsg("มีคำขอสร้าง User เดิมรอตรวจ · เมื่อออนไลน์ให้ใช้ Request เดิม");return}
    const secret=passwordRef.current;
    if(auto&&secret.length>=10){await submitUserIntent(intent,secret,true);return}
    setMsg(userError("user_create_password_required"));
  }

  useEffect(()=>{
    if(session.user.role!=="admin")return;
    let disposed=false;
    const recover=()=>{if(!disposed)recoverUserCreate(true).catch(()=>{})};
    const visible=()=>{if(document.visibilityState==="visible")recover()};
    recover();
    window.addEventListener("online",recover);window.addEventListener("focus",recover);document.addEventListener("visibilitychange",visible);
    return()=>{disposed=true;window.removeEventListener("online",recover);window.removeEventListener("focus",recover);document.removeEventListener("visibilitychange",visible)};
  },[session.user.id,session.csrf,session.user.role]);

  if(session.user.role!=="admin")return <div className="grid h-full place-items-center text-slate-500">Admin permission required</div>;

  async function create(){
    if(role==="staff"&&!permissions.order&&!permissions.queue){setMsg(userError("staff_needs_order_or_queue"));return}
    if(createRecoveryBlocked){setMsg(userError("user_create_recovery_unavailable"));return}
    let existing:UserCreateIntent|null=null;
    try{existing=readUserCreateIntent(session.user.id)}
    catch{setCreateRecoveryBlocked(true);setMsg(userError("user_create_recovery_unavailable"));return}
    if(existing){showIntent(existing);await submitUserIntent(existing,password,true);return}
    try{
      const intent=prepareUserCreateIntent(session.user.id,{
        requestKey:crypto.randomUUID(),username,role,
        permissions:role==="staff"?fullPermissions(permissions):fullPermissions({})
      });
      setPendingCreate(intent);
      await submitUserIntent(intent,password,false);
    }catch(e:any){
      setMsg(userError(e?.message||"user_create_recovery_unavailable"));
      if(e?.message==="user_create_recovery_unavailable")setCreateRecoveryBlocked(true);
    }
  }

  async function patch(id:string,body:any){
    setBusy(true);setMsg("");
    try{await api("/api/admin/users/"+id,{method:"PATCH",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify(body)});await load()}
    catch(e:any){setMsg(operatorErrorFallback(e?.message,"ผู้ใช้"))}
    finally{setBusy(false)}
  }
  function openPasswordReset(user:User){setResetUser(user);setResetPasswordValue("");setMsg("")}
  function closePasswordReset(){if(busy)return;setResetUser(null);setResetPasswordValue("")}
  async function submitPasswordReset(){
    if(!resetUser||resetPasswordValue.length<10)return;
    const id=resetUser.id;
    await patch(id,{password:resetPasswordValue});
    setResetUser(null);setResetPasswordValue("");setMsg("รีเซ็ตรหัสผ่านแล้ว · "+resetUser.username);
  }

  return <section className="soft-scroll h-full overflow-auto p-5 md:p-7">
    <header className="flex items-end justify-between gap-4">
      <div><p className="gold m-0 text-[10px] font-bold tracking-[.3em]">ACCESS CONTROL</p><h1 className="mt-1 text-2xl font-semibold">USERS &amp; PERMISSIONS</h1></div>
      <button disabled={busy||!!pendingCreate||createRecoveryBlocked} onClick={()=>setOpen(true)} className="flex min-h-11 items-center gap-2 rounded-full bg-[#d4af37] px-4 text-sm font-bold text-black disabled:opacity-40"><Plus size={16}/>ADD USER</button>
    </header>

    {(pendingCreate||createRecoveryBlocked)&&<div role="status" aria-live="polite" aria-atomic="true" className="mt-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><b>{createRecoveryBlocked?"ระบบ recovery ของ User Create ใช้งานไม่ได้":"มีคำขอสร้าง User เดิมรอยืนยัน"}</b><p className="mt-1">{createRecoveryBlocked?"ระบบหยุดสร้างบัญชีใหม่ชั่วคราว":"ระบบไม่เก็บรหัสผ่านไว้ · กรอกรหัสผ่านเดิมเพื่อ replay Request เดิม ห้ามสร้าง User ใหม่แทน"}</p></div>
      {pendingCreate&&<button disabled={busy} onClick={()=>recoverUserCreate(false)} className="min-h-11 rounded-xl bg-amber-900 px-4 font-bold text-white disabled:opacity-40">ตรวจคำขอเดิม</button>}</div>
    </div>}
    {msg&&<div className="mt-4 rounded-2xl border border-slate-200 p-3 text-sm">{msg}</div>}

    <div className="mt-5 grid gap-3 lg:grid-cols-2">{rows.map(u=><div key={u.id} className="glass card p-5">
      <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><UserCog size={17} className="gold"/><b>{u.username}</b></div><small className="mt-1 block text-slate-500">{u.role.toUpperCase()} · {u.active?"ACTIVE":"DISABLED"}</small></div>
      {u.id!==session.user.id&&<button disabled={busy} onClick={()=>patch(u.id,{active:!u.active})} className={"min-h-11 rounded-full border px-3 text-xs "+(u.active?"border-red-400/30 text-red-600":"border-emerald-400/30 text-emerald-700")}>{u.active?"DISABLE":"ENABLE"}</button>}</div>
      {u.role==="staff"&&<div className="mt-4 grid grid-cols-2 gap-2">{keys.map(k=><label key={k} className="flex min-h-11 items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs uppercase"><span>{k}</span><input type="checkbox" checked={!!u.permissions?.[k]} onChange={e=>patch(u.id,{permissions:{...u.permissions,[k]:e.target.checked}})}/></label>)}</div>}
      <button disabled={busy} onClick={()=>openPasswordReset(u)} className="mt-4 min-h-11 w-full rounded-full border border-slate-200 text-xs">RESET PASSWORD</button>
    </div>)}</div>

    {resetUser&&<div className="field-modal-overlay fixed inset-0 z-[82] grid place-items-center bg-black/70 p-4">
      <ModalFocus labelId="user-reset-password-title" onEscape={busy?undefined:closePasswordReset} className="field-modal-panel glass card w-full max-w-md p-6">
        <div className="flex items-start justify-between gap-3"><div><p className="gold text-[10px] tracking-[.25em]">SECURITY</p><h3 id="user-reset-password-title" className="mt-1 text-xl">รีเซ็ตรหัสผ่าน</h3><p className="mt-1 text-xs text-slate-500">{resetUser.username} · ใช้รหัสผ่านใหม่อย่างน้อย 10 ตัวอักษร</p></div><button type="button" disabled={busy} onClick={closePasswordReset} aria-label="ปิดการรีเซ็ตรหัสผ่าน" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl disabled:opacity-40"><X size={18}/></button></div>
        <label className="mt-5 block text-xs font-semibold text-slate-600" htmlFor="field-user-reset-password">รหัสผ่านใหม่</label>
        <input id="field-user-reset-password" type="password" autoComplete="new-password" value={resetPasswordValue} onChange={e=>setResetPasswordValue(e.target.value)} placeholder="อย่างน้อย 10 ตัวอักษร" className="mt-2 min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4"/>
        <p className="mt-2 text-xs text-slate-500">การรีเซ็ตรหัสผ่านจะทำให้ Session เดิมของผู้ใช้นี้ออกจากระบบตามกลไกฝั่ง Server</p>
        <div className="mt-5 grid grid-cols-2 gap-2"><button type="button" disabled={busy} onClick={closePasswordReset} className="min-h-12 rounded-full border border-slate-300 bg-white px-4 text-sm font-bold disabled:opacity-40">ยกเลิก</button><button type="button" disabled={busy||resetPasswordValue.length<10} onClick={submitPasswordReset} className="min-h-12 rounded-full bg-[#d4af37] px-4 text-sm font-bold text-black disabled:opacity-40">{busy?"กำลังบันทึก...":"ยืนยันรีเซ็ต"}</button></div>
      </ModalFocus>
    </div>}

    {open&&<div className="field-modal-overlay fixed inset-0 z-[80] grid place-items-center bg-black/70 p-4">
      <ModalFocus labelId="user-create-title" onEscape={busy||!!pendingCreate?undefined:()=>setOpen(false)} className="field-modal-panel glass card w-full max-w-md p-6">
        <div className="flex justify-between"><div><p className="gold text-[10px] tracking-[.25em]">NEW ACCOUNT</p><h3 id="user-create-title" className="mt-1 text-xl">Create User</h3></div><button disabled={busy||!!pendingCreate} aria-label="ปิดการสร้างผู้ใช้" onClick={()=>setOpen(false)} className="grid h-11 w-11 place-items-center rounded-xl disabled:opacity-40"><X/></button></div>
        {pendingCreate&&<div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"><b>Resume Request เดิม</b><p className="mt-1">username / role / permissions ถูกล็อกไว้ แต่รหัสผ่านไม่ได้ถูกเก็บในเครื่อง กรุณากรอกรหัสผ่านเดิมแล้วกดตรวจคำขอเดิม</p></div>}
        <div className="mt-5 grid gap-3">
          <input disabled={!!pendingCreate} value={username} onChange={e=>setUsername(e.target.value.toLowerCase())} placeholder="username" className="min-h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 disabled:opacity-70"/>
          <input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder={pendingCreate?"กรอกรหัสผ่านเดิมเพื่อยืนยัน":"รหัสผ่าน ≥ 10 ตัวอักษร"} className="min-h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4"/>
          <select disabled={!!pendingCreate} value={role} onChange={e=>setRole(e.target.value as "staff"|"admin")} className="min-h-12 rounded-2xl border border-slate-200 bg-white px-4 disabled:opacity-70"><option value="staff">Staff</option><option value="admin">Admin</option></select>
          {role==="staff"&&<div className="grid grid-cols-2 gap-2">{keys.map(k=><label key={k} className="flex min-h-11 items-center justify-between rounded-2xl border border-slate-100 p-3 text-xs uppercase"><span>{k}</span><input disabled={!!pendingCreate} type="checkbox" checked={!!permissions[k]} onChange={e=>setPermissions({...permissions,[k]:e.target.checked})}/></label>)}</div>}
          <div className="rounded-2xl bg-slate-50 p-3 text-xs text-slate-600"><ShieldCheck size={15} className="mb-2 text-emerald-700"/>Staff ต้องมีอย่างน้อย Order หรือ Queue เพื่อใช้งานหน้าร้าน</div>
          <button disabled={busy||username.length<3||password.length<10||(role==="staff"&&!permissions.order&&!permissions.queue)} onClick={create} className="min-h-12 rounded-full bg-[#d4af37] py-3 font-bold text-black disabled:opacity-40">{busy?"กำลังตรวจ…":pendingCreate?"ตรวจคำขอเดิม":"CREATE USER"}</button>
        </div>
      </ModalFocus>
    </div>}
  </section>;
}
