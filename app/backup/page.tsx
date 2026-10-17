"use client";
import {useEffect,useRef,useState} from "react";
import {Download,ShieldCheck,Upload} from "lucide-react";
import AuthGate from "@/components/auth-gate";
import {api,type Session} from "@/lib/api-client";
import {assertBackupRestoreAck,clearBackupRestoreIntent,prepareBackupRestoreIntent,readBackupRestoreIntent,restoreBody} from "@/lib/backup-restore-recovery.mjs";
import {operatorErrorFallback} from "@/lib/operator-error-language.mjs";

type Preview={recordCounts:Record<string,number>;dataVersion?:string;schemaVersion:number;fingerprint:string};
type Pending={version:1;actorId:string;requestKey:string;fingerprint:string;expectedRevision:number;createdAt:number};

export default function Backup(){return <AuthGate>{s=><View session={s}/>}</AuthGate>}

function View({session}:{session:Session}){
  const [file,setFile]=useState<File|null>(null);
  const [preview,setPreview]=useState<Preview|null>(null);
  const [backup,setBackup]=useState<any>(null);
  const [revision,setRevision]=useState(0);
  const [replace,setReplace]=useState(false);
  const [msg,setMsg]=useState("");
  const [busy,setBusy]=useState(false);
  // State disables controls on render; the ref also rejects same-turn duplicate actions.
  const actionInFlight=useRef(false);
  const [pending,setPending]=useState<Pending|null>(null);

  useEffect(()=>{
    try{setPending(readBackupRestoreIntent(session.user.id) as Pending|null)}
    catch{setMsg("ยังอ่านสถานะกู้คืนเดิมไม่ได้ · ห้ามเริ่ม Restore ใหม่จนกว่าจะตรวจพื้นที่เก็บข้อมูลของเบราว์เซอร์")}
  },[session.user.id]);

  if(session.user.role!=="admin")return <div className="grid h-full place-items-center text-slate-500">Admin permission required</div>;

  async function exportData(){
    if(actionInFlight.current)return;
    actionInFlight.current=true;
    setBusy(true);setMsg("");
    try{
      const r=await api<any>("/api/admin/backup/export");
      const blob=new Blob([JSON.stringify(r,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");
      a.href=url;a.download="field-pos-full-backup-"+new Date().toISOString().slice(0,10)+".json";a.click();URL.revokeObjectURL(url);
      setMsg("ส่งออก Full Backup สำเร็จ");
    }catch(e:any){setMsg(operatorErrorFallback(e?.message,"การส่งออกข้อมูลสำรอง"))}
    finally{actionInFlight.current=false;setBusy(false)}
  }

  async function inspect(f:File){
    if(actionInFlight.current)return;
    actionInFlight.current=true;setBusy(true);
    setFile(f);setPreview(null);setBackup(null);setReplace(false);setRevision(0);setMsg("");
    try{
      const candidate=JSON.parse(await f.text());
      const p=await api<Preview>("/api/admin/backup/preview",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({backup:candidate})});
      const existing=readBackupRestoreIntent(session.user.id) as Pending|null;
      setPending(existing);
      if(existing){
        setBackup(candidate);setPreview(p);
        if(existing.fingerprint!==p.fingerprint){
          setRevision(existing.expectedRevision);
          setMsg("มี Restore เดิมที่ยังไม่ทราบผล · ไฟล์นี้ไม่ใช่ไฟล์เดิม จึงห้ามเริ่ม Restore ใหม่");
          return;
        }
        setRevision(existing.expectedRevision);
        setMsg("พบ Restore เดิมที่ยังไม่ทราบผล · ตรวจไฟล์ตรงกันแล้ว กด Restore เพื่อ replay คำขอเดิมอย่างปลอดภัย");
        return;
      }
      const meta=await api<any>("/api/state/meta");
      if(!Number.isSafeInteger(meta.revision)||meta.revision<0)throw new Error("invalid_backup_revision");
      setRevision(meta.revision);setBackup(candidate);setPreview(p);
    }catch(e:any){
      setBackup(null);setPreview(null);setReplace(false);
      setMsg(e instanceof SyntaxError?"อ่านไฟล์ JSON ไม่ได้ · กรุณาเลือกไฟล์ข้อมูลสำรองที่สมบูรณ์":operatorErrorFallback(e?.message,"การตรวจไฟล์ข้อมูลสำรอง"));
    }finally{actionInFlight.current=false;setBusy(false)}
  }

  async function restore(){
    if(actionInFlight.current||!backup||!preview||!replace)return;
    actionInFlight.current=true;
    setBusy(true);setMsg("");
    let intent:Pending|null=null;
    try{
      const existing=readBackupRestoreIntent(session.user.id) as Pending|null;
      if(existing&&existing.fingerprint!==preview.fingerprint)throw new Error("pending_backup_restore_exists");
      intent=(existing||prepareBackupRestoreIntent(session.user.id,{
        requestKey:crypto.randomUUID(),fingerprint:preview.fingerprint,expectedRevision:revision
      })) as Pending;
      setPending(intent);
      const r=await api<any>("/api/admin/backup/restore",{method:"POST",headers:{"X-CSRF-Token":session.csrf},body:JSON.stringify({...restoreBody(intent,backup),confirm:true})});
      assertBackupRestoreAck(intent,r);
      clearBackupRestoreIntent(session.user.id,intent.requestKey);
      setPending(null);setMsg("กู้คืน Full Backup สำเร็จ · revision "+r.revision+(r.replayed?" · ยืนยันผลคำขอเดิมแล้ว":""));
      setPreview(null);setFile(null);setBackup(null);setReplace(false);
    }catch(e:any){
      // Only clear automatically when the server proves the request never committed.
      // Durable replay is checked before revision conflict on the server.
      if(intent&&e?.message==="revision_conflict"){
        try{clearBackupRestoreIntent(session.user.id,intent.requestKey);setPending(null)}catch{}
      }
      const code=String(e?.message||"");
      setMsg(code==="pending_backup_restore_exists"
        ?"มี Restore เดิมที่ยังไม่ทราบผล · ต้องใช้ไฟล์เดิมเพื่อตรวจซ้ำ ห้ามสร้าง Restore ใหม่"
        :code==="backup_restore_ack_unknown"||code==="network_unavailable"
          ?"การเชื่อมต่อขาดหรือ ACK ไม่ชัดเจน · เก็บ request เดิมไว้แล้ว กรุณาใช้ไฟล์เดิมกด Restore ซ้ำเพื่อตรวจผล ห้ามเริ่มคำขอใหม่"
          :code==="revision_conflict"
            ?"ข้อมูลบนเซิร์ฟเวอร์เปลี่ยนแล้วและไม่พบ replay ของคำขอนี้ · กรุณาตรวจไฟล์ใหม่"
            :operatorErrorFallback(code,"การกู้คืนข้อมูลสำรอง"));
    }finally{actionInFlight.current=false;setBusy(false)}
  }

  const pendingMismatch=!!pending&&!!preview&&pending.fingerprint!==preview.fingerprint;
  return <section className="soft-scroll h-full overflow-auto p-5 md:p-7">
    <p className="gold m-0 text-[10px] font-bold tracking-[.3em]">DISASTER RECOVERY</p>
    <h1 className="mt-1 text-2xl font-semibold">FULL BACKUP / RESTORE</h1>
    {pending&&<div role="alert" className="mt-4 max-w-4xl rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <b>มี Restore เดิมที่ยังต้องยืนยันผล</b>
      <p className="mt-1 text-xs">Request {pending.requestKey} · ห้ามเริ่ม Restore ด้วยไฟล์อื่น ให้เลือกไฟล์เดิมแล้ว replay คำขอเดิม</p>
    </div>}
    <div className="mt-5 grid max-w-4xl gap-4 lg:grid-cols-2">
      <div className="glass card p-6">
        <Download className="gold"/><h2 className="mt-4 text-lg">Export Full Backup</h2>
        <p className="mt-2 text-sm text-slate-600">รวม State, Stock Ledger, Cost Snapshots, Recipe Versions, Purchase Records และ Cost History ในไฟล์เดียว</p>
        <button disabled={busy} onClick={exportData} className="mt-5 w-full rounded-full bg-[#d4af37] py-3 font-bold text-black disabled:opacity-40">DOWNLOAD FULL BACKUP</button>
      </div>
      <div className="glass card p-6">
        <Upload className="gold"/><h2 className="mt-4 text-lg">Restore Preview</h2>
        <p className="mt-2 text-sm text-slate-600">ตรวจ Schema, จำนวนข้อมูล, fingerprint และความสัมพันธ์ก่อนเขียนทุกตารางพร้อมกันใน Transaction เดียว</p>
        <label className="mt-5 block cursor-pointer rounded-[22px] border border-dashed border-slate-300 p-5 text-center text-sm text-slate-600">
          <input type="file" aria-label="เลือกไฟล์ข้อมูลสำรอง" disabled={busy} accept="application/json,.json" className="hidden" onChange={e=>{const f=e.target.files?.[0];e.target.value="";if(f)void inspect(f)}}/>
          {file?.name||"เลือกไฟล์ Full Backup JSON"}
        </label>
        {preview&&<div className="mt-4 rounded-[22px] bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-emerald-700"><ShieldCheck size={16}/><b>FULL DR PREVIEW PASSED · Schema {preview.schemaVersion}</b></div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">{Object.entries(preview.recordCounts||{}).map(([k,v])=><div key={k} className="flex justify-between"><span>{k}</span><b className="text-slate-900">{v}</b></div>)}</div>
          <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={replace} disabled={busy||pendingMismatch} onChange={e=>setReplace(e.target.checked)}/>ยืนยันแทน State และ Ledger ปัจจุบัน revision {revision}</label>
          <button disabled={busy||!replace||pendingMismatch} onClick={restore} className="mt-4 w-full rounded-full border border-red-400/30 py-3 font-bold text-red-700 disabled:opacity-30">{pending?"RETRY SAME RESTORE":"RESTORE FULL BACKUP"}</button>
        </div>}
      </div>
    </div>
    {msg&&<div role="status" className="mt-4 max-w-4xl rounded-2xl border border-slate-200 p-4 text-sm">{msg}</div>}
  </section>
}
