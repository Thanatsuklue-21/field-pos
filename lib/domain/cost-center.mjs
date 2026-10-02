const n=value=>Number.isFinite(Number(value))?Number(value):0;

export function buildMenuCostRows({menu=[],ingredients={},estimatedVariableCost=2.5}={}){
  const rows=[];
  for(const product of menu){
    if(product.archived)continue;
    for(const variant of product.variants||[]){
      const detail=Object.entries(variant.recipe?.items||{}).map(([ingredientId,qty])=>{
        const ingredient=ingredients[ingredientId]||{};
        const unitCost=n(ingredient.unitCost),usage=n(qty);
        return {ingredientId,name:String(ingredient.name||ingredientId),qty:usage,unit:String(ingredient.unit||'g'),unitCost,cost:usage*unitCost};
      });
      const actualCogs=Math.round(detail.reduce((sum,x)=>sum+x.cost,0)*1e6)/1e6,price=n(product.price);
      rows.push({menuId:product.id,name:product.name,category:product.category||'OTHER',variant:variant.label||'Standard',price,recipeVersion:n(variant.recipeVersion)||null,detail,ingredientCost:actualCogs,actualCogs,estimatedVariableCost:n(estimatedVariableCost),grossProfit:price-actualCogs,grossMargin:price?((price-actualCogs)/price)*100:0,contributionProfit:price-actualCogs-n(estimatedVariableCost)});
    }
  }
  return rows;
}

export function comparePurchaseSources(records=[]){
  const normalized=records.map(x=>({...x,quantityReceived:n(x.quantityReceived),totalCost:n(x.totalCost),unitCost:n(x.quantityReceived)>0?n(x.totalCost)/n(x.quantityReceived):0,best:false}));
  const bestByIngredient=new Map();
  for(const row of normalized){if(!row.unitCost)continue;const old=bestByIngredient.get(row.ingredientId);if(!old||row.unitCost<old.unitCost)bestByIngredient.set(row.ingredientId,row)}
  for(const row of normalized)row.best=bestByIngredient.get(row.ingredientId)===row;
  return normalized.sort((a,b)=>String(a.ingredientId).localeCompare(String(b.ingredientId))||a.unitCost-b.unitCost||String(b.purchasedAt||'').localeCompare(String(a.purchasedAt||'')));
}
