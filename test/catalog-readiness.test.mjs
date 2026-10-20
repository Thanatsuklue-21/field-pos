import test from 'node:test';
import assert from 'node:assert/strict';
const load=()=>import('../lib/domain/catalog-readiness.mjs');
const good=()=>({menu:[{id:'latte',enabled:true,name:'Latte',price:55,variants:[{label:'100%',recipe:{items:{milk:100}}}]}],ingredients:{milk:{name:'Milk',qty:1000,unit:'g',unitCost:.05,costStatus:'CONFIRMED'}}});
test('catalog diagnostics use current availability and do not change input',async()=>{
 const {buildCatalogReadiness}=await load();const input=good();input.ingredients.milk.qty=0;const before=JSON.stringify(input);const r=buildCatalogReadiness(input);
 assert.equal(JSON.stringify(input),before);assert.equal(r.availableMenus,0);assert.equal(r.activeMenus,1);
 const issue=r.issues.find(x=>x.code==='stock_shortage');assert.equal(issue.href,'/stock');assert.ok(issue.items.some(x=>x.detail.includes('Milk')));assert.equal(r.status,'REVIEW');
});
test('prices recipes costs packaging produce separate actionable checks',async()=>{
 const {buildCatalogReadiness}=await load();const input=good();input.menu[0].price=0;input.ingredients.milk.unitCost=0;input.ingredients.milk.purchaseProfile={quantityPerPackage:-1};
 const r=buildCatalogReadiness(input);for(const [code,href] of [['price_invalid','/products'],['cost_unconfirmed','/costs'],['packaging_invalid','/stock']])assert.equal(r.issues.find(x=>x.code===code)?.href,href);
 input.menu[0].variants=[];assert.equal(buildCatalogReadiness(input).issues.find(x=>x.code==='recipe_invalid').href,'/recipes');
});
test('clean menu is ready while archived/disabled menus and unused stock are ignored',async()=>{
 const {buildCatalogReadiness}=await load();const input=good();input.menu.push({id:'off',enabled:false,price:0},{id:'old',enabled:true,archived:true,price:0});input.ingredients.unused={qty:0};
 assert.equal(buildCatalogReadiness(input).status,'READY');assert.deepEqual(buildCatalogReadiness(input).issues,[]);
 assert.equal(buildCatalogReadiness({menu:[],ingredients:{}}).issues[0].code,'no_active_menu');
});
test('report records missing ingredient and provisional cost without granting permission',async()=>{
 const {buildCatalogReadiness}=await load();const input=good();input.ingredients.milk.costStatus='PROVISIONAL';assert.ok(buildCatalogReadiness(input).issues.some(x=>x.code==='cost_unconfirmed'));
 delete input.ingredients.milk;const r=buildCatalogReadiness(input);assert.ok(r.issues.some(x=>x.code==='recipe_invalid'));assert.ok(r.issues.every(x=>x.href.startsWith('/')));
});

test('invalid zero recipe entries never count as ready-to-sell menus',async()=>{
 const {buildCatalogReadiness}=await load();const input=good();input.menu[0].variants[0].recipe.items.water=0;input.ingredients.water={name:"Water",qty:100,unit:"g",unitCost:1};
 assert.equal(buildCatalogReadiness(input).availableMenus,0);
});

test('a valid variant remains available when another variant needs recipe review',async()=>{
 const {buildCatalogReadiness}=await load();const input=good();input.menu[0].variants.push({label:'broken',recipe:{items:{milk:0}}});
 assert.equal(buildCatalogReadiness(input).availableMenus,1);
});

test('catalog matches explicit menu and category visibility used by POS',async()=>{
 const {buildCatalogReadiness}=await load();const input=good();
 input.menu.push({id:'unset',price:0},{id:'hidden',enabled:true,category:'Hidden',price:0});
 input.settings={menuCategories:[{name:'Hidden',enabled:false}]};
 const result=buildCatalogReadiness(input);assert.equal(result.activeMenus,1);assert.equal(result.availableMenus,1);assert.equal(result.status,'READY');
});
