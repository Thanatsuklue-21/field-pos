export function reconcileCash({openingCash=0,cashSales=0,countedCash}={}){
  const opening=Number(openingCash),sales=Number(cashSales),counted=Number(countedCash);
  if(!Number.isFinite(opening)||opening<0)throw new Error('invalid_opening_cash');
  if(!Number.isFinite(sales)||sales<0)throw new Error('invalid_cash_sales');
  if(!Number.isFinite(counted)||counted<0)throw new Error('counted_cash_required');
  const expectedCash=opening+sales;
  return {openingCash:opening,cashSales:sales,expectedCash,countedCash:counted,cashVariance:counted-expectedCash};
}
