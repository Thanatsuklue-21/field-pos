const n=v=>Number.isFinite(Number(v))?Number(v):0;
export function expenseBreakdown(expenses=[]){
  let purchaseSpend=0,operatingExpenses=0;
  for(const e of expenses||[]){const amount=Math.max(0,n(e?.amount));if(String(e?.category||'').toUpperCase()==='PURCHASE')purchaseSpend+=amount;else operatingExpenses+=amount}
  return {purchaseSpend,operatingExpenses,totalCashOut:purchaseSpend+operatingExpenses};
}
export function profitSummary({revenue=0,cogs=0,expenses=[]}={}){
  const r=n(revenue),cost=n(cogs),x=expenseBreakdown(expenses);
  return {...x,grossProfit:r-cost,operatingProfit:r-cost-x.operatingExpenses};
}
