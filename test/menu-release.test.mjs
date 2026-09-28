import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {previewSnapshot} from '../lib/migration.mjs';

const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');

test('approved menu release is the only active master recipe',()=>{
  assert.match(html,/FIELD_DATA_VERSION='2026-09-28\.31'/);
  assert.match(html,/id:'pure-matcha'.*enabled:true.*iced\(\{matcha:4,water:170\}\)/);
  assert.match(html,/id:'matcha-latte'.*enabled:true.*iced\(\{matcha:5,water:40,milk:110,syrup:15\}\)/);
  assert.match(html,/id:'matcha-signature'.*name:'FIELD Matcha Signature'.*v\('100%'.*condensed:30,evaporated:30,milk:70.*v\('50%'.*condensed:15,evaporated:30,milk:70.*v\('0%'.*milk:110,evaporated:15/);
  assert.match(html,/id:'coconut-matcha'.*price:60,enabled:true.*coconutSyrup:20/);
  assert.match(html,/id:'field-orange'.*price:45,enabled:true.*orangeMix:35,water:135/);
  assert.match(html,/id:'strawberry-matcha'.*enabled:false,status:'HOLD'/);
  assert.match(html,/id:'honey-matcha'.*price:0,enabled:false,status:'CUT \/ INACTIVE'/);
  const activeCoconut=html.match(/\{id:'coconut-matcha'.*?\},\n/)?.[0]||'';
  assert.doesNotMatch(activeCoconut,/Nature Taste/);
});

test('authoritative unit costs and ice policy are locked',()=>{
  for(const fragment of [
    "unitCost:2.076,costSource:'519 บาท / 250 g'",
    "unitCost:0.0525,costSource:'105 บาท / 2000 ml'",
    "unitCost:0.0645,costSource:'129 บาท / 2000 g'",
    "unitCost:0.099,costSource:'99 บาท / 1000 ml'",
    "unitCost:0.04625,costSource:'37 บาท / 800 ml'",
    "unitCost:0.2653,costSource:'199 บาท / 750 ml'",
    "unitCost:0.225,costSource:'225 บาท / 1000 ml'",
    "unitCost:0.0075,costSource:'54 บาท / 7200 ml'",
    "ice:210",
    "unitCost:0.0025,costSource:'50 บาท / 20 kg'",
    'const ESTIMATED_VARIABLE_COST=2.50'
  ]) assert.ok(html.includes(fragment),`missing ${fragment}`);
  assert.doesNotMatch(html,/Waste 5% ของวัตถุดิบ/);
});

test('actual COGS excludes estimated variable cost',()=>{
  const unit={matcha:2.076,water:.0075,milk:.0525,syrup:.04625,condensed:.0645,evaporated:.099,coconut:.2653,orange:.225};
  const fixed=1.8+.5+.2+.5+210*.0025;
  const totals={
    pure:4*unit.matcha+170*unit.water+fixed,
    latte:5*unit.matcha+40*unit.water+110*unit.milk+15*unit.syrup+fixed,
    signature100:5*unit.matcha+40*unit.water+30*unit.condensed+30*unit.evaporated+70*unit.milk+fixed,
    signature50:5*unit.matcha+40*unit.water+15*unit.condensed+30*unit.evaporated+70*unit.milk+fixed,
    signature0:5*unit.matcha+40*unit.water+110*unit.milk+15*unit.evaporated+fixed,
    coconut:5*unit.matcha+145*unit.water+20*unit.coconut+fixed,
    orange:35*unit.orange+135*unit.water+fixed
  };
  assert.deepEqual(Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,Number(v.toFixed(4))])),{
    pure:13.104,latte:20.6738,signature100:22.785,signature50:21.8175,signature0:21.465,coconut:20.2985,orange:12.4125
  });
});

test('Turso snapshot migration accepts cost rows and preserves historical sales and orders',()=>{
  const snapshot={dataVersion:'old',menu:[],ingredients:{},menuCostRecords:[{menu_id:'pure-matcha'}],archivedRecipes:[{menu_id:'coconut-matcha'}],costEntries:[{id:'cost-old',ingredientId:'matcha'}],sales:[{id:'sale-old'}],orders:[{id:'order-old'}]};
  const out=previewSnapshot(snapshot).document;
  assert.deepEqual(out.sales,snapshot.sales);
  assert.deepEqual(out.orders,snapshot.orders);
  assert.deepEqual(out.menuCostRecords,snapshot.menuCostRecords);
  assert.deepEqual(out.archivedRecipes,snapshot.archivedRecipes);
  assert.deepEqual(out.costEntries,snapshot.costEntries);
});

test('cost center is separated from stock and uses owner-confirmed purchase inputs',()=>{
  const stockSection=html.match(/<section id="v-stock"[\s\S]*?<\/section>/)?.[0]||'';
  assert.doesNotMatch(stockSection,/costPurchasePrice|ต้นทุน\/หน่วย|confirmCostBtn/);
  assert.match(html,/id="menuCostPanel"[\s\S]*?id="costPurchasePrice"[\s\S]*?id="costPackageQty"[\s\S]*?id="costPurchaseDate"[\s\S]*?id="costOwnerConfirm"/);
  assert.match(html,/function confirmedCostEntry\(key\)/);
  assert.doesNotMatch(html,/COST_REFERENCES|makro\.pro|lotuss\.com|shopee\.co\.th/);
});

test('accounting and marketing views expose separate cost, price and profit formulas',()=>{
  assert.match(html,/data-menu-panel="menuListPanel">1 · สูตร/);
  assert.match(html,/data-menu-panel="menuCostPanel">2 · ต้นทุน/);
  assert.match(html,/data-menu-panel="menuPricePanel">3 · ราคาขาย/);
  assert.match(html,/data-menu-panel="menuProfitPanel">4 · กำไร/);
  assert.match(html,/actual\+p\.estimatedVariableCost\+p\.fixedPerCup\+p\.hiddenCostPerCup/);
  assert.match(html,/actual\/\(p\.targetCogsPercent\/100\)/);
  assert.match(html,/full\/\(1-p\.targetNetMarginPercent\/100\)/);
});
