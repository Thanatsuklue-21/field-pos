const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const delay=attempt=>25*(2**attempt);
const mutexes=new WeakMap();

async function acquireWriteSlot(db){
  let mutex=mutexes.get(db);
  if(!mutex){mutex={locked:false,waiters:[]};mutexes.set(db,mutex)}
  if(mutex.locked)await new Promise(resolve=>mutex.waiters.push(resolve));
  else mutex.locked=true;
  let released=false;
  return ()=>{
    if(released)return;
    released=true;
    const next=mutex.waiters.shift();
    if(next)next();
    else mutex.locked=false;
  };
}

function ownTransaction(tx,release){
  return new Proxy(tx,{
    get(target,property){
      if(property==='commit')return async(...args)=>{
        const result=await target.commit(...args);
        release();
        return result;
      };
      if(property==='rollback')return async(...args)=>{
        try{return await target.rollback(...args)}
        finally{release()}
      };
      const value=Reflect.get(target,property,target);
      return typeof value==='function'?value.bind(target):value;
    }
  });
}

// FIELD state writes all converge on the same state row. Serialize writes that
// share one client instance, then rely on BEGIN IMMEDIATE + bounded lock retry
// for contention with another process/instance.
export async function beginWriteTransaction(db){
  const release=await acquireWriteSlot(db);
  try{
    for(let attempt=0;attempt<5;attempt++){
      try{return ownTransaction(await db.transaction('write'),release)}
      catch(error){
        if(!['SQLITE_BUSY','SQLITE_BUSY_SNAPSHOT'].includes(error?.code))throw error;
        if(attempt===4)throw Object.assign(new Error('transaction_busy'),{status:503,cause:error});
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
  for(let attempt=0;attempt<5;attempt++){
    try{await tx.commit();return}
    catch(error){
      if(error?.code!=='SQLITE_BUSY')throw error;
      if(attempt===4)throw Object.assign(new Error('transaction_busy'),{status:503,cause:error});
      await sleep(delay(attempt));
    }
  }
}
