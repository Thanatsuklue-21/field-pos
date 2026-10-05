export type QueueCachePayload={revision:number;orders:any[];cachedAt:number};
const KEY="field-pos-queue-snapshot-v1";
const TTL_MS=30_000;

export function readQueueSnapshotCache<T extends {revision:number;orders:any[]}>():T|null{
  if(typeof window==="undefined")return null;
  try{
    const raw=sessionStorage.getItem(KEY);if(!raw)return null;
    const parsed=JSON.parse(raw);
    if(!parsed||!Number.isFinite(Number(parsed.revision))||!Array.isArray(parsed.orders))return null;
    if(Date.now()-Number(parsed.cachedAt||0)>TTL_MS){sessionStorage.removeItem(KEY);return null}
    return {revision:Number(parsed.revision),orders:parsed.orders} as T;
  }catch{return null}
}

export function writeQueueSnapshotCache(snapshot:{revision:number;orders:any[]}){
  if(typeof window==="undefined"||!snapshot||!Array.isArray(snapshot.orders))return;
  try{sessionStorage.setItem(KEY,JSON.stringify({revision:Number(snapshot.revision)||0,orders:snapshot.orders,cachedAt:Date.now()}))}catch{}
}

export function clearQueueSnapshotCache(){
  if(typeof window==="undefined")return;
  try{sessionStorage.removeItem(KEY)}catch{}
}
