const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const delay=attempt=>25*(2**attempt);

// Acquiring a write transaction is safe to retry because no application mutation
// has been committed yet.
export async function beginWriteTransaction(db){
  for(let attempt=0;attempt<5;attempt++){
    try{return await db.transaction('write')}
    catch(error){
      if(!['SQLITE_BUSY','SQLITE_BUSY_SNAPSHOT'].includes(error?.code))throw error;
      if(attempt===4)throw Object.assign(new Error('transaction_busy'),{status:503,cause:error});
      await sleep(delay(attempt));
    }
  }
}

// SQLite documents that a COMMIT returning SQLITE_BUSY leaves the same
// transaction active, so that exact COMMIT may be retried later. Do not retry
// SQLITE_BUSY_SNAPSHOT, network errors, or any unknown commit outcome.
export async function commitWriteTransaction(tx){
  for(let attempt=0;attempt<5;attempt++){
    try{await tx.commit();return}
    catch(error){
      if(error?.code!=='SQLITE_BUSY')throw error;
      if(attempt===4)throw Object.assign(new Error('transaction_busy'),{status:503,cause:error});
      await sleep(delay(attempt));
    }
  }
}
