"use client";

import {hasRecovery} from "@/lib/recovery-storage";

export type RecoveryDiagnostics={
  cartItems:number;
  heldBills:number;
  pendingPromptPay:boolean;
  pendingCash:boolean;
  pendingCloseDay:boolean;
  splitPayment:boolean;
  editCashOrder:boolean;
};

function countPersistedArray(storageKey:string,stateKey:string){
  if(typeof window==="undefined")return 0;
  try{
    const raw=localStorage.getItem(storageKey);
    if(!raw)return 0;
    const parsed=JSON.parse(raw);
    const value=parsed?.state?.[stateKey]??parsed?.[stateKey];
    return Array.isArray(value)?value.length:0;
  }catch{return 0}
}

export function readRecoveryDiagnostics(cartItems:number):RecoveryDiagnostics{
  if(typeof window==="undefined")return {cartItems:Math.max(0,cartItems),heldBills:0,pendingPromptPay:false,pendingCash:false,pendingCloseDay:false,splitPayment:false,editCashOrder:false};
  let pendingPromptPay=false,pendingCash=false,pendingCloseDay=false;
  try{
    pendingPromptPay=localStorage.getItem("field-pos-pending-promptpay-v1")!==null;
    pendingCash=localStorage.getItem("field-pos-pending-cash-v1")!==null;
    pendingCloseDay=localStorage.getItem("field-pos-pending-close-day-v1")!==null;
  }catch{}
  return {
    cartItems:Math.max(0,Math.trunc(Number(cartItems)||0)),
    heldBills:countPersistedArray("field-pos-held-carts-v1","held"),
    pendingPromptPay,
    pendingCash,
    pendingCloseDay,
    splitPayment:hasRecovery("field-pos-split-group-v1"),
    editCashOrder:hasRecovery("field-pos-edit-cash-v1")
  };
}

export function recoveryDiagnosticCount(value:RecoveryDiagnostics){
  return value.cartItems+value.heldBills+Number(value.pendingPromptPay)+Number(value.pendingCash)+Number(value.pendingCloseDay)+Number(value.splitPayment)+Number(value.editCashOrder);
}
