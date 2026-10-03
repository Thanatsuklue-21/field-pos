import test from 'node:test';
import assert from 'node:assert/strict';
import {assessSalesCostQuality,buildMenuCostRows} from '../lib/domain/cost-center.mjs';

const ingredients={
  matcha:{unitCost:2.076,costStatus:'CONFIRMED'},water:{unitCost:.0075,costStatus:'CONFIRMED'},milk:{unitCost:.0525,costStatus:'CONFIRMED'},
  syrup:{unitCost:.04625,costStatus:'CONFIRMED',costKind:'syrup',wasteMargin:.05},condensed:{unitCost:.0645,costStatus:'CONFIRMED'},evaporated:{unitCost:.099,costStatus:'CONFIRMED'},
  coconutSyrup:{unitCost:.2653333333,costStatus:'CONFIRMED',costKind:'syrup',wasteMargin:.05},orangeMix:{unitCost:.225,costStatus:'CONFIRMED',costKind:'concentrate',wasteMargin:.05},
  cup16:{unitCost:1.8,costStatus:'CONFIRMED'},lid:{unitCost:.5,costStatus:'CONFIRMED'},straw:{unitCost:.2,costStatus:'CONFIRMED'},sticker:{unitCost:.5,costStatus:'CONFIRMED'},ice:{unitCost:.525,costStatus:'CONFIRMED'}
};
const fixed={cup16:1,lid:1,straw:1,sticker:1,ice:1};
const recipe=items=>({items:{...items,...fixed}});
const menu=[
  {id:'pure-matcha',name:'Pure Matcha Iced 16 oz',price:45,enabled:true,variants:[{label:'Standard',recipe:recipe({matcha:4,water:170})}]},
  {id:'matcha-latte',name:'Matcha Latte 16 oz',price:55,enabled:true,variants:[{label:'Standard',recipe:recipe({matcha:5,water:40,milk:110,syrup:15})}]},
  {id:'matcha-signature',name:'FIELD Matcha Signature',price:55,enabled:true,variants:[
    {label:'100%',recipe:recipe({matcha:5,water:40,condensed:30,evaporated:30,milk:70})},
    {label:'50%',recipe:recipe({matcha:5,water:40,condensed:15,evaporated:30,milk:70})},
    {label:'0%',recipe:recipe({matcha:5,water:40,evaporated:15,milk:110})}
  ]},
  {id:'coconut-matcha',name:'FIELD Coconut Matcha 16 oz',price:60,enabled:true,variants:[{label:'Standard',recipe:recipe({matcha:5,water:145,coconutSyrup:20})}]},
  {id:'field-orange',name:'FIELD Orange 16 oz',price:45,enabled:true,variants:[{label:'Standard',recipe:recipe({orangeMix:25,water:145})}]}
];

test('every APPROVED recipe has regression-locked COGS, margin and contribution',()=>{
  const rows=buildMenuCostRows({menu,ingredients,estimatedVariableCost:2.5});
  const actual=Object.fromEntries(rows.map(row=>[`${row.menuId}:${row.variant}`,{
    cogs:Number(row.actualCogs.toFixed(6)),grossProfit:Number(row.grossProfit.toFixed(6)),grossMargin:Number(row.grossMargin.toFixed(3)),contribution:Number(row.contributionProfit.toFixed(6)),status:row.costStatus
  }]));
  assert.deepEqual(actual,{
    'pure-matcha:Standard':{cogs:13.104,grossProfit:31.896,grossMargin:70.88,contribution:29.396,status:'CONFIRMED'},
    'matcha-latte:Standard':{cogs:20.708438,grossProfit:34.291562,grossMargin:62.348,contribution:31.791562,status:'CONFIRMED'},
    'matcha-signature:100%':{cogs:22.785,grossProfit:32.215,grossMargin:58.573,contribution:29.715,status:'CONFIRMED'},
    'matcha-signature:50%':{cogs:21.8175,grossProfit:33.1825,grossMargin:60.332,contribution:30.6825,status:'CONFIRMED'},
    'matcha-signature:0%':{cogs:21.465,grossProfit:33.535,grossMargin:60.973,contribution:31.035,status:'CONFIRMED'},
    'coconut-matcha:Standard':{cogs:20.5645,grossProfit:39.4355,grossMargin:65.726,contribution:36.9355,status:'CONFIRMED'},
    'field-orange:Standard':{cogs:10.51875,grossProfit:34.48125,grossMargin:76.625,contribution:31.98125,status:'CONFIRMED'}
  });
});

test('historical sales without cost provenance are never presented as final profit',()=>{
  assert.equal(assessSalesCostQuality([{id:'old',status:'paid',costTotal:10}]).status,'LEGACY_UNVERIFIED');
  assert.equal(assessSalesCostQuality([{id:'new',status:'paid',costStatus:'CONFIRMED'}]).isEstimated,false);
  assert.equal(assessSalesCostQuality([{id:'pending',status:'paid',costStatus:'PROVISIONAL'}]).status,'PROVISIONAL');
});
