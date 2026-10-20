import test from 'node:test';
import assert from 'node:assert/strict';
const load=()=>import('../lib/domain/stock-attention.mjs');
const product=(id,items,extra={})=>({id,name:id,enabled:true,price:50,variants:[{label:'normal',recipe:{items}}],...extra});
test('stock attention groups current menu blockers without modifying state or exposing prices',async()=>{
 const {buildStockAttention}=await load();
 const doc={menu:[product('Latte',{milk:100}),product('Cocoa',{milk:100,cocoa:10})],ingredients:{milk:{name:'Milk',qty:0},cocoa:{qty:0},unused:{qty:0}}};
 const before=JSON.stringify(doc),r=buildStockAttention(doc);
 assert.equal(JSON.stringify(doc),before);assert.equal(r.blockedMenus,2);
 assert.deepEqual(r.ingredients,[{id:'milk',menuNames:['Latte','Cocoa']},{id:'cocoa',menuNames:['Cocoa']}]);
 assert.equal(r.missingReferences,0);assert.doesNotMatch(JSON.stringify(r),/price|recipe|unitCost/);
 doc.ingredients.milk.qty=1000;doc.ingredients.cocoa.qty=100;
 assert.deepEqual(buildStockAttention(doc),{blockedMenus:0,ingredients:[],missingReferences:0});
});
test('stock attention ignores disabled archived invalid-price and hidden-category menus',async()=>{
 const {buildStockAttention}=await load();
 const menu=[product('off',{milk:10},{enabled:false}),product('old',{milk:10},{archived:true}),product('hidden',{milk:10},{category:'Hidden'}),product('zero',{milk:10},{price:0}),product('unset',{milk:10},{enabled:undefined})];
 assert.equal(buildStockAttention({menu,ingredients:{milk:{qty:0}},settings:{menuCategories:[{name:'Hidden',enabled:false}]}}).blockedMenus,0);
});
test('missing references are separate from receivable stock and duplicate variants count once',async()=>{
 const {buildStockAttention}=await load();const menu=[product('Latte',{missing:10,milk:100})];menu[0].variants.push({label:'less',recipe:{items:{milk:50}}});
 const r=buildStockAttention({menu,ingredients:{milk:{qty:0}}});
 assert.equal(r.blockedMenus,1);assert.equal(r.missingReferences,1);assert.deepEqual(r.ingredients,[{id:'milk',menuNames:['Latte']}]);
});
