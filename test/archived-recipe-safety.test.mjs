import test from 'node:test';
import assert from 'node:assert/strict';
import {variantAvailability,buildPosAvailability} from '../lib/domain/availability.mjs';

test('archived ingredient is unavailable even when old stock quantity remains',()=>{
  const ingredients={matcha:{name:'Matcha',qty:500,archived:true}};
  const result=variantAvailability({recipe:{items:{matcha:5}},ingredients});
  assert.equal(result.available,false);
  assert.equal(result.maxServings,0);
  assert.equal(result.missingIngredients[0].archived,true);
});

test('POS stock projection zeroes archived ingredient so cart precheck cannot consume it',()=>{
  const result=buildPosAvailability({
    menu:[{id:'m1',variants:[{label:'Standard',recipe:{items:{matcha:5}}}]}],
    ingredients:{matcha:{name:'Matcha',qty:500,archived:true}}
  });
  assert.equal(result.stock.matcha.qty,0);
  assert.equal(result.stock.matcha.archived,true);
  assert.equal(result.menu[0].available,false);
});

test('checkout source fails closed when an active recipe references archived ingredient',async()=>{
  const source=await import('node:fs/promises').then(fs=>fs.readFile(new URL('../lib/pos-api.mjs',import.meta.url),'utf8'));
  assert.ok(source.includes("recipe_ingredient_unavailable:"));
  assert.ok(source.includes("doc.ingredients[ingredientId].archived"));
});

test('system readiness includes invalid active recipe ingredient gate',async()=>{
  const source=await import('node:fs/promises').then(fs=>fs.readFile(new URL('../lib/api.mjs',import.meta.url),'utf8'));
  assert.ok(source.includes("invalidActiveRecipes"));
  assert.ok(source.includes("invalid_active_recipe_ingredient"));
  assert.ok(source.includes("invalidRecipeIngredients:invalidActiveRecipes.length"));
  assert.ok(source.includes("invalidActiveRecipes.length===0"));
});
