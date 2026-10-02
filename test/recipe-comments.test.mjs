import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('recipe comments are version-linked and preserve edit history',async()=>{
  const api=await read('lib/api.mjs');
  assert.match(api,/path==='\/api\/admin\/recipes\/comments'&&method==='POST'/);
  assert.match(api,/recipeVersion:Number\(variant\.recipeVersion\)\|\|null/);
  assert.match(api,/authorType/);
  assert.match(api,/comment\.history\.push/);
  assert.match(api,/recipe_comment_update/);
});

test('recipe UI captures customer owner and custom comments',async()=>{
  const ui=await read('app/recipes/page.tsx');
  assert.match(ui,/CUSTOMER/);
  assert.match(ui,/OWNER/);
  assert.match(ui,/CUSTOM/);
  assert.match(ui,/\/api\/admin\/recipes\/comments/);
  assert.match(ui,/COMMENT HISTORY/);
  assert.match(ui,/recipeVersion/);
});
