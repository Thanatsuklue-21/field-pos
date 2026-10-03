import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('stock admin supports self-service master create edit archive restore reset and purchase edit',async()=>{
  const api=await read('lib/api.mjs'),ui=await read('app/stock/page.tsx');
  assert.match(api,/path==='\/api\/stock\/ingredients'&&method==='POST'/);
  assert.match(api,/stockIngredientActionMatch/);
  assert.match(api,/stock_ingredient_reset/);
  assert.match(api,/purchaseEditMatch/);
  assert.match(api,/stock_purchase_update/);
  assert.match(ui,/เพิ่ม Stock/);
  assert.match(ui,/ล้างยอด\/ราคาทดลอง/);
  assert.match(ui,/ข้อมูลซื้อที่นำกลับมาใช้ซ้ำได้/);
  assert.match(ui,/นับเป็นกล่อง\/แพ็กได้/);
  assert.match(ui,/ข้อมูลเดิม/);
});

test('stock reset preserves history behind a reset boundary instead of destructive deletion',async()=>{
  const api=await read('lib/api.mjs');
  assert.match(api,/before_ingredient_test_reset/);
  assert.match(api,/historyResetAt=now/);
  assert.match(api,/createdAt>=Number\(ingredients\[x\.ingredientId\]\?\.historyResetAt\|\|0\)/);
  assert.doesNotMatch(api,/DELETE FROM field_purchase_records WHERE ingredient_id/);
});

test('recipe admin uses stock dropdown lines with cost preview',async()=>{
  const ui=await read('app/recipes/page.tsx'),api=await read('lib/api.mjs');
  assert.match(ui,/เลือกวัตถุดิบ\/บรรจุภัณฑ์/);
  assert.match(ui,/standardUnitCost/);
  assert.match(ui,/PUBLISH NEW VERSION/);
  assert.match(api,/standardUnitCost:raw\*\(1\+policy\.wasteMargin\)/);
});

test('product admin supports safe permanent deletion only for unsold test products',async()=>{
  const api=await read('lib/api.mjs'),ui=await read('app/products/page.tsx');
  assert.match(api,/productPurgeMatch/);
  assert.match(api,/product_has_sales_archive_instead/);
  assert.match(api,/product_has_cost_history_archive_instead/);
  assert.match(ui,/ลบถาวร \(ทดลอง\)/);
});

test('settings exposes mobile admin center shortcuts',async()=>{
  const ui=await read('app/settings/page.tsx');
  for(const path of ['/products','/recipes','/stock','/costs','/backup','/audit'])assert.match(ui,new RegExp(path.replace('/','\\/')));
  assert.match(ui,/ADMIN CENTER/);
});
