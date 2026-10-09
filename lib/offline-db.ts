const DB_NAME="field-pos-client",CACHE_STORE="cache",OUTBOX_STORE="cash-outbox",VERSION=2;
export const BOOTSTRAP_OFFLINE_MAX_AGE_MS=36*60*60*1000;
type Cached<T>={value:T,savedAt:number};
export type OfflineCashStatus="pending"|"needs_review";
export type OfflineCashRecord={
  requestKey:string;
  body:Record<string,any>;
  createdAt:number;
  localNo:string;
  status:OfflineCashStatus;
  attempts:number;
  lastAttemptAt?:number;
  lastError?:string;
};

function openDb():Promise<IDBDatabase|null>{
  if(typeof indexedDB==="undefined")return Promise.resolve(null);
  return new Promise<IDBDatabase|null>(resolve=>{
    const r=indexedDB.open(DB_NAME,VERSION);
    r.onupgradeneeded=()=>{
      if(!r.result.objectStoreNames.contains(CACHE_STORE))r.result.createObjectStore(CACHE_STORE);
      if(!r.result.objectStoreNames.contains(OUTBOX_STORE))r.result.createObjectStore(OUTBOX_STORE,{keyPath:"requestKey"});
    };
    r.onsuccess=()=>resolve(r.result);
    r.onerror=()=>resolve(null);
  }).catch(()=>null);
}
function committedTransaction<T>(db:IDBDatabase,stores:string|string[],mode:IDBTransactionMode,work:(tx:IDBTransaction)=>()=>T):Promise<T>{
  return new Promise<T>((resolve,reject)=>{
    let tx:IDBTransaction|undefined;
    const fail=(cause:unknown)=>reject(new Error("offline_storage_failed",{cause}));
    try{
      tx=db.transaction(stores,mode);
      tx.onerror=()=>fail(tx?.error);
      tx.onabort=()=>fail(tx?.error);
      // Request success alone is not proof of durable storage: the transaction can still abort.
      const result=work(tx);
      tx.oncomplete=()=>{try{resolve(result())}catch(error){fail(error)}};
    }catch(error){
      try{tx?.abort()}catch{}
      fail(error);
    }
  }).finally(()=>db.close());
}

export async function cachePut<T>(key:string,value:T){
  const db=await openDb();if(!db)return;
  await committedTransaction(db,CACHE_STORE,"readwrite",tx=>{
    tx.objectStore(CACHE_STORE).put({value,savedAt:Date.now()},key);
    return ()=>undefined;
  });
}
export async function cacheGet<T>(key:string,maxAgeMs=BOOTSTRAP_OFFLINE_MAX_AGE_MS):Promise<T|null>{
  const db=await openDb();if(!db)return null;
  const row=await committedTransaction<Cached<T>|undefined>(db,CACHE_STORE,"readonly",tx=>{
    const r=tx.objectStore(CACHE_STORE).get(key);
    return ()=>r.result;
  }).catch(()=>undefined);
  if(!row||Date.now()-Number(row.savedAt||0)>maxAgeMs)return null;
  return row.value;
}

export async function offlineCashPut(record:OfflineCashRecord){
  const db=await openDb();if(!db)throw new Error("offline_storage_unavailable");
  await committedTransaction(db,OUTBOX_STORE,"readwrite",tx=>{
    tx.objectStore(OUTBOX_STORE).put(record);
    return ()=>undefined;
  });
}
export async function offlineCashList():Promise<OfflineCashRecord[]>{
  const db=await openDb();if(!db)throw new Error("offline_storage_unavailable");
  const rows=await committedTransaction<OfflineCashRecord[]>(db,OUTBOX_STORE,"readonly",tx=>{
    const r=tx.objectStore(OUTBOX_STORE).getAll();
    return ()=>Array.isArray(r.result)?r.result:[];
  });
  return rows.sort((a,b)=>Number(a.createdAt||0)-Number(b.createdAt||0));
}
export async function offlineCashDelete(requestKey:string){
  const db=await openDb();if(!db)throw new Error("offline_storage_unavailable");
  await committedTransaction(db,OUTBOX_STORE,"readwrite",tx=>{
    tx.objectStore(OUTBOX_STORE).delete(requestKey);
    return ()=>undefined;
  });
}
export async function offlineCashPatch(requestKey:string,patch:Partial<OfflineCashRecord>){
  const db=await openDb();if(!db)throw new Error("offline_storage_unavailable");
  await committedTransaction(db,OUTBOX_STORE,"readwrite",tx=>{
    const store=tx.objectStore(OUTBOX_STORE),r=store.get(requestKey);
    r.onsuccess=()=>{
      const row=r.result as OfflineCashRecord|undefined;
      if(row)store.put({...row,...patch,requestKey:row.requestKey});
    };
    return ()=>undefined;
  });
}

export async function clientStorageStatus(){
  const db=await openDb();
  if(!db)return {indexedDbReady:false,cacheReady:false,outboxPending:0,outboxNeedsReview:0,schemaVersion:VERSION};
  const [cached,rows]=await committedTransaction<[Cached<any>|undefined,OfflineCashRecord[]]>(db,[CACHE_STORE,OUTBOX_STORE],"readonly",tx=>{
    const cacheReq=tx.objectStore(CACHE_STORE).get("/api/pos/bootstrap"),
      outboxReq=tx.objectStore(OUTBOX_STORE).getAll();
    return ()=>[cacheReq.result,Array.isArray(outboxReq.result)?outboxReq.result:[]];
  });
  const pending=rows.filter(x=>x.status==="pending").length,review=rows.filter(x=>x.status==="needs_review").length;
  const savedAt=Number(cached?.savedAt||0),cacheAgeMs=savedAt>0?Math.max(0,Date.now()-savedAt):null;
  const cacheReady=!!cached?.value&&cacheAgeMs!==null&&cacheAgeMs<=BOOTSTRAP_OFFLINE_MAX_AGE_MS;
  return {indexedDbReady:true,cacheReady,outboxPending:pending+review,outboxNeedsReview:review,schemaVersion:VERSION};
}
