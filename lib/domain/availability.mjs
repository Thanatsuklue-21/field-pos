import {add,sub,mul,div,cmp,decimalString} from './exact-quantity.mjs';
const number=value=>Number.isFinite(Number(value))?Number(value):0;
const servings=(quantity,usage)=>{const value=div(quantity,usage);return Number(value.n/value.d>BigInt(Number.MAX_SAFE_INTEGER)?BigInt(Number.MAX_SAFE_INTEGER):value.n/value.d)};

function normalizedRecipe(recipe){
  const items=recipe?.items;
  if(!items||typeof items!=='object'||Array.isArray(items))return null;
  const entries=Object.entries(items).map(([id,qty])=>[String(id),Number(qty)]).filter(([,qty])=>qty>0);
  if(!entries.length||Object.values(items).some(qty=>!Number.isFinite(Number(qty))||Number(qty)<0))return null;
  return Object.fromEntries(entries);
}

export function variantAvailability({recipe,ingredients={},lowServings=5}={}){
  const recipeItems=normalizedRecipe(recipe);
  if(!recipeItems)return {available:false,maxServings:0,lowStock:false,recipeItems:{},missingIngredients:[],reason:'recipe_missing'};
  const missingIngredients=[];
  let maxServings=Number.MAX_SAFE_INTEGER;
  for(const [ingredientId,required] of Object.entries(recipeItems)){
    const ingredient=ingredients[ingredientId],qty=Math.max(0,number(ingredient?.qty));
    maxServings=Math.min(maxServings,servings(qty,required));
    if(!ingredient||cmp(qty,required)<0)missingIngredients.push({id:ingredientId,name:String(ingredient?.name||ingredientId)});
  }
  maxServings=Math.max(0,Number.isFinite(maxServings)?maxServings:0);
  const available=maxServings>=1;
  return {available,maxServings,lowStock:available&&maxServings<=Math.max(1,number(lowServings)||5),recipeItems,missingIngredients,reason:available?null:'stock_shortage'};
}

export function buildPosAvailability({menu=[],ingredients={},lowServings=5}={}){
  const stock=Object.fromEntries(Object.entries(ingredients).map(([id,value])=>[id,{qty:Math.max(0,number(value?.qty)),name:String(value?.name||id)}]));
  const decorated=menu.map(product=>{
    const variants=(Array.isArray(product.variants)?product.variants:[]).map(variant=>({
      label:String(variant.label||''),
      ...variantAvailability({recipe:variant.recipe,ingredients,lowServings})
    }));
    const availableVariants=variants.filter(variant=>variant.available);
    return {...product,variants,available:availableVariants.length>0,maxServings:availableVariants.length?Math.max(...availableVariants.map(variant=>variant.maxServings)):0,lowStock:availableVariants.length>0&&availableVariants.every(variant=>variant.lowStock)};
  });
  return {menu:decorated,stock};
}

function variantKey(id,label){return String(id)+'\u0000'+String(label)}
function buildVariantLookup(menu=[]){
  const lookup=new Map();
  for(const product of menu)for(const variant of product?.variants||[])lookup.set(variantKey(product?.id,variant?.label),variant);
  return lookup;
}
function findVariant(menu,id,label){return menu.find(product=>product.id===id)?.variants?.find(variant=>variant.label===label)}

export function cartAvailability({cart=[],menu=[],stock={}}={}){
  const demand={};const invalid=[],variants=buildVariantLookup(menu);
  for(const item of cart){
    const variant=variants.get(variantKey(item.id,item.variant)),qty=number(item.qty);
    if(!variant?.available||!variant.recipeItems||!Number.isInteger(qty)||qty<1){invalid.push({id:item.id,variant:item.variant});continue}
    for(const [ingredientId,usage] of Object.entries(variant.recipeItems))demand[ingredientId]=add(demand[ingredientId]||0,mul(usage,qty));
  }
  const shortages=Object.entries(demand).filter(([ingredientId,required])=>cmp(number(stock[ingredientId]?.qty),required)<0).map(([ingredientId,required])=>({
    id:ingredientId,name:String(stock[ingredientId]?.name||ingredientId),required:Number(decimalString(required)),available:number(stock[ingredientId]?.qty)
  }));
  return {available:invalid.length===0&&shortages.length===0,demand:Object.fromEntries(Object.entries(demand).map(([id,qty])=>[id,Number(decimalString(qty))])),invalid,shortages};
}

export function additionalServingsForVariant({variant,demand={},stock={}}={}){
  if(!variant?.available||!variant.recipeItems)return 0;
  let result=Number.MAX_SAFE_INTEGER;
  for(const [ingredientId,usage] of Object.entries(variant.recipeItems)){
    const perServing=number(usage);
    if(perServing<=0)return 0;
    const remaining=sub(number(stock[ingredientId]?.qty),number(demand[ingredientId]));
    result=Math.min(result,cmp(remaining,0)<=0?0:servings(remaining,perServing));
  }
  return Math.max(0,Number.isFinite(result)?result:0);
}

export function additionalServingsAvailable({cart=[],menu=[],stock={},menuId,variantLabel,demand}={}){
  const variant=findVariant(menu,menuId,variantLabel);
  const current=demand&&typeof demand==='object'&&!Array.isArray(demand)?demand:cartAvailability({cart,menu,stock}).demand;
  return additionalServingsForVariant({variant,demand:current,stock});
}
