const UPDATES=Object.freeze([
  Object.freeze({
    id:'field-orange-2026-10-03-25-145',
    menuId:'field-orange',
    from:Object.freeze({orangeMix:35,water:135}),
    to:Object.freeze({orangeMix:25,water:145}),
  }),
]);

const n=v=>Number(v);

export function findApprovedRecipeDrift(menu=[]){
  const found=[];
  for(const update of UPDATES){
    const product=(menu||[]).find(m=>m?.id===update.menuId&&!m?.archived);
    if(!product)continue;
    for(const variant of product.variants||[]){
      const items=variant?.recipe?.items;
      if(!items||typeof items!=='object'||Array.isArray(items))continue;
      const matches=Object.entries(update.from).every(([id,qty])=>n(items[id])===qty);
      if(matches)found.push({
        updateId:update.id,menuId:update.menuId,menuName:String(product.name||update.menuId),
        variant:String(variant.label||'Standard'),from:{...update.from},to:{...update.to},
      });
    }
  }
  return found;
}

export function applyApprovedRecipeUpdate(menu=[],updateId){
  const update=UPDATES.find(x=>x.id===updateId);
  if(!update)throw new Error('approved_recipe_update_not_found');
  const product=(menu||[]).find(m=>m?.id===update.menuId&&!m?.archived);
  if(!product)throw new Error('approved_recipe_menu_not_found');
  const drift=findApprovedRecipeDrift([product]).find(x=>x.updateId===updateId);
  if(!drift)throw new Error('approved_recipe_not_legacy_match');
  const variant=(product.variants||[]).find(v=>String(v.label||'Standard')===drift.variant);
  variant.recipe={...(variant.recipe||{}),items:{...(variant.recipe?.items||{}),...update.to}};
  return {update,product,variant,items:{...variant.recipe.items}};
}

export function approvedRecipeUpdates(){return UPDATES.map(x=>({id:x.id,menuId:x.menuId,from:{...x.from},to:{...x.to}}))}
