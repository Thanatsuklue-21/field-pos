import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('product admin uses category and prep base masters instead of free-text only',async()=>{
  const ui=await read('app/products/page.tsx');
  assert.match(ui,/หมวด \/ Prep Base/);
  assert.match(ui,/Category Master/);
  assert.match(ui,/Prep Base Master/);
  assert.match(ui,/ฐานการเตรียมใน Queue/);
  assert.match(ui,/categories\.map/);
  assert.match(ui,/prepBases\.map/);
  assert.match(ui,/\/api\/admin\/menu-structure/);
});

test('pos bootstrap obeys category enabled state and admin category order',async()=>{
  const api=await read('lib/api.mjs');
  assert.match(api,/categoryState\(doc,m\.category\)\.enabled/);
  assert.match(api,/categoryState\(doc,a\.category\)\.rank-categoryState\(doc,b\.category\)\.rank/);
  assert.match(api,/categories:structure\.categories\.filter\(x=>x\.enabled\)/);
});

test('queue prefers configured prep base and selected base ingredients',async()=>{
  const api=await read('lib/pos-api.mjs');
  assert.match(api,/prepBaseState\(doc,menu\.prepBaseId\)/);
  assert.match(api,/if\(!configured\.enabled\)return \{id:'OTHER'/);
  assert.match(api,/configuredIds\.length&&!configuredIds\.includes\(ingredientId\)/);
  assert.match(api,/ingredientIds:configured\.ingredientIds/);
});
