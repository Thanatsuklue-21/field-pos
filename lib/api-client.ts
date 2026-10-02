import {cacheGet,cachePut} from "@/lib/offline-db";

export type Session={user:{id:string;username:string;role:"admin"|"staff";permissions:Record<string,boolean>};csrf:string};
export type MenuVariant={label:string;available:boolean;maxServings:number;lowStock:boolean;recipeItems:Record<string,number>;missingIngredients:{id:string;name:string}[];reason:string|null};
export type MenuItem={id:string;name:string;category?:string;price:number;enabled:boolean;available:boolean;maxServings:number;lowStock:boolean;variants:MenuVariant[]};
export type Bootstrap={revision:number;menu:MenuItem[];availabilityStock:Record<string,{qty:number;name:string}>;orders:any[];settings:Record<string,any>};

const SAFE_GET_CACHE=new Set(["/api/pos/bootstrap"]);
const SESSION_TTL_MS=30_000;
let sessionCache:{value:Session;at:number}|null=null;
let sessionInFlight:Promise<Session>|null=null;

function emit(status:"online"|"offline"|"cached"){
  if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent("field:network",{detail:{status}}));
}

export function setSessionCache(session:Session){
  sessionCache={value:session,at:Date.now()};
}
export function clearSessionCache(){
  sessionCache=null;
  sessionInFlight=null;
}
export async function getSessionCached(force=false){
  if(!force&&sessionCache&&(Date.now()-sessionCache.at)<SESSION_TTL_MS)return sessionCache.value;
  if(!force&&sessionInFlight)return sessionInFlight;
  sessionInFlight=api<Session>("/api/auth/session").then(session=>{
    setSessionCache(session);
    return session;
  }).finally(()=>{sessionInFlight=null});
  return sessionInFlight;
}

export async function api<T>(path:string,init:RequestInit={}){
  const method=String(init.method||"GET").toUpperCase();
  if(method!=="GET"&&typeof navigator!=="undefined"&&!navigator.onLine)throw Object.assign(new Error("offline_write_blocked"),{status:0});
  try{
    const res=await fetch(path,{...init,headers:{"Content-Type":"application/json",...(init.headers||{})},credentials:"same-origin",cache:"no-store"});
    const data=await res.json().catch(()=>({}));
    if(res.status===401){
      clearSessionCache();
      if(typeof window!=="undefined")window.dispatchEvent(new Event("field:auth-expired"));
    }
    if(!res.ok)throw Object.assign(new Error(data.error||"request_failed"),{status:res.status,data});
    if(path==="/api/auth/login"&&method==="POST"&&data?.user&&data?.csrf)setSessionCache(data as Session);
    if(path==="/api/auth/logout"&&method==="POST")clearSessionCache();
    if(method==="GET"&&SAFE_GET_CACHE.has(path))cachePut(path,data).catch(()=>{});
    emit("online");
    return data as T;
  }catch(error:any){
    if(error?.status===undefined){
      if(method==="GET"&&SAFE_GET_CACHE.has(path)){
        const cached=await cacheGet<T>(path);
        if(cached){emit("cached");return cached}
      }
      emit("offline");
      throw Object.assign(new Error("network_unavailable"),{status:0,cause:error});
    }
    throw error;
  }
}
