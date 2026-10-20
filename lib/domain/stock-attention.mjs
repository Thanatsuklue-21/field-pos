import {buildPosAvailability} from './availability.mjs';
import {getMenuStructure} from './menu-structure.mjs';

// Read-only navigation guidance, using the same enabled/category/price policy as POS.
export function buildStockAttention(doc={}){
 const menu=Array.isArray(doc.menu)?doc.menu:[],ingredients=doc.ingredients||{};
 const categories=getMenuStructure(doc).categories;
 const key=name=>String(name||'OTHER').trim().toLocaleLowerCase('en-US');
 const active=menu.filter(row=>row&&!!row.enabled&&!row.archived&&Number.isFinite(Number(row.price))&&Number(row.price)>0&&categories.find(category=>key(category.name)===key(row.category))?.enabled!==false);
 const affected=new Map(),missing=new Set();let blockedMenus=0;
 for(const product of buildPosAvailability({menu:active,ingredients}).menu){
  const shortages=product.variants.filter(variant=>variant.reason==='stock_shortage');
  if(!shortages.length)continue;
  blockedMenus++;
  for(const variant of shortages)for(const item of variant.missingIngredients){
   if(!ingredients[item.id]||ingredients[item.id].archived){missing.add(item.id);continue}
   if(!affected.has(item.id))affected.set(item.id,new Set());
   affected.get(item.id).add(String(product.name||product.id));
  }
 }
 return {blockedMenus,ingredients:[...affected].map(([id,names])=>({id,menuNames:[...names]})),missingReferences:missing.size};
}
