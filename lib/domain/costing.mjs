export const COSTING_METHOD = 'simplified';
export const COST_KINDS = Object.freeze(['other','powder','milk','water','syrup','concentrate']);

export function normalizeCostKind(value){
  const kind=String(value||'other').trim().toLowerCase();
  return COST_KINDS.includes(kind)?kind:'other';
}

const FIELD_DEFAULT_COST_KIND=Object.freeze({syrup:'syrup',coconutSyrup:'syrup',orangeMix:'concentrate'});

export function ingredientCostPolicy(ingredient={},ingredientId=''){
  const explicit=String(ingredient?.costKind||'').trim().toLowerCase();
  const kind=COST_KINDS.includes(explicit)?explicit:normalizeCostKind(FIELD_DEFAULT_COST_KIND[String(ingredientId)]||'other');
  const liquid=['syrup','concentrate'].includes(kind);
  const marginInput=ingredient?.wasteMargin;
  const wasteMargin=liquid?Math.min(.5,Math.max(0,(marginInput==null||marginInput==='')?.05:(Number(marginInput)||0))):0;
  return {kind,wasteMargin};
}

export function operationalUnitCost(ingredient={},ingredientId=''){
  const raw=Number(ingredient?.unitCost);
  if(!Number.isFinite(raw)||raw<0)return 0;
  const {wasteMargin}=ingredientCostPolicy(ingredient,ingredientId);
  return raw*(1+wasteMargin);
}

export function purchaseQtyToUsageGrams(qty, unit) {
  const value = Number(qty);
  if (!Number.isFinite(value) || value <= 0) throw new Error('invalid_purchase_qty');
  switch (String(unit || '').trim().toLowerCase()) {
    case 'g':
    case 'ml':
      return value;
    case 'kg':
    case 'l':
      return value * 1000;
    default:
      throw new Error('unsupported_purchase_unit');
  }
}

export function standardCostPerGram({
  purchasePrice,
  purchaseQty,
  purchaseUnit,
  kind = 'other',
  wasteMargin = 0,
}) {
  const price = Number(purchasePrice);
  if (!Number.isFinite(price) || price <= 0) throw new Error('invalid_purchase_price');
  const grams = purchaseQtyToUsageGrams(purchaseQty, purchaseUnit);
  const base = price / grams;
  const ingredientKind = String(kind).toLowerCase();
  const margin = ['syrup', 'concentrate'].includes(ingredientKind)
    ? Math.max(0, Number(wasteMargin) || 0)
    : 0;
  return base * (1 + margin);
}

export function recipeStandardCost(recipe, ingredients) {
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) throw new Error('invalid_recipe');
  if (!ingredients || typeof ingredients !== 'object' || Array.isArray(ingredients)) throw new Error('invalid_ingredients');

  return Object.entries(recipe).reduce((total, [ingredientId, usageG]) => {
    const usage = Number(usageG);
    if (!(usage > 0)) return total;
    const ingredient = ingredients[ingredientId];
    const unitCost = Number(ingredient?.unitCost);
    if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error(`missing_unit_cost:${ingredientId}`);
    return total + usage * unitCost;
  }, 0);
}

export function makeCostSnapshot({
  recipeVersion,
  recipe,
  ingredients,
  createdAt = Date.now(),
}) {
  const ingredientCosts = Object.fromEntries(
    Object.keys(recipe || {}).map((id) => [
      id,
      {
        usageG: Number(recipe[id]) || 0,
        unitCost: Number(ingredients?.[id]?.unitCost) || 0,
      },
    ]),
  );

  return {
    costingMethod: COSTING_METHOD,
    recipeVersion: recipeVersion || 'unknown',
    ingredientCosts,
    standardCost: recipeStandardCost(recipe, ingredients),
    createdAt,
  };
}
