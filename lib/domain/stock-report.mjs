const number=value=>Number.isFinite(Number(value))?Number(value):0;
export function stockReportRows(ingredients={}){
  return Object.entries(ingredients).map(([ingredientId,row])=>{
    const qty=number(row.qty),unitCost=Math.max(0,number(row.unitCost));
    return {ingredientId,name:String(row.name||ingredientId),qty,unit:String(row.unit||'g'),unitCost,
      value:Math.max(0,qty)*unitCost,costStatus:String(row.costStatus||(unitCost>0?'CONFIRMED':'MISSING')).toUpperCase(),
      archived:row.archived?'yes':'no',reconciliationRequired:qty<0};
  });
}
