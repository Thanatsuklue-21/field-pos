export const BACKUP_RESTORE_INTENT_PREFIX="field-backup-restore-pending-v1:";
const KEY_RE=/^[A-Za-z0-9._:-]{8,128}$/;
const HEX64=/^[0-9a-f]{64}$/;
const keyFor=actorId=>BACKUP_RESTORE_INTENT_PREFIX+encodeURIComponent(actorId);
const fail=(code,cause)=>Object.assign(new Error(code),{status:0,cause});
const storageOrThrow=storage=>{try{return storage||localStorage}catch(cause){throw fail("backup_restore_recovery_unavailable",cause)}};

function validIntent(value,actorId){
  return !!value&&value.version===1&&value.actorId===actorId&&KEY_RE.test(String(value.requestKey||""))
    &&HEX64.test(String(value.fingerprint||""))&&Number.isInteger(Number(value.expectedRevision))
    &&Number(value.expectedRevision)>=0&&Number.isFinite(Number(value.createdAt));
}

export function readBackupRestoreIntent(actorId,storage){
  try{
    const raw=storageOrThrow(storage).getItem(keyFor(actorId));
    if(!raw)return null;
    const value=JSON.parse(raw);
    if(!validIntent(value,actorId))throw new Error("invalid_intent");
    return value;
  }catch(cause){throw fail("backup_restore_recovery_unavailable",cause)}
}

export function prepareBackupRestoreIntent(actorId,{requestKey,fingerprint,expectedRevision},storage){
  const next={version:1,actorId,requestKey:String(requestKey||""),fingerprint:String(fingerprint||""),expectedRevision:Number(expectedRevision),createdAt:Date.now()};
  if(!validIntent(next,actorId))throw fail("invalid_backup_restore_intent");
  const store=storageOrThrow(storage),existing=readBackupRestoreIntent(actorId,store);
  if(existing){
    if(existing.fingerprint!==next.fingerprint||existing.expectedRevision!==next.expectedRevision)throw fail("pending_backup_restore_exists");
    return existing;
  }
  try{
    const raw=JSON.stringify(next);store.setItem(keyFor(actorId),raw);
    if(store.getItem(keyFor(actorId))!==raw)throw new Error("intent_not_persisted");
    return next;
  }catch(cause){throw fail("backup_restore_recovery_unavailable",cause)}
}

export function clearBackupRestoreIntent(actorId,requestKey,storage){
  const store=storageOrThrow(storage),current=readBackupRestoreIntent(actorId,store);
  if(current&&current.requestKey===requestKey)store.removeItem(keyFor(actorId));
}

export function restoreBody(intent,backup){
  if(!validIntent(intent,intent?.actorId))throw fail("invalid_backup_restore_intent");
  return {requestKey:intent.requestKey,backup,backupFingerprint:intent.fingerprint,expectedRevision:intent.expectedRevision,confirm:true};
}

export function assertBackupRestoreAck(intent,result){
  const exact=result?.ok===true&&String(result.requestKey||"")===intent.requestKey
    &&String(result.performedBy||"")===intent.actorId&&String(result.fingerprint||"")===intent.fingerprint
    &&Number(result.revision)===intent.expectedRevision+1;
  if(!exact)throw fail("backup_restore_ack_unknown");
  return result;
}
