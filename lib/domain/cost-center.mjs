import {operationalUnitCost} from './costing.mjs';
const n=value=>Number.isFinite(Number(value))?Number(value):0;

export function buildMenuCostRows({menu=[],ingredients={},estimatedVariableCost=2.5}={}){
  const rows=[];
  for(const product of menu){
    if(product.archived)continue;
    for(const variant of product.variants||[]){
      const detail=Object.entries(variant.recipe?.items||{}).map(([ingredientId,qty])=>{
        const ingredient=ingredients[ingredientId]||{};
        const purchaseUnitCost=n(ingredient.unitCost),unitCost=operationalUnitCost(ingredient),usage=n(qty);
        const costStatus=String(ingredient.costStatus||(purchaseUnitCost>0?'CONFIRMED':'MISSING')).toUpperCase();
        return {ingredientId,name:String(ingredient.name||ingredientId),qty:usage,unit:String(ingredient.unit||'g'),purchaseUnitCost,unitCost,costKind:String(ingredient.costKind||'other'),wasteMargin:Number(ingredient.wasteMargin)||0,cost:usage*unitCost,costStatus};
      });
      const actualCogs=Math.round(detail.reduce((sum,x)=>sum+x.cost,0)*1e6)/1e6,price=n(product.price);
      const missingCost=detail.filter(x=>x.qty>0&&(x.unitCost<=0||x.costStatus==='MISSING')).map(x=>x.ingredientId),pendingCost=detail.filter(x=>x.qty>0&&x.costStatus==='PROVISIONAL').map(x=>x.ingredientId),isEstimated=missingCost.length>0||pendingCost.length>0;
      rows.push({menuId:product.id,name:product.name,category:product.category||'OTHER',variant:variant.label||'Standard',price,recipeVersion:n(variant.recipeVersion)||null,detail,ingredientCost:actualCogs,actualCogs,estimatedVariableCost:n(estimatedVariableCost),grossProfit:price-actualCogs,grossMargin:price?((price-actualCogs)/price)*100:0,contributionProfit:price-actualCogs-n(estimatedVariableCost),missingCost,pendingCost,isEstimated,costStatus:missingCost.length?'MISSING':pendingCost.length?'PROVISIONAL':'CONFIRMED'});
    }
  }
  return rows;
}

export function assessMenuCostQuality({menu=[],ingredients={}}={}){
  const rows=buildMenuCostRows({menu:menu.filter(product=>product.enabled&&!product.archived),ingredients,estimatedVariableCost:0});
  const missingCost=[...new Set(rows.flatMap(row=>row.missingCost))];
  const pendingCost=[...new Set(rows.flatMap(row=>row.pendingCost))];
  return {isEstimated:missingCost.length>0||pendingCost.length>0,missingCost,pendingCost,status:missingCost.length?'MISSING':pendingCost.length?'PROVISIONAL':'CONFIRMED'};
}

export function assessSalesCostQuality(sales=[]){
  const paid=sales.filter(sale=>sale.status==='paid');
  const missingSales=paid.filter(sale=>String(sale.costStatus||'').toUpperCase()==='MISSING').map(sale=>sale.id);
  const provisionalSales=paid.filter(sale=>String(sale.costStatus||'').toUpperCase()==='PROVISIONAL').map(sale=>sale.id);
  const unverifiedSales=paid.filter(sale=>!['CONFIRMED','PROVISIONAL','MISSING'].includes(String(sale.costStatus||'').toUpperCase())).map(sale=>sale.id);
  return {isEstimated:missingSales.length>0||provisionalSales.length>0||unverifiedSales.length>0,missingSales,provisionalSales,unverifiedSales,status:missingSales.length?'MISSING':provisionalSales.length?'PROVISIONAL':unverifiedSales.length?'LEGACY_UNVERIFIED':'CONFIRMED'};
}

export function comparePurchaseSources(records=[]){
  const normalized=records.map(x=>({...x,quantityReceived:n(x.quantityReceived),totalCost:n(x.totalCost),unitCost:n(x.quantityReceived)>0?n(x.totalCost)/n(x.quantityReceived):0,best:false}));
  const bestByIngredient=new Map();
  for(const row of normalized){if(!row.unitCost)continue;const old=bestByIngredient.get(row.ingredientId);if(!old||row.unitCost<old.unitCost)bestByIngredient.set(row.ingredientId,row)}
  for(const row of normalized)row.best=bestByIngredient.get(row.ingredientId)===row;
  return normalized.sort((a,b)=>String(a.ingredientId).localeCompare(String(b.ingredientId))||a.unitCost-b.unitCost||String(b.purchasedAt||'').localeCompare(String(a.purchasedAt||'')));
}
