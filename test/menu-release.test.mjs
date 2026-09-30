import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {previewSnapshot} from '../lib/migration.mjs';

const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');

test('approved menu release keeps FIELD approved recipes active',()=>{
  assert.match(html,/FIELD_DATA_VERSION='2026-09-30\.74'/);
  assert.match(html,/id:'pure-matcha'.*enabled:true.*iced\(\{matcha:4,water:170\}\)/);
  assert.match(html,/id:'matcha-latte'.*enabled:true.*iced\(\{matcha:5,water:40,milk:110,syrup:15\}\)/);
  assert.match(html,/id:'matcha-signature'.*name:'FIELD Matcha Signature'.*v\('100%'.*condensed:30,evaporated:30,milk:70.*v\('50%'.*condensed:15,evaporated:30,milk:70.*v\('0%'.*milk:110,evaporated:15/);
  assert.match(html,/id:'coconut-matcha'.*price:60,enabled:true.*coconutSyrup:20/);
  assert.match(html,/id:'field-orange'.*price:45,enabled:true.*orangeMix:25,water:145/);
  assert.match(html,/id:'strawberry-matcha'.*enabled:false/);
  assert.match(html,/id:'honey-matcha'.*price:0,enabled:false/);
  const activeCoconut=html.match(/\{id:'coconut-matcha'.*?\},\n/)?.[0]||'';
  assert.doesNotMatch(activeCoconut,/Nature Taste/);
});

test('current authoritative unit costs and ice policy are locked',()=>{
  for(const fragment of [
    "matcha:{name:'ผงมัทฉะยามิโตะ',unit:'g',qty:1000,low:150,unitCost:2.076}",
    "water:{name:'น้ำดื่ม Crystal',unit:'g',qty:20000,low:3000,unitCost:0.0075}",
    "milk:{name:'นมสดพาสเจอร์ไรซ์ Meiji',unit:'g',qty:6000,low:1000,unitCost:0.0525}",
    "syrup:{name:'ไซรัปมิตรผล',unit:'g',qty:1500,low:250,unitCost:0.04625}",
    "condensed:{name:'นมข้นหวาน Carnation',unit:'g',qty:1500,low:250,unitCost:0.0645}",
    "evaporated:{name:'นมข้นจืด Carnation Extra',unit:'g',qty:1500,low:250,unitCost:0.099}",
    "coconutSyrup:{name:'SENORITA Nam-Hom Coconut Syrup',unit:'g',qty:750,low:120,unitCost:0.2653333333}",
    "orangeMix:{name:'Sunquick Orange Mix Concentrate',unit:'g',qty:1000,low:180,unitCost:0.225}",
    "ice:{name:'น้ำแข็งหลอดเล็ก 210g/แก้ว (50บ./20kg)',unit:'serve',qty:100,low:20,unitCost:0.525}"
  ]) assert.ok(html.includes(fragment),`missing ${fragment}`);
  assert.match(html,/Direct COGS = วัตถุดิบตามสูตรจริง \+ บรรจุภัณฑ์ \+ น้ำแข็ง/);
});

test('approved Orange actual COGS math uses 25g concentrate and 145g water',()=>{
  const unit={orange:.225,water:.0075};
  const fixed=1.8+.5+.2+.5+.525;
  const orange=25*unit.orange+145*unit.water+fixed;
  assert.equal(Number(orange.toFixed(4)),10.2375);
});

test('Turso snapshot migration preserves historical sales, orders and cost rows',()=>{
  const snapshot={
    dataVersion:'old',
    menu:[],
    ingredients:{},
    menuCostRecords:[{menu_id:'pure-matcha'}],
    archivedRecipes:[{menu_id:'coconut-matcha'}],
    costEntries:[{id:'cost-old',ingredientId:'matcha'}],
    sales:[{id:'sale-old'}],
    orders:[{id:'order-old'}]
  };
  const out=previewSnapshot(snapshot).document;
  assert.deepEqual(out.sales,snapshot.sales);
  assert.deepEqual(out.orders,snapshot.orders);
  assert.deepEqual(out.menuCostRecords,snapshot.menuCostRecords);
  assert.deepEqual(out.archivedRecipes,snapshot.archivedRecipes);
  assert.deepEqual(out.costEntries,snapshot.costEntries);
});

test('current menu cost UI is separated from stock and exposes Direct COGS detail',()=>{
  assert.match(html,/data-menu-panel="menuListPanel">รายการเมนู/);
  assert.match(html,/data-menu-panel="menuCostPanel">ต้นทุนเมนู/);
  assert.match(html,/id="menuCostPanel"[\s\S]*?id="costDashboard"[\s\S]*?id="menuCostBody"[\s\S]*?id="menuCostDetail"/);
  assert.match(html,/Direct COGS/);
  assert.match(html,/Contribution/);
  assert.match(html,/Sales Mix 30 วัน/);
  assert.match(html,/function renderMenuCostDetail\(\)/);
});

test('recipe-weighted liquid ingredients use grams in current master data',()=>{
  for(const key of ['water','milk','syrup','evaporated','coconutSyrup','orangeMix']){
    assert.match(html,new RegExp(`${key}:\\{name:.*?unit:'g'`));
  }
  assert.match(html,/รับของเข้าแล้วคำนวณต้นทุนต่อ g \/ ml \/ ชิ้นอัตโนมัติ/);
});
