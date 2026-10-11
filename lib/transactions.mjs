const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const BUSY_RETRY_ATTEMPTS=7;
const delay=attempt=>Math.min(25*(2**attempt),800);

// A single Node process can otherwise open two local/libSQL write transactions
// that both read the same state and deadlock at COMMIT. Serialize turns per
// client object. Cross-instance concurrency is still guarded by the database
// transaction and state preconditions.
const dbWriteTails=new WeakMap();
const txTurnReleases=new WeakMap();

async function acquireWriteTurn(db){
  const previous=dbWriteTails.get(db)||Promise.resolve();
  let releaseGate;
  const gate=new Promise(resolve=>{releaseGate=resolve});
  const tail=previous.catch(()=>{}).then(()=>gate);
  dbWriteTails.set(db,tail);
  await previous.catch(()=>{});
  let released=false;
  return ()=>{
    if(released)return;
    released=true;
    releaseGate();
    if(dbWriteTails.get(db)===tail)dbWriteTails.delete(db);
  };
}

function releaseWriteTurn(tx){
  const release=txTurnReleases.get(tx);
  if(!release)return;
  txTurnReleases.delete(tx);
  release();
}

// Acquiring a write transaction is safe to retry because no application mutation
// has been committed yet.
export async function beginWriteTransaction(db){
  const release=await acquireWriteTurn(db);
  try{
    for(let attempt=0;attempt<BUSY_RETRY_ATTEMPTS;attempt++){
      try{
        const tx=await db.transaction('write');
        txTurnReleases.set(tx,release);
        const rollback=tx.rollback.bind(tx);
        tx.rollback=async(...args)=>{
          try{return await rollback(...args)}
          finally{releaseWriteTurn(tx)}
        };
        return tx;
      }catch(error){
        if(!['SQLITE_BUSY','SQLITE_BUSY_SNAPSHOT'].includes(error?.code))throw error;
        if(attempt===BUSY_RETRY_ATTEMPTS-1)throw Object.assign(new Error('transaction_busy'),{status:503,cause:error});
        await sleep(delay(attempt));
      }
    }
  }catch(error){
    release();
    throw error;
  }
}

// SQLite documents that a COMMIT returning SQLITE_BUSY leaves the same
// transaction active, so that exact COMMIT may be retried later. Do not retry
// SQLITE_BUSY_SNAPSHOT, network errors, or any unknown commit outcome.
export async function commitWriteTransaction(tx){
  for(let attempt=0;attempt<BUSY_RETRY_ATTEMPTS;attempt++){
    try{
      await tx.commit();
      releaseWriteTurn(tx);
      return;
    }catch(error){
      if(error?.code!=='SQLITE_BUSY')throw error;
      if(attempt===BUSY_RETRY_ATTEMPTS-1)throw Object.assign(new Error('transaction_busy'),{status:503,cause:error});
      await sleep(delay(attempt));
    }
  }
}
