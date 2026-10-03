import test from 'node:test';import assert from 'node:assert/strict';
import {findApprovedRecipeDrift,applyApprovedRecipeUpdate} from '../lib/domain/approved-recipes.mjs';

const legacy=()=>[{id:'field-orange',name:'FIELD Orange 16 oz',variants:[{label:'Standard',recipe:{items:{orangeMix:35,water:135,cup16:1,lid:1,ice:1}}}]}];

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
