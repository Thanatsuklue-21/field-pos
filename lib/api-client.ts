import {cacheGet,cachePut} from "@/lib/offline-db";
import {captureClientTelemetry,clientNow,elapsedMs} from "@/lib/client-telemetry";

export type Session={user:{id:string;username:string;role:"admin"|"staff";permissions:Record<string,boolean>};csrf:string;offline?:boolean};
export type MenuVariant={label:string;available:boolean;maxServings:number;lowStock:boolean;recipeItems:Record<string,number>;missingIngredients:{id:string;name:string}[];reason:string|null};
export type MenuItem={id:string;name:string;category?:string;image?:string;price:number;enabled:boolean;available:boolean;maxServings:number;lowStock:boolean;variants:MenuVariant[]};
export type Bootstrap={revision:number;unchanged?:false;menu:MenuItem[];availabilityStock:Record<string,{qty:number;name:string}>;operational?:{businessDate:string;dayClosed:boolean};settings:Record<string,any>};
export type RevisionUnchanged={revision:number;unchanged:true};

const SAFE_GET_CACHE=new Set(["/api/pos/bootstrap"]);
const SESSION_TTL_MS=30_000;
const GET_TIMEOUT_MS=8_000;
const AUTH_SESSION_TIMEOUT_MS=2_500;
const RECOVERABLE_WRITE_TIMEOUT_MS=20_000;
const RECOVERABLE_WRITE_PATHS=new Set([
  "/api/pos/checkout",
  "/api/pos/void",
  "/api/pos/refund",
  "/api/expenses",
  "/api/accounting/settlements",
  "/api/close-day",
  "/api/cash-shift/movements",
  "/api/stock/transactions",
  "/api/stock/cycle-count",
  "/api/pos/queue",
  "/api/pos/split/start",
  "/api/pos/split/pay",
  "/api/pos/split/cancel",
  "/api/pos/split/provider-release",
  "/api/pos/payment-resolutions/reconcile",
  "/api/pos/kitchen/retry",
  "/api/payments/promptpay/create",
  "/api/payments/promptpay/status"
]);
let sessionCache:{value:Session;at:number}|null=null;
let sessionInFlight:Promise<Session>|null=null;
const getInFlight=new Map<string,Promise<unknown>>();

function emit(status:"online"|"offline"|"cached"){
  if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent("field:network",{detail:{status}}));
}

function getRequestKey(path:string,init:RequestInit){
  const headers=new Headers(init.headers||{});
  const normalized=[...headers.entries()].sort(([a],[b])=>a.localeCompare(b));
  return path+"|"+JSON.stringify(normalized);
}

async function fetchWithPolicy(path:string,init:RequestInit,method:string){
  const recoverableWrite=method!=="GET"&&RECOVERABLE_WRITE_PATHS.has(path);
  const controller=!init.signal&&(method==="GET"||recoverableWrite)?new AbortController():null;
  const timeoutMs=path==="/api/auth/session"?AUTH_SESSION_TIMEOUT_MS:recoverableWrite?RECOVERABLE_WRITE_TIMEOUT_MS:GET_TIMEOUT_MS;
  const timeoutReason=path==="/api/auth/session"?"field_auth_session_timeout":recoverableWrite?"field_recoverable_write_timeout":"field_get_timeout";
  const timer=controller?setTimeout(()=>controller.abort(timeoutReason),timeoutMs):null;
  const headers=new Headers(init.headers);
  if(!headers.has("Content-Type"))headers.set("Content-Type","application/json");
  try{
    const res=await fetch(path,{
      ...init,
      headers,
      credentials:"same-origin",
      cache:"no-store",
      signal:controller?.signal||init.signal,
    });
    const data=await res.json().catch((cause)=>{
      if(controller?.signal.aborted||init.signal?.aborted)throw cause;
      if(res.ok)throw Object.assign(new Error("network_unavailable"),{status:0,cause,responseStatus:res.status});
      return {};
    });
    return {res,data};
  }finally{
    if(timer)clearTimeout(timer);
  }
}

export function setSessionCache(session:Session){
  sessionCache={value:session,at:Date.now()};
}
export function clearSessionCache(){
  sessionCache=null;
  sessionInFlight=null;
  getInFlight.delete("/api/auth/session|[]");
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

async function executeApi<T>(path:string,init:RequestInit,method:string){
  const started=clientNow();
  let httpStatus=0;
  const metric=method==="POST"&&path==="/api/pos/checkout"?"checkout_latency":method==="POST"&&path==="/api/pos/queue"?"queue_action_latency":"";
  try{
    const {res,data}=await fetchWithPolicy(path,init,method);
    httpStatus=res.status;

    if(res.ok&&(!data||typeof data!=="object"||(method!=="GET"&&(Array.isArray(data)||Object.keys(data).length===0)))){
      throw Object.assign(new Error("network_unavailable"),{status:0,responseStatus:res.status});
    }
    if(res.ok&&path==="/api/pos/checkout"&&method==="POST"){
      const complete=data.ok===true
        &&typeof data.orderId==="string"&&data.orderId.length>0
        &&typeof data.queueNo==="string"
        &&Array.isArray(data.saleIds)&&data.saleIds.length>0
        &&data.saleIds.every((id:unknown)=>typeof id==="string"&&id.length>0)
        &&[data.total,data.received,data.change].every((value:unknown)=>typeof value==="number"&&Number.isFinite(value)&&value>=0);
      if(!complete)throw Object.assign(new Error("network_unavailable"),{status:0,responseStatus:res.status});
    }

    if(res.status===401){
      clearSessionCache();
      if(typeof window!=="undefined")window.dispatchEvent(new Event("field:auth-expired"));
    }
    if(!res.ok)throw Object.assign(new Error(data.error||"request_failed"),{status:res.status,data});
    if(path==="/api/auth/login"&&method==="POST"&&data?.user&&data?.csrf)setSessionCache(data as Session);
    if(path==="/api/auth/logout"&&method==="POST")clearSessionCache();
    if(method==="GET"&&SAFE_GET_CACHE.has(path)&&data?.unchanged!==true)cachePut(path,data).catch(()=>{});
    emit("online");
    return data as T;
  }catch(error:any){
    if(init.signal?.aborted)throw init.signal.reason??error;
    if(error?.status===undefined){
      if(method==="GET"&&SAFE_GET_CACHE.has(path)){
        const cached=await cacheGet<T>(path).catch(()=>null);
        if(cached){emit("cached");return cached}
      }
      emit("offline");
      throw Object.assign(new Error("network_unavailable"),{status:0,cause:error});
    }
    throw error;
  }finally{
    if(metric)captureClientTelemetry(metric,{duration_ms:elapsedMs(started),http_status:httpStatus,success:httpStatus>=200&&httpStatus<300});
  }
}

export async function api<T>(path:string,init:RequestInit={}){
  const method=String(init.method||"GET").toUpperCase();
  if(method!=="GET"&&typeof navigator!=="undefined"&&!navigator.onLine)throw Object.assign(new Error("offline_write_blocked"),{status:0});

  // Reads are safe to coalesce. Writes are never deduplicated or retried here:
  // transaction endpoints own their idempotency semantics server-side.
  if(method==="GET"){
    // A caller-owned signal must cancel only that caller, never a shared GET or stale-cache fallback.
    if(init.signal)return executeApi<T>(path,init,method);
    const key=getRequestKey(path,init),existing=getInFlight.get(key);
    if(existing)return existing as Promise<T>;
    const request=executeApi<T>(path,init,method).finally(()=>getInFlight.delete(key));
    getInFlight.set(key,request);
    return request;
  }
  return executeApi<T>(path,init,method);
}
