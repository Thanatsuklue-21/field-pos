import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizePurchaseUrl} from '../lib/stock-service.mjs';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('purchase source URLs accept bare domains and normalize to https',()=>{
  assert.equal(normalizePurchaseUrl('shopee.co.th/product/123'),'https://shopee.co.th/product/123');
  assert.equal(normalizePurchaseUrl('https://www.makro.pro/item'),'https://www.makro.pro/item');
  assert.throws(()=>normalizePurchaseUrl('javascript:alert(1)'),/invalid_purchase_url/);
});

test('stock admin supports self-service master create edit archive restore reset and purchase edit',async()=>{
  const api=await read('lib/api.mjs'),ui=await read('app/stock/page.tsx');
  assert.match(api,/path==='\/api\/stock\/ingredients'&&method==='POST'/);
  assert.match(api,/stockIngredientActionMatch/);
  assert.match(api,/before_ingredient_test_reset/);
  assert.match(api,/purchaseEditMatch/);
  assert.match(api,/UPDATE field_stock_transactions SET qty_delta=/);
  assert.match(api,/purchase_correction_stock_negative/);
  assert.match(api,/stock_purchase_update/);
  assert.match(ui,/เพิ่ม Stock/);
  assert.match(ui,/ล้างยอด\/ราคาทดลอง/);
  assert.match(ui,/แก้ข้อมูลซื้อล่าสุด/);
  assert.match(ui,/ข้อมูลซื้อที่นำกลับมาใช้ซ้ำได้/);
});

test('stock reset preserves purchase history behind a reset boundary instead of destructive deletion',async()=>{
  const api=await read('lib/api.mjs');
  assert.match(api,/before_ingredient_test_reset/);
  assert.match(api,/historyResetAt=now/);
  assert.match(api,/Number\(p\.created_at\)<resetAt/);
  assert.doesNotMatch(api,/DELETE FROM field_purchase_records WHERE ingredient_id/);
});

test('daily count separates package counting from recipe usage units',async()=>{
  const ui=await read('app/stock/page.tsx');
  assert.match(ui,/นับเป็นกล่อง\/แพ็กก่อน ระบบค่อยแปลงเป็นหน่วยใช้ในสูตร/);
  assert.match(ui,/quantityPerPackage/);
  assert.match(ui,/เศษ\/เปิดแล้ว/);
  assert.match(ui,/countedQty:per>0\?Number\(row\.packs/);
});

test('purchase form leads with price and can reuse recent supplier source and package evidence',async()=>{
  const ui=await read('app/stock/page.tsx');
  const price=ui.indexOf('1. ราคาซื้อรวม'),qty=ui.indexOf('2. จำนวนที่ซื้อ');
  assert.ok(price>0&&qty>price);
  assert.match(ui,/ข้อมูลเดิม/);
  assert.match(ui,/recentPurchases/);
  assert.match(ui,/setFromPurchase/);
  assert.match(ui,/ลิงก์สินค้า\/แหล่งซื้อ/);
  assert.match(ui,/ถ้าแก้จำนวนแพ็ก\/ขนาด ระบบจะคำนวณส่วนต่าง/);
});

test('recipe admin uses stock dropdown lines with quantity and live cost preview',async()=>{
  const ui=await read('app/recipes/page.tsx'),api=await read('lib/api.mjs');
  assert.match(ui,/เลือกวัตถุดิบ\/บรรจุภัณฑ์/);
  assert.match(ui,/ต้นทุนวัตถุดิบประมาณ/);
  assert.match(ui,/เพิ่มรายการ/);
  assert.match(ui,/PUBLISH NEW VERSION/);
  assert.match(api,/standardUnitCost/);
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

test('trial sales reset preserves stock and is protected by confirmation payment gate and snapshot',async()=>{
  const api=await read('lib/api.mjs'),settings=await read('app/settings/page.tsx');
  const start=api.indexOf("if(path==='/api/admin/test-data/sales-reset'&&method==='POST')");
  const end=api.indexOf("if(path==='/api/admin/backup/export'",start);
  assert.ok(start>0&&end>start);
  const seg=api.slice(start,end);
  assert.match(seg,/RESET TEST SALES/);
  assert.match(seg,/active_payment_sessions_exist/);
  assert.match(seg,/active_orders_confirmation_required/);
  assert.match(seg,/before_test_sales_reset/);
  assert.match(seg,/doc\.sales=\[\];doc\.orders=\[\]/);
  assert.match(seg,/customerEffectsReversed===true/);
  assert.doesNotMatch(seg,/ingredient\.qty\s*=/);
  assert.match(seg,/stockChanged:false/);
  assert.match(settings,/ล้างประวัติการขายทดลอง/);
  assert.match(settings,/Stock คงเหลือปัจจุบันไม่ถูกเปลี่ยน/);
});


test('stock master permanent delete is guarded and can detach current recipes with version history',async()=>{
  const api=await read('lib/api.mjs'),ui=await read('app/stock/page.tsx');
  assert.match(api,/stockIngredientPurgeMatch/);
  assert.match(api,/DELETE INGREDIENT/);
  assert.match(api,/ingredient_purge_requires_zero_stock/);
  assert.match(api,/ingredient_purge_active_purchase/);
  assert.match(api,/ingredient_purge_would_empty_recipe/);
  assert.match(api,/changeReason:'ingredient_purge'/);
  assert.match(api,/before_ingredient_purge/);
  assert.match(api,/stock_ingredient_purge/);
  assert.match(api,/delete doc\.ingredients\[id\]/);
  assert.match(ui,/ลบถาวร \(ข้อมูลทดลอง\)/);
  assert.match(ui,/เอาวัตถุดิบนี้ออกจากสูตรทั้งหมดแล้วลบ Stock Master/);
  assert.match(ui,/ยกเลิกรับเข้า/);
});

test('all stock overlays stay above mobile bottom navigation',async()=>{
  const ui=await read('app/stock/page.tsx');
  assert.doesNotMatch(ui,/fixed inset-0 z-50/);
  assert.ok((ui.match(/fixed inset-0 z-\[80\]/g)||[]).length>=4);
});


test('stock master refreshes latest database values and separates package unit from recipe unit',async()=>{
  const ui=await read('app/stock/page.tsx');
  assert.match(ui,/async function openMaster/);
  assert.match(ui,/api<Overview>\("\/api\/stock\/overview"\)/);
  assert.match(ui,/originalUnit:fresh\.unit/);
  assert.match(ui,/หน่วยซื้อ\/นับล่าสุด/);
  assert.match(ui,/หน่วยที่สูตร\/Stock ใช้/);
  assert.match(ui,/เป็นหน่วยซื้อ\/หน่วยนับ ไม่ใช่หน่วยตัดสูตร/);
});

test('renaming stock master does not send unchanged unit and shows unit errors inside modal',async()=>{
  const ui=await read('app/stock/page.tsx');
  assert.match(ui,/if\(!master\.id\|\|master\.unit!==master\.originalUnit\)payload\.unit=/);
  assert.match(ui,/setMasterMsg\(map\[e\.message\]\|\|e\.message\)/);
  assert.match(ui,/แต่การเปลี่ยนชื่อทำได้โดยไม่ต้องเปลี่ยนหน่วย/);
});


test('full trial reset clears sales stock balances and operational stock costing while preserving master data',async()=>{
  const api=await read('lib/api.mjs'),settings=await read('app/settings/page.tsx');
  const start=api.indexOf("if(path==='/api/admin/test-data/full-reset'&&method==='POST')");
  const end=api.indexOf("if(path==='/api/admin/backup/export'",start);
  assert.ok(start>0&&end>start);
  const seg=api.slice(start,end);
  assert.match(seg,/RESET ALL TEST DATA/);
  assert.match(seg,/before_full_test_reset/);
  assert.match(seg,/ingredient\.qty=0/);
  assert.match(seg,/ingredient\.unitCost=0/);
  assert.match(seg,/ingredient\.costStatus='MISSING'/);
  assert.match(seg,/ingredient\.purchaseProfile=null/);
  assert.match(seg,/doc\.sales=\[\];doc\.orders=\[\]/);
  assert.match(seg,/doc\.cashShifts=\[\]/);
  assert.match(seg,/doc\.cycleCounts=\[\]/);
  assert.match(seg,/doc\.testStockResetAt=resetAt/);
  assert.match(seg,/sourceType\|\|''\)\.startsWith\('STOCK_'\)/);
  assert.doesNotMatch(seg,/doc\.menu=\[\]/);
  assert.match(settings,/FULL TEST RESET/);
  assert.match(settings,/ล้างยอดขาย \+ Stock \+ ต้นทุนทดลองทั้งหมด/);
  assert.match(settings,/RESET ALL TEST DATA/);
});

test('stock and cost views respect the full trial reset boundary',async()=>{
  const api=await read('lib/api.mjs');
  assert.match(api,/field_stock_transactions WHERE created_at>=\?/);
  assert.match(api,/field_purchase_records WHERE created_at>=\? ORDER BY purchased_at/);
  assert.match(api,/field_purchase_records WHERE ingredient_id=\? AND created_at>=\?/);
  assert.match(api,/testStockResetAt/);
});

test('full trial reset preview exposes purchase spend inventory value and active purchase counts',async()=>{
  const api=await read('lib/api.mjs');
  assert.match(api,/purchaseRecords:Number\(purchaseCount\?\.n\|\|0\)/);
  assert.match(api,/stockItemsWithBalance/);
  assert.match(api,/inventoryValue/);
  assert.match(api,/purchaseSpend/);
});
