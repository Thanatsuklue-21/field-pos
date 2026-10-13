export const CLOSE_DAY_LOCAL_RECOVERY_GUARDS=Object.freeze([
  Object.freeze({key:"field-pos-pending-promptpay-v1",label:"PromptPay",route:"/pos"}),
  Object.freeze({key:"field-pos-pending-cash-v1",label:"Cash Checkout",route:"/pos"}),
  Object.freeze({key:"field-pos-split-group-v1",label:"Split Payment",route:"/pos"}),
  Object.freeze({key:"field-pos-edit-cash-v1",label:"Order Edit",route:"/orders"}),
  Object.freeze({key:"field-pos-pending-queue-action-v1",label:"Queue Action",route:"/queue"}),
  Object.freeze({key:"field-pos-pending-expense-v1",label:"Expense",route:"/expenses"}),
  Object.freeze({key:"field-pos-pending-stock-transaction-v1",label:"Stock Transaction",route:"/stock"}),
  Object.freeze({key:"field-pos-pending-cycle-count-v1",label:"Cycle Count",route:"/stock"}),
  Object.freeze({key:"field-pos-pending-order-mutation-v1",label:"VOID / Refund",route:"/orders"}),
  Object.freeze({key:"field-pos-pending-cash-shift-open-v1",label:"Start Day",route:"/close"}),
  Object.freeze({key:"field-pos-pending-cash-movement-v1",label:"Cash Drawer",route:"/close"}),
  Object.freeze({key:"field-pos-pending-delivery-settlement-v1",label:"Delivery Settlement",route:"/reports"}),
  Object.freeze({key:"field-pos-pending-crm-points-v1",label:"CRM Points",route:"/customers"}),
  Object.freeze({key:"field-pos-pending-close-day-v1",label:"Close Day",route:"/close"}),
]);

export function findCloseDayLocalRecoveryBlockers({readLocal,readSession}){
  if(typeof readLocal!=="function"||typeof readSession!=="function")throw new Error("close_day_local_recovery_storage_unavailable");
  const blockers=[];
  for(const guard of CLOSE_DAY_LOCAL_RECOVERY_GUARDS){
    let localValue,sessionValue;
    try{
      localValue=readLocal(guard.key);
      sessionValue=readSession(guard.key);
    }catch{
      throw new Error("close_day_local_recovery_storage_unavailable");
    }
    if(localValue!==null||sessionValue!==null)blockers.push(guard);
  }
  return blockers;
}
