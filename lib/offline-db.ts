const DB_NAME="field-pos-client",CACHE_STORE="cache",OUTBOX_STORE="cash-outbox",VERSION=2;
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
  return new Promise(resolve=>{
    const r=indexedDB.open(DB_NAME,VERSION);
    r.onupgradeneeded=()=>{
      if(!r.result.objectStoreNames.contains(CACHE_STORE))r.result.createObjectStore(CACHE_STORE);
      if(!r.result.objectStoreNames.contains(OUTBOX_STORE))r.result.createObjectStore(OUTBOX_STORE,{keyPath:"requestKey"});
    };
    r.onsuccess=()=>resolve(r.result);
    r.onerror=()=>resolve(null);
  });
}
function txDone(tx:IDBTransaction){
  return new Promise<void>((resolve,reject)=>{
    tx.oncomplete=()=>resolve();
    const failed=()=>reject(Object.assign(new Error("offline_storage_write_failed"),{cause:tx.error}));
    tx.onerror=failed;tx.onabort=failed;
  });
}
async function writeStore(db:IDBDatabase,storeName:string,write:(store:IDBObjectStore)=>void){
  try{
    const tx=db.transaction(storeName,"readwrite"),done=txDone(tx);
    try{write(tx.objectStore(storeName))}
    catch(error){
      tx.abort();
      await done.catch(()=>{});
      throw Object.assign(new Error("offline_storage_write_failed"),{cause:error});
    }
    await done;
  }finally{db.close()}
}

export async function cachePut<T>(key:string,value:T){
  const db=await openDb();if(!db)return;
  if(key==="/api/pos/bootstrap"){
    try{
      const tx=db.transaction([CACHE_STORE,OUTBOX_STORE],"readwrite"),done=txDone(tx);
      const pending=tx.objectStore(OUTBOX_STORE).getAll();
      pending.onsuccess=()=>{
        try{
          if(!Array.isArray(pending.result))throw new Error("offline_storage_unavailable");
          // A reconnect GET must not replace stock already consumed by local bills.
          if(pending.result.length===0)tx.objectStore(CACHE_STORE).put({value,savedAt:Date.now()},key);
        }catch{tx.abort()}
      };
      await done;
    }finally{db.close()}
    return;
  }
  await writeStore(db,CACHE_STORE,store=>{store.put({value,savedAt:Date.now()},key)});
}
export async function cacheGet<T>(key:string,maxAgeMs=24*60*60*1000):Promise<T|null>{
  const db=await openDb();if(!db)return null;
  const row=await new Promise<Cached<T>|undefined>(resolve=>{
    const r=db.transaction(CACHE_STORE,"readonly").objectStore(CACHE_STORE).get(key);
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>resolve(undefined);
  });
  db.close();
  if(!row||Date.now()-Number(row.savedAt||0)>maxAgeMs)return null;
  return row.value;
}

export async function offlineCashPut(record:OfflineCashRecord,projectBootstrap?:(value:any)=>any){
  const db=await openDbStrict();
  if(!projectBootstrap){await writeStore(db,OUTBOX_STORE,store=>{store.put(record)});return}
  try{
    const tx=db.transaction([OUTBOX_STORE,CACHE_STORE],"readwrite"),done=txDone(tx);
    let projected:any;
    try{
      tx.objectStore(OUTBOX_STORE).add(record);
      const store=tx.objectStore(CACHE_STORE),request=store.get("/api/pos/bootstrap");
      request.onsuccess=()=>{
        try{
          const cached=request.result as Cached<any>|undefined,age=Date.now()-Number(cached?.savedAt);
          if(!cached?.value||!Number.isFinite(age)||age<0||age>24*60*60*1000)throw new Error("offline_catalog_unavailable");
          projected=projectBootstrap(cached.value);
          if(!projected)throw new Error("offline_catalog_unavailable");
          // Preserve catalog freshness: an offline sale is not a server refresh.
          store.put({...cached,value:projected},"/api/pos/bootstrap");
        }catch{tx.abort()}
      };
    }catch(cause){tx.abort();await done.catch(()=>{});throw Object.assign(new Error("offline_storage_write_failed"),{cause})}
    await done;
    return projected;
  }finally{db.close()}
}
export async function offlineCashList():Promise<OfflineCashRecord[]>{
  return offlineCashListStrict();
}
export async function offlineCashDelete(requestKey:string){
  const db=await openDb();if(!db)throw new Error("offline_storage_unavailable");
  await writeStore(db,OUTBOX_STORE,store=>{store.delete(requestKey)});
}
export async function offlineCashPatch(requestKey:string,patch:Partial<OfflineCashRecord>){
  const db=await openDb();if(!db)throw new Error("offline_storage_unavailable");
  await writeStore(db,OUTBOX_STORE,store=>{
    const r=store.get(requestKey);
    r.onsuccess=()=>{
      const row=r.result as OfflineCashRecord|undefined;
      if(row)store.put({...row,...patch,requestKey:row.requestKey});
    };
  });
}


function openDbStrict():Promise<IDBDatabase>{
  if(typeof indexedDB==="undefined")return Promise.reject(new Error("offline_storage_unavailable"));
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finishError=()=>{if(!settled){settled=true;reject(new Error("offline_storage_unavailable"))}};
    let r:IDBOpenDBRequest;
    try{r=indexedDB.open(DB_NAME,VERSION)}catch{finishError();return}
    r.onupgradeneeded=()=>{
      if(!r.result.objectStoreNames.contains(CACHE_STORE))r.result.createObjectStore(CACHE_STORE);
      if(!r.result.objectStoreNames.contains(OUTBOX_STORE))r.result.createObjectStore(OUTBOX_STORE,{keyPath:"requestKey"});
    };
    r.onsuccess=()=>{
      if(settled){r.result.close();return}
      settled=true;resolve(r.result);
    };
    r.onerror=finishError;
    r.onblocked=finishError;
  });
}

// Close Day must distinguish an empty outbox from unreadable browser storage.
export async function offlineCashListStrict():Promise<OfflineCashRecord[]>{
  const db=await openDbStrict();
  try{
    return await new Promise<OfflineCashRecord[]>((resolve,reject)=>{
      const tx=db.transaction(OUTBOX_STORE,"readonly"),request=tx.objectStore(OUTBOX_STORE).getAll();
      let settled=false,rows:OfflineCashRecord[]|null=null;
      const fail=()=>{if(!settled){settled=true;reject(new Error("offline_storage_unavailable"))}};
      request.onsuccess=()=>{
        if(!Array.isArray(request.result)){fail();return}
        rows=request.result;
        if(rows!.some(row=>!row||typeof row.requestKey!=="string"||row.requestKey.length<8||!row.body||row.body.requestKey!==row.requestKey||!/^\d{4}-\d{2}-\d{2}$/.test(String(row.body.date||""))||!["pending","needs_review"].includes(row.status))){fail();return}
      };
      request.onerror=fail;tx.onabort=fail;tx.onerror=fail;
      tx.oncomplete=()=>{if(!settled){if(rows===null){fail();return}settled=true;resolve(rows)}};
    }).then(rows=>rows.sort((a,b)=>Number(a.createdAt||0)-Number(b.createdAt||0)));
  }catch(cause){throw Object.assign(new Error("offline_storage_unavailable"),{cause})}
  finally{db.close()}
}
