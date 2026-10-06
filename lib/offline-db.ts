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
function txDone(tx:IDBTransaction){return new Promise<void>(resolve=>{tx.oncomplete=()=>resolve();tx.onerror=()=>resolve();tx.onabort=()=>resolve()})}

export async function cachePut<T>(key:string,value:T){
  const db=await openDb();if(!db)return;
  const tx=db.transaction(CACHE_STORE,"readwrite");
  tx.objectStore(CACHE_STORE).put({value,savedAt:Date.now()},key);
  await txDone(tx);db.close();
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

export async function offlineCashPut(record:OfflineCashRecord){
  const db=await openDb();if(!db)throw new Error("offline_storage_unavailable");
  const tx=db.transaction(OUTBOX_STORE,"readwrite");
  tx.objectStore(OUTBOX_STORE).put(record);
  await txDone(tx);db.close();
}
export async function offlineCashList():Promise<OfflineCashRecord[]>{
  const db=await openDb();if(!db)return [];
  const rows=await new Promise<OfflineCashRecord[]>(resolve=>{
    const r=db.transaction(OUTBOX_STORE,"readonly").objectStore(OUTBOX_STORE).getAll();
    r.onsuccess=()=>resolve(Array.isArray(r.result)?r.result:[]);r.onerror=()=>resolve([]);
  });
  db.close();
  return rows.sort((a,b)=>Number(a.createdAt||0)-Number(b.createdAt||0));
}
export async function offlineCashDelete(requestKey:string){
  const db=await openDb();if(!db)return;
  const tx=db.transaction(OUTBOX_STORE,"readwrite");
  tx.objectStore(OUTBOX_STORE).delete(requestKey);
  await txDone(tx);db.close();
}
export async function offlineCashPatch(requestKey:string,patch:Partial<OfflineCashRecord>){
  const db=await openDb();if(!db)return;
  const tx=db.transaction(OUTBOX_STORE,"readwrite"),store=tx.objectStore(OUTBOX_STORE);
  const r=store.get(requestKey);
  r.onsuccess=()=>{
    const row=r.result as OfflineCashRecord|undefined;
    if(row)store.put({...row,...patch,requestKey:row.requestKey});
  };
  await txDone(tx);db.close();
}
