"use client";

export function readRecovery<T>(key:string):T|null{
  if(typeof window==="undefined")return null;
  try{
    const raw=localStorage.getItem(key);
    if(raw)return JSON.parse(raw) as T;
    const legacy=sessionStorage.getItem(key);
    if(!legacy)return null;
    localStorage.setItem(key,legacy);
    sessionStorage.removeItem(key);
    return JSON.parse(legacy) as T;
  }catch{return null}
}

export function writeRecovery<T>(key:string,value:T){
  if(typeof window==="undefined")return;
  try{localStorage.setItem(key,JSON.stringify(value));sessionStorage.removeItem(key)}catch{}
}

export function clearRecovery(key:string){
  if(typeof window==="undefined")return;
  try{localStorage.removeItem(key);sessionStorage.removeItem(key)}catch{}
}

export function hasRecovery(key:string){
  if(typeof window==="undefined")return false;
  try{return localStorage.getItem(key)!==null||sessionStorage.getItem(key)!==null}catch{return false}
}
