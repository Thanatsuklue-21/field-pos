import {buildPosAvailability} from './availability.mjs';
import {assessMenuCostQuality} from './cost-center.mjs';
import {getMenuStructure} from './menu-structure.mjs';

// Read-only diagnostics. Never changes sellability, cost snapshots or transaction gates.
export function buildCatalogReadiness({menu=[],ingredients={},settings={}}={}){
 const categories=getMenuStructure({menu,settings}).categories;
 const categoryEnabled=name=>categories.find(row=>row.name.trim().toLocaleLowerCase('en-US')===String(name||'OTHER').trim().toLocaleLowerCase('en-US'))?.enabled!==false;
 const active=menu.filter(row=>row&&!!row.enabled&&!row.archived&&categoryEnabled(row.category));
 const issues=[];
 const add=(code,title,href,action,items)=>{if(items.length)issues.push({code,title,href,action,count:items.length,items:items.slice(0,8)})};
 if(!active.length)add('no_active_menu','ยังไม่มีเมนูเปิดขาย','/products','ไปจัดเมนู',[{name:'เมนู',detail:'เปิดเมนูหลังตรวจราคาและสูตรแล้ว'}]);
 add('price_invalid','ตรวจราคาขาย','/products','ไปตรวจราคา',active.filter(row=>!Number.isFinite(Number(row.price))||Number(row.price)<=0).map(row=>({name:String(row.name||row.id),detail:'ราคาขายต้องมากกว่าศูนย์และเป็นตัวเลขที่ถูกต้อง'})));
 const invalidRecipes=[],used=new Set(),invalidVariants=new Set();
 for(const product of active){
  const variants=Array.isArray(product.variants)?product.variants:[];
  if(!variants.length)invalidRecipes.push({name:String(product.name||product.id),detail:'ยังไม่มีสูตรหรือระดับความหวาน'});
  for(const variant of variants){
   const raw=variant?.recipe?.items;
   const entries=raw&&typeof raw==='object'&&!Array.isArray(raw)?Object.entries(raw):[];
   const name=String(product.name||product.id)+' · '+String(variant.label||'สูตร');
   if(!entries.length)invalidVariants.add(String(product.id)+"\0"+String(variant.label||""));
   if(!entries.length)invalidRecipes.push({name,detail:'ยังไม่มีวัตถุดิบในสูตร'});
   for(const [id,qty] of entries){
    used.add(id);
    if(!ingredients[id]||!Number.isFinite(Number(qty))||Number(qty)<=0){invalidVariants.add(String(product.id)+"\0"+String(variant.label||""));invalidRecipes.push({name,detail:'ตรวจวัตถุดิบ '+String(ingredients[id]?.name||id)+' และปริมาณที่ใช้'})}
   }
  }
 }
 add('recipe_invalid','ตรวจสูตรและวัตถุดิบที่อ้างอิง','/recipes','ไปตรวจสูตร',invalidRecipes);
 const available=buildPosAvailability({menu:active,ingredients}).menu;
 add('stock_shortage','วัตถุดิบไม่พอสำหรับบางเมนู','/stock','ไปตรวจของจริง / รับเข้า',available.flatMap(product=>product.variants.filter(variant=>variant.reason==='stock_shortage').map(variant=>({name:product.name+' · '+variant.label,detail:'ขาด '+variant.missingIngredients.map(row=>row.name).join(', ')}))));
 const quality=assessMenuCostQuality({menu:active.map(row=>({...row,enabled:true})),ingredients});
 const costIds=[...new Set([...quality.missingCost,...quality.pendingCost])];
 add('cost_unconfirmed','ต้นทุนยังไม่ครบหรือยังไม่ยืนยัน','/costs','ไปตรวจต้นทุน',costIds.map(id=>({name:String(ingredients[id]?.name||id),detail:'ตรวจราคาซื้อและต้นทุนต่อหน่วยก่อนใช้ตัวเลขกำไร'})));
 add('packaging_invalid','ตรวจหน่วยและข้อมูลบรรจุภัณฑ์','/stock','ไปตรวจหน่วยวัตถุดิบ',[...used].filter(id=>{
  const row=ingredients[id];if(!row)return false;
  const pack=row.purchaseProfile?.quantityPerPackage;
  return !String(row.unit||'').trim()||(pack!==undefined&&pack!==null&&(!Number.isFinite(Number(pack))||Number(pack)<=0));
 }).map(id=>({name:String(ingredients[id]?.name||id),detail:'ตรวจหน่วยที่สูตรใช้และจำนวนต่อแพ็กให้ตรงกับของจริง'})));
 return {status:issues.length?'REVIEW':'READY',activeMenus:active.length,availableMenus:available.filter(row=>row.variants.some(variant=>variant.available&&!invalidVariants.has(String(row.id)+"\0"+variant.label))&&Number.isFinite(Number(row.price))&&Number(row.price)>0).length,issues};
}
