import test from 'node:test';
import assert from 'node:assert/strict';
const load=()=>import('../lib/stock-entry-guidance.mjs');
test('stock count requires an explicit quantity instead of silently treating a cleared field as zero',async()=>{
 const {countedQuantity}=await load();
 assert.equal(countedQuantity({base:''},0),null);assert.equal(countedQuantity({base:'0'},0),0);
 assert.equal(countedQuantity({packs:'',loose:''},50),null);assert.equal(countedQuantity({packs:'1',loose:''},50),50);
 assert.equal(countedQuantity({packs:'-1',loose:'50'},50),null);
});

test('stock receipt preview explains invalid units and defaults to the actual count unit',async()=>{
 const {previewReceived,defaultPackSizeUnit}=await load();
 assert.equal(defaultPackSizeUnit('set'),'set');assert.equal(defaultPackSizeUnit('เสิร์ฟ'),'serve');
 assert.equal(previewReceived('1','50','set','set').qty,50);
 assert.match(previewReceived('1','50','piece','set').label,/ชุด/);
 assert.equal(previewReceived('1','50','piece','set').qty,0);
 assert.equal(previewReceived('1','50','g','unknown').qty,0);
 assert.equal(previewReceived('1e308','1e308','g','g').qty,0);
});
test('stock price preview tolerates intermediate invalid and overflowing input without crashing',async()=>{
 const {purchaseCostLabel}=await load();
 for(const raw of ['-','.','invalid','Infinity','1e99','-1'])assert.equal(purchaseCostLabel(raw),'ตรวจราคาซื้อ',raw);
 assert.equal(purchaseCostLabel(''),'ยังไม่กรอกราคา');
 assert.equal(purchaseCostLabel('  '),'ยังไม่กรอกราคา');
 assert.equal(purchaseCostLabel('120.5'),'฿120.50');
 assert.equal(purchaseCostLabel('0'),'฿0');
});
