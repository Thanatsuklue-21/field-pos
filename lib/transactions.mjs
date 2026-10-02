// Retry only acquiring a write lock. Never retry a commit whose result is unknown.
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
