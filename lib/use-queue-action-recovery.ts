"use client";

import {useCallback,useEffect,useRef,useState} from "react";
import {api,type Session} from "@/lib/api-client";
import {
  prepareQueueActionIntent,readQueueActionIntent,sendQueueActionIntent,
  type QueueActionBody,type QueueActionIntent
} from "@/lib/queue-action-recovery";

type Options={
  session:Session;
  enabled?:boolean;
  timeoutMs?:number;
  onRecovered?:(result:any)=>void|Promise<void>;
  onRecoveryError?:(error:any)=>void|Promise<void>;
};

export function useQueueActionRecovery({
  session,enabled=true,timeoutMs=20_000,onRecovered,onRecoveryError
}:Options){
  const [pending,setPending]=useState<QueueActionIntent|null>(null);
  const [blocked,setBlocked]=useState(false);
  const [recovering,setRecovering]=useState(false);
  const inFlightRef=useRef(false);
  const recoveredRef=useRef(onRecovered);
  const recoveryErrorRef=useRef(onRecoveryError);
  recoveredRef.current=onRecovered;
  recoveryErrorRef.current=onRecoveryError;

  const readCurrent=useCallback(()=>{
    try{
      const intent=readQueueActionIntent(session.user.id);
      setPending(intent);setBlocked(false);
      return intent;
    }catch(error){
      setBlocked(true);
      throw error;
    }
  },[session.user.id]);

  const executeIntent=useCallback(async(intent:QueueActionIntent)=>{
    if(inFlightRef.current)throw Object.assign(new Error("queue_action_busy"),{status:409});
    inFlightRef.current=true;
    const controller=new AbortController();
    const timer=window.setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const result=await sendQueueActionIntent(intent,payload=>api<any>("/api/pos/queue",{
        method:"POST",
        headers:{"X-CSRF-Token":session.csrf},
        body:JSON.stringify(payload),
        signal:controller.signal
      }));
      setPending(null);setBlocked(false);
      return result;
    }catch(error:any){
      try{setPending(readQueueActionIntent(session.user.id));setBlocked(false)}
      catch{setBlocked(true)}
      if(controller.signal.aborted)throw Object.assign(new Error("queue_action_result_unknown"),{status:0,cause:error});
      throw error;
    }finally{
      window.clearTimeout(timer);
      inFlightRef.current=false;
    }
  },[session.csrf,session.user.id,timeoutMs]);

  const send=useCallback(async(body:QueueActionBody)=>{
    if(inFlightRef.current)throw Object.assign(new Error("queue_action_busy"),{status:409});
    let intent:QueueActionIntent;
    try{
      intent=prepareQueueActionIntent(session.user.id,body);
      setPending(intent);setBlocked(false);
    }catch(error){
      try{readCurrent()}catch{}
      throw error;
    }
    return executeIntent(intent);
  },[executeIntent,readCurrent,session.user.id]);

  const recover=useCallback(async()=>{
    if(!enabled||inFlightRef.current)return null;
    let intent:QueueActionIntent|null=null;
    try{intent=readCurrent()}
    catch(error:any){
      await recoveryErrorRef.current?.(error);
      return null;
    }
    if(!intent)return null;
    setRecovering(true);
    try{
      const result=await executeIntent(intent);
      await recoveredRef.current?.(result);
      return result;
    }catch(error:any){
      await recoveryErrorRef.current?.(error);
      return null;
    }finally{setRecovering(false)}
  },[enabled,executeIntent,readCurrent]);

  useEffect(()=>{
    if(!enabled)return;
    let disposed=false;
    const replay=()=>{if(!disposed)recover().catch(()=>{})};
    const visible=()=>{if(document.visibilityState==="visible")replay()};
    replay();
    window.addEventListener("online",replay);
    window.addEventListener("focus",replay);
    document.addEventListener("visibilitychange",visible);
    return()=>{
      disposed=true;
      window.removeEventListener("online",replay);
      window.removeEventListener("focus",replay);
      document.removeEventListener("visibilitychange",visible);
    };
  },[enabled,recover]);

  return {
    pending,blocked,recovering,
    locked:blocked||recovering||!!pending,
    send,recover,readCurrent
  };
}
