import {sumMoney} from './money.mjs';
const n=v=>Number.isFinite(Number(v))?Number(v):0;
export function expenseBreakdown(expenses=[]){
  const purchases=[],operating=[];
  for(const e of expenses||[]){const amount=Math.max(0,n(e?.amount));if(String(e?.category||'').toUpperCase()==='PURCHASE')purchases.push(amount);else operating.push(amount)}
  const purchaseSpend=sumMoney(purchases),operatingExpenses=sumMoney(operating);
  return {purchaseSpend,operatingExpenses,totalCashOut:sumMoney([purchaseSpend,operatingExpenses])};
}
export function cashExpenseTotal(expenses=[]){
  return sumMoney((expenses||[]).filter(e=>String(e?.paymentMethod||'').toLowerCase()==='cash').map(e=>Math.max(0,n(e?.amount))));
}
export function inventoryValuation(ingredients={}){
  const rows=Object.entries(ingredients||{}).map(([id,x])=>{
    const qty=Math.max(0,n(x?.qty)),unitCost=Math.max(0,n(x?.unitCost)),costStatus=String(x?.costStatus||(unitCost>0?'CONFIRMED':'MISSING')).toUpperCase();
    return {id,name:String(x?.name||id),qty,unit:String(x?.unit||'g'),unitCost,costStatus,value:qty*unitCost,archived:!!x?.archived};
  }).filter(x=>x.qty>0);
  const value=rows.reduce((s,x)=>s+x.value,0),missingCost=rows.filter(x=>x.costStatus==='MISSING').length,provisionalCost=rows.filter(x=>x.costStatus==='PROVISIONAL').length;
  return {value,items:rows.length,missingCost,provisionalCost,isEstimated:missingCost>0||provisionalCost>0,rows};
}
export function profitSummary({revenue=0,cogs=0,expenses=[]}={}){
  const r=n(revenue),cost=n(cogs),x=expenseBreakdown(expenses);
  return {...x,grossProfit:sumMoney([r,-cost]),operatingProfit:sumMoney([r,-cost,-x.operatingExpenses])};
}
