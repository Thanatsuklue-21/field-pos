export function reconcileCash({openingCash=0,cashSales=0,cashIn=0,cashPaidOut=0,cashOut=0,countedCash}={}){
  const opening=Number(openingCash),sales=Number(cashSales),added=Number(cashIn),paidOut=Number(cashPaidOut),removed=Number(cashOut),counted=Number(countedCash);
  if(!Number.isFinite(opening)||opening<0)throw new Error('invalid_opening_cash');
  if(!Number.isFinite(sales)||sales<0)throw new Error('invalid_cash_sales');
  if(!Number.isFinite(added)||added<0)throw new Error('invalid_cash_in');
  if(!Number.isFinite(paidOut)||paidOut<0)throw new Error('invalid_cash_paid_out');
  if(!Number.isFinite(removed)||removed<0)throw new Error('invalid_cash_out');
  if(!Number.isFinite(counted)||counted<0)throw new Error('counted_cash_required');
  const expectedCash=opening+sales+added-paidOut-removed;
  return {openingCash:opening,cashSales:sales,cashIn:added,cashPaidOut:paidOut,cashOut:removed,expectedCash,countedCash:counted,cashVariance:counted-expectedCash};
}
