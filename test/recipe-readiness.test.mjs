import test from 'node:test';
import assert from 'node:assert/strict';
import {recipeReleaseReadiness} from '../lib/domain/recipe-readiness.mjs';

test('recipe release readiness joins stock and cost quality in one result',()=>{
  const result=recipeReleaseReadiness({
    recipe:{items:{matcha:5,milk:110}},
    ingredients:{
      matcha:{qty:20,unitCost:2,costStatus:'CONFIRMED'},
      milk:{qty:1000,unitCost:.05,costStatus:'PROVISIONAL'}
    }
  });
  assert.equal(result.recipeValid,true);
  assert.equal(result.sellableNow,true);
  assert.equal(result.maxServings,4);
  assert.equal(result.costStatus,'PROVISIONAL');
  assert.deepEqual(result.pendingCost,['milk']);
});

test('archived or missing ingredients fail recipe release even if numeric stock exists',()=>{
  const archived=recipeReleaseReadiness({recipe:{items:{matcha:5}},ingredients:{matcha:{qty:100,unitCost:2,archived:true}}});
  assert.equal(archived.recipeValid,false);
  assert.equal(archived.sellableNow,false);
  assert.deepEqual(archived.archivedIngredients,['matcha']);
  const missing=recipeReleaseReadiness({recipe:{items:{milk:110}},ingredients:{}});
  assert.equal(missing.recipeValid,false);
  assert.deepEqual(missing.missingIngredients,['milk']);
});

test('missing purchase cost is visible without changing stock availability semantics',()=>{
  const result=recipeReleaseReadiness({recipe:{items:{water:145}},ingredients:{water:{qty:1000,unitCost:0,costStatus:'MISSING'}}});
  assert.equal(result.sellableNow,true);
  assert.equal(result.costStatus,'MISSING');
  assert.deepEqual(result.missingCost,['water']);
});
