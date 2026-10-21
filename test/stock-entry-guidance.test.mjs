import test from 'node:test';
import assert from 'node:assert/strict';
const load=()=>import('../lib/stock-entry-guidance.mjs');
test('stock price preview tolerates intermediate invalid and overflowing input without crashing',async()=>{
 const {purchaseCostLabel}=await load();
 for(const raw of ['-','.','invalid','Infinity','1e99','-1'])assert.equal(purchaseCostLabel(raw),'ตรวจราคาซื้อ',raw);
 assert.equal(purchaseCostLabel(''),'ยังไม่กรอกราคา');
 assert.equal(purchaseCostLabel('  '),'ยังไม่กรอกราคา');
 assert.equal(purchaseCostLabel('120.5'),'฿120.50');
 assert.equal(purchaseCostLabel('0'),'฿0');
});
