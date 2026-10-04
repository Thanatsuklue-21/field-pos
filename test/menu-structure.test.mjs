import test from 'node:test';
import assert from 'node:assert/strict';
import {getMenuStructure,validateMenuStructure,applyMenuStructure,categoryState,prepBaseState} from '../lib/domain/menu-structure.mjs';

function doc(){
  return {
    settings:{},
    ingredients:{matcha:{name:'Matcha',unit:'g'},milk:{name:'Milk',unit:'g'}},
    menu:[
      {id:'m1',name:'Pure Matcha',category:'MATCHA',enabled:true,variants:[]},
      {id:'m2',name:'Latte',category:'COFFEE',enabled:true,variants:[]},
    ]
  };
}

test('menu structure derives legacy categories and default prep bases',()=>{
  const d=doc(),s=getMenuStructure(d);
  assert.deepEqual(s.categories.map(x=>x.name),['MATCHA','COFFEE']);
  assert.equal(s.prepBases.find(x=>x.id==='MATCHA').batchMode,'SEQUENTIAL');
  assert.equal(s.prepBases.find(x=>x.id==='COFFEE').batchMode,'SEQUENTIAL');
  assert.equal(s.prepBases.find(x=>x.id==='FRUIT').batchMode,'NONE');
  assert.equal(s.prepBases.find(x=>x.id==='SODA').batchMode,'NONE');
});

test('category rename updates every matching menu and preserves order',()=>{
  const d=doc();
  const normalized=validateMenuStructure({
    categories:[
      {id:'cat_MATCHA',name:'มัทฉะ',previousName:'MATCHA',enabled:true},
      {id:'cat_COFFEE',name:'กาแฟ',previousName:'COFFEE',enabled:true},
    ],
    prepBases:getMenuStructure(d).prepBases
  },d);
  const out=applyMenuStructure(d,normalized);
  assert.equal(d.menu[0].category,'มัทฉะ');
  assert.equal(d.menu[1].category,'กาแฟ');
  assert.deepEqual(out.categories.map(x=>x.name),['มัทฉะ','กาแฟ']);
});

test('category state exposes enabled and admin order',()=>{
  const d=doc();
  applyMenuStructure(d,validateMenuStructure({
    categories:[
      {id:'cat_COFFEE',name:'COFFEE',previousName:'COFFEE',enabled:true},
      {id:'cat_MATCHA',name:'MATCHA',previousName:'MATCHA',enabled:false},
    ],
    prepBases:getMenuStructure(d).prepBases
  },d));
  assert.equal(categoryState(d,'COFFEE').rank,0);
  assert.equal(categoryState(d,'MATCHA').enabled,false);
});

test('prep base validates ingredient references and preserves configured ingredients',()=>{
  const d=doc(),s=getMenuStructure(d);
  const bases=s.prepBases.map(x=>x.id==='MATCHA'?{...x,label:'MATCHA STATION',ingredientIds:['matcha'],batchMode:'COMBINED'}:x);
  applyMenuStructure(d,validateMenuStructure({categories:s.categories,prepBases:bases},d));
  const base=prepBaseState(d,'MATCHA');
  assert.equal(base.label,'MATCHA STATION');
  assert.deepEqual(base.ingredientIds,['matcha']);
  assert.equal(base.batchMode,'COMBINED');
  assert.throws(()=>validateMenuStructure({categories:s.categories,prepBases:[...bases,{id:'CUSTOM',label:'CUSTOM',enabled:true,ingredientIds:['missing'],batchMode:'SEQUENTIAL'}]},d),/prep_base_ingredient_missing/);
  assert.throws(()=>validateMenuStructure({categories:s.categories,prepBases:bases.map(x=>x.id==='MATCHA'?{...x,batchMode:'MIX_ANYTHING'}:x)},d),/invalid_prep_batch_mode/);
});
