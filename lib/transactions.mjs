// Retry only acquiring a write lock. Never replay an entire transaction whose commit result is unknown.
export async function beginWriteTransaction(db){
  for(let attempt=0;attempt<5;attempt++){
    try{return await db.transaction('write')}
    catch(error){
      if(!['SQLITE_BUSY','SQLITE_BUSY_SNAPSHOT'].includes(error?.code))throw error;
      if(attempt===4)throw Object.assign(new Error('transaction_busy'),{status:503});
      await new Promise(resolve=>setTimeout(resolve,25*(2**attempt)));
    }
  }
}


export async function commitWriteTransaction(tx){
  // SQLite documents that COMMIT returning SQLITE_BUSY leaves the transaction active,
  // so retrying the same commit is safe and does not replay any business mutation.
  // Do not retry SQLITE_BUSY_SNAPSHOT or transport/provider errors because their
  // commit outcome is not guaranteed by this local SQLite contract.
  for(let attempt=0;attempt<5;attempt++){
    try{return await tx.commit()}
    catch(error){
      if(error?.code!=="SQLITE_BUSY")throw error;
      if(attempt===4)throw Object.assign(new Error("transaction_busy"),{status:503});
      await new Promise(resolve=>setTimeout(resolve,25*(2**attempt)));
    }
  }
}
