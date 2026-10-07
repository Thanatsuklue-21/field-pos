"use client";

import type {Session} from "@/lib/api-client";
import {clientStorageStatus} from "@/lib/offline-db";

const KEY="field-pos-offline-operator-v1";
const MAX_AGE_MS=7*24*60*60*1000;
type Snapshot={id:string;username:string;savedAt:number};

export function saveOfflineOperatorSession(session:Session){
  if(typeof window==="undefined"||session.offline)return;
  const id=String(session.user?.id||""),username=String(session.user?.username||"");
  if(!id||!username)return;
  try{localStorage.setItem(KEY,JSON.stringify({id,username,savedAt:Date.now()} satisfies Snapshot))}catch{}
}

export function clearOfflineOperatorSession(){
  if(typeof window==="undefined")return;
  try{localStorage.removeItem(KEY)}catch{}
}

export function readOfflineOperatorSession():Session|null{
  if(typeof window==="undefined")return null;
  try{
    const row=JSON.parse(localStorage.getItem(KEY)||"null") as Snapshot|null;
    if(!row?.id||!row?.username||!Number.isFinite(Number(row.savedAt)))return null;
    if(Date.now()-Number(row.savedAt)>MAX_AGE_MS){localStorage.removeItem(KEY);return null}
    return {
      user:{id:row.id,username:row.username,role:"staff",permissions:{order:true,queue:true}},
      csrf:"",
      offline:true
    };
  }catch{return null}
}

export async function getOfflineOperatorIfReady(options:{allowNetworkUncertain?:boolean}={}){
  if(typeof navigator==="undefined")return null;
  if(navigator.onLine&&!options.allowNetworkUncertain)return null;
  const storage=await clientStorageStatus().catch(()=>null);
  if(!storage?.cacheReady)return null;
  return readOfflineOperatorSession();
}
