import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {
  prepareBackupRestoreIntent,readBackupRestoreIntent,clearBackupRestoreIntent,
  restoreBody,assertBackupRestoreAck
} from "../lib/backup-restore-recovery.mjs";

function memoryStorage(){
  const map=new Map();
  return {
    getItem:k=>map.has(k)?map.get(k):null,
    setItem:(k,v)=>map.set(k,String(v)),
    removeItem:k=>map.delete(k)
  };
}
const fingerprint="a".repeat(64);

test("backup restore intent persists request identity without storing backup payload",()=>{
  const storage=memoryStorage();
  const intent=prepareBackupRestoreIntent("admin-1",{requestKey:"restore:req:0001",fingerprint,expectedRevision:7},storage);
  const read=readBackupRestoreIntent("admin-1",storage);
  assert.equal(read.requestKey,intent.requestKey);
  assert.equal(read.fingerprint,fingerprint);
  assert.equal(read.expectedRevision,7);
  assert.equal("backup" in read,false);
  const body=restoreBody(read,{schemaVersion:5,fieldState:{document:{}}});
  assert.equal(body.requestKey,intent.requestKey);
  assert.equal(body.backupFingerprint,fingerprint);
  assert.equal(body.expectedRevision,7);
  assert.equal(body.confirm,true);
});

test("pending backup restore cannot be silently replaced with another fingerprint or revision",()=>{
  const storage=memoryStorage();
  prepareBackupRestoreIntent("admin-1",{requestKey:"restore:req:0001",fingerprint,expectedRevision:7},storage);
  assert.throws(()=>prepareBackupRestoreIntent("admin-1",{requestKey:"restore:req:0002",fingerprint:"b".repeat(64),expectedRevision:7},storage),/pending_backup_restore_exists/);
  assert.throws(()=>prepareBackupRestoreIntent("admin-1",{requestKey:"restore:req:0002",fingerprint,expectedRevision:8},storage),/pending_backup_restore_exists/);
});

test("backup restore intent clears only after exact acknowledged identity",()=>{
  const storage=memoryStorage();
  const intent=prepareBackupRestoreIntent("admin-1",{requestKey:"restore:req:0001",fingerprint,expectedRevision:7},storage);
  assert.throws(()=>assertBackupRestoreAck(intent,{ok:true,requestKey:intent.requestKey,performedBy:"other",fingerprint,revision:8}),/backup_restore_ack_unknown/);
  assertBackupRestoreAck(intent,{ok:true,requestKey:intent.requestKey,performedBy:"admin-1",fingerprint,revision:8,replayed:true});
  clearBackupRestoreIntent("admin-1",intent.requestKey,storage);
  assert.equal(readBackupRestoreIntent("admin-1",storage),null);
});

test("backup restore API replays durable request before revision conflict and records identity atomically",async()=>{
  const api=await readFile(new URL("../lib/api.mjs",import.meta.url),"utf8");
  const start=api.indexOf("if(path==='/api/admin/backup/restore'");
  const end=api.indexOf("if(path==='/api/admin/audit'",start);
  const block=api.slice(start,end);
  assert.match(block,/invalid_request_key/);
  assert.match(block,/backup_fingerprint_mismatch/);
  assert.match(block,/operation:'fullBackupRestore'/);
  assert.match(block,/replayDurableRequest\(tx,currentDoc,requestKey,context\)/);
  assert.ok(block.indexOf("replayDurableRequest")<block.indexOf("Number(current.revision)!==revision"));
  assert.match(block,/rememberDurableRequestStatement\(nextDoc,requestKey,response,context,now\)/);
  assert.match(block,/await tx\.execute\(requestStatement\)/);
  assert.match(block,/full_backup_restore/);
  assert.match(block,/await tx\.commit\(\);return reply\(res,200,\{\.\.\.response,replayed:false\}\)/);
});

test("backup restore UI keeps the original request on unknown acknowledgement",async()=>{
  const ui=await readFile(new URL("../app/backup/page.tsx",import.meta.url),"utf8");
  assert.match(ui,/readBackupRestoreIntent/);
  assert.match(ui,/prepareBackupRestoreIntent/);
  assert.match(ui,/assertBackupRestoreAck/);
  assert.match(ui,/RETRY SAME RESTORE/);
  assert.match(ui,/ห้ามเริ่ม Restore ด้วยไฟล์อื่น/);
  assert.match(ui,/backup_restore_ack_unknown/);
});


test("backup UI does not discard pending recovery on a generic HTTP 400",async()=>{
  const ui=await readFile(new URL("../app/backup/page.tsx",import.meta.url),"utf8");
  assert.match(ui,/e\?\.message==="revision_conflict"/);
  assert.doesNotMatch(ui,/\[400\]\.includes\(Number\(e\?\.status\)\)/);
  assert.match(ui,/Only clear automatically when the server proves the request never committed/);
});
