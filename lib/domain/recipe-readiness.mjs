import {variantAvailability} from './availability.mjs';
import {operationalUnitCost} from './costing.mjs';

const n=value=>Number.isFinite(Number(value))?Number(value):0;

export function recipeReleaseReadiness({recipe,ingredients={},lowServings=5}={}){
  const availability=variantAvailability({recipe,ingredients,lowServings});
  const items=availability.recipeItems||{};
  const missingIngredients=[],archivedIngredients=[],missingCost=[],pendingCost=[];
  let standardCost=0;
  for(const [ingredientId,qty] of Object.entries(items)){
    const ingredient=ingredients[ingredientId];
    if(!ingredient){missingIngredients.push(ingredientId);continue}
    if(ingredient.archived)archivedIngredients.push(ingredientId);
    const raw=n(ingredient.unitCost),unit=operationalUnitCost(ingredient,ingredientId);
    const status=String(ingredient.costStatus||(raw>0?'CONFIRMED':'MISSING')).toUpperCase();
    standardCost+=n(qty)*unit;
    if(raw<=0||status==='MISSING')missingCost.push(ingredientId);
    else if(status==='PROVISIONAL')pendingCost.push(ingredientId);
  }
  const recipeValid=availability.reason!=='recipe_missing'&&missingIngredients.length===0&&archivedIngredients.length===0;
  const costStatus=missingCost.length?'MISSING':pendingCost.length?'PROVISIONAL':'CONFIRMED';
  return {
    recipeValid,
    sellableNow:recipeValid&&availability.available,
    maxServings:recipeValid?availability.maxServings:0,
    lowStock:recipeValid&&availability.lowStock,
    stockReason:availability.reason,
    missingIngredients,
    archivedIngredients,
    missingCost,
    pendingCost,
    costStatus,
    standardCost:Math.round(standardCost*1e6)/1e6
  };
}
