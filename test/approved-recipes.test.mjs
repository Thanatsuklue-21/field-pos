import test from 'node:test';import assert from 'node:assert/strict';
import {findApprovedRecipeDrift,applyApprovedRecipeUpdate} from '../lib/domain/approved-recipes.mjs';

const legacy=()=>[{id:'field-orange',name:'FIELD Orange 16 oz',variants:[{label:'Standard',recipe:{items:{orangeMix:35,water:135,cup16:1,lid:1,ice:1}}}]}];
const pureLegacy=()=>[{id:'pure-matcha',name:'Pure Matcha Iced 16 oz',variants:[{label:'Standard',recipe:{items:{matcha:4,water:170,cup16:1,lid:1,ice:1}}}]}];

test('legacy Orange 35/135 is detected as approved recipe drift',()=>{
  const drift=findApprovedRecipeDrift(legacy());
  assert.equal(drift.length,1);
  assert.equal(drift[0].updateId,'field-orange-2026-10-03-25-145');
  assert.deepEqual(drift[0].to,{orangeMix:25,water:145});
});

test('approved reconciliation patches only Orange concentrate and water while preserving packaging',()=>{
  const menu=legacy();
  const out=applyApprovedRecipeUpdate(menu,'field-orange-2026-10-03-25-145');
  assert.deepEqual(out.items,{orangeMix:25,water:145,cup16:1,lid:1,ice:1});
  assert.equal(findApprovedRecipeDrift(menu).length,0);
});

test('approved reconciliation refuses to overwrite a non-legacy owner-edited recipe',()=>{
  const menu=legacy();menu[0].variants[0].recipe.items.orangeMix=28;
  assert.equal(findApprovedRecipeDrift(menu).length,0);
  assert.throws(()=>applyApprovedRecipeUpdate(menu,'field-orange-2026-10-03-25-145'),/approved_recipe_not_legacy_match/);
});


test('legacy Pure Matcha 4/170 is detected against the 5 g + 180 g approved master',()=>{
  const drift=findApprovedRecipeDrift(pureLegacy());
  assert.equal(drift.length,1);
  assert.equal(drift[0].updateId,'pure-matcha-2026-10-12-5-180');
  assert.deepEqual(drift[0].to,{matcha:5,water:180});
});

test('approved Pure Matcha reconciliation changes only matcha and water while preserving packaging',()=>{
  const menu=pureLegacy();
  const out=applyApprovedRecipeUpdate(menu,'pure-matcha-2026-10-12-5-180');
  assert.deepEqual(out.items,{matcha:5,water:180,cup16:1,lid:1,ice:1});
  assert.equal(findApprovedRecipeDrift(menu).length,0);
});

test('approved Pure Matcha reconciliation refuses to overwrite an owner-edited formula',()=>{
  const menu=pureLegacy();menu[0].variants[0].recipe.items.matcha=4.5;
  assert.equal(findApprovedRecipeDrift(menu).length,0);
  assert.throws(()=>applyApprovedRecipeUpdate(menu,'pure-matcha-2026-10-12-5-180'),/approved_recipe_not_legacy_match/);
});
