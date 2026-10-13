export const HIGH_RISK_POLICY=Object.freeze({
  cashOutExplicitConfirm:500
});

export function evaluateHighRiskAction(action,{user,reason='',amount=0,confirmed=false,policy=HIGH_RISK_POLICY}={}){
  const role=String(user?.role||'');
  const cleanReason=String(reason||'').trim();
  const fail=(code,status=400)=>({ok:false,code,status});
  if(['REFUND','VOID','CASH_OUT','CYCLE_COUNT_COMMIT'].includes(action)&&role!=='admin')return fail('admin_required',403);
  if(['REFUND','VOID','CASH_OUT'].includes(action)&&cleanReason.length<2)return fail('high_risk_reason_required');
  if(['REFUND','VOID'].includes(action)&&confirmed!==true)return fail('high_risk_confirmation_required');
  if(action==='CASH_OUT'&&Number(amount)>=policy.cashOutExplicitConfirm&&confirmed!==true)return fail('high_risk_confirmation_required');
  return {ok:true};
}

export const HUMAN_STOCK_TRANSACTION_TYPES=Object.freeze(new Set(['PURCHASE','WASTE']));
export function validateHumanStockTransaction({user,body}={}){
  if(!user)return {ok:false,code:'stock_permission_required',status:403};
  const type=String(body?.type||'');
  if(!HUMAN_STOCK_TRANSACTION_TYPES.has(type))return {ok:false,code:'system_stock_transaction_type',status:403};
  if(type==='WASTE'&&String(body?.reason||'').trim().length<2)return {ok:false,code:'waste_reason_required',status:400};
  return {ok:true};
}
