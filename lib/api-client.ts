import {cacheGet,cachePut} from "@/lib/offline-db";
const SAFE_GET_CACHE=new Set(["/api/pos/bootstrap"]);
function emit(status:"online"|"offline"|"cached"){if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent("field:network",{detail:{status}}))}
export async function api<T>(path:string,init:RequestInit={}){
  const method=String(init.method||"GET").toUpperCase();
  if(method!=="GET"&&typeof navigator!=="undefined"&&!navigator.onLine)throw Object.assign(new Error("offline_write_blocked"),{status:0});
  try{
    const res=await fetch(path,{...init,headers:{"Content-Type":"application/json",...(init.headers||{})},credentials:"same-origin",cache:"no-store"});
    const data=await res.json().catch(()=>({}));
    if(res.status===401&&typeof window!=="undefined")window.dispatchEvent(new Event("field:auth-expired"));
    if(!res.ok)throw Object.assign(new Error(data.error||"request_failed"),{status:res.status,data});
    if(method==="GET"&&SAFE_GET_CACHE.has(path))cachePut(path,data).catch(()=>{});
    emit("online");return data as T;
  }catch(error:any){
    if(method==="GET"&&SAFE_GET_CACHE.has(path)){
      const cached=await cacheGet<T>(path);
      if(cached){emit("cached");return cached}
    }
    if(error?.status===undefined){emit("offline");throw Object.assign(new Error("network_unavailable"),{status:0,cause:error})}
    throw error;
  }
}
export type Session={user:{id:string;username:string;role:"admin"|"staff";permissions:Record<string,boolean>};csrf:string};
export type MenuItem={id:string;name:string;category?:string;price:number;enabled:boolean;variants:{label:string}[]};
export type Bootstrap={revision:number;menu:MenuItem[];orders:any[];settings:Record<string,any>};
