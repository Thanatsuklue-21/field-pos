import test from 'node:test';
import assert from 'node:assert/strict';
import {stockGroupOf,needsRestock,STOCK_GROUPS} from '../lib/stock-groups.mjs';

// Owner request 2026-11-17: display-only stock grouping; never affects stock math.
test('stock items group by id/name into the owner-facing categories',()=>{
  const cases=[['ICE','น้ำแข็งหลอดเล็ก','base'],['GREENTEA','น้ำชาเขียวรินชาซงเข้มข้น','tea'],['COFFEEBEANS','เมล็ดกาแฟช่อลดา Extra Espresso','tea'],['COCOA','ผงโกโก้ช่อลดา 100%','tea'],
    ['MEIJI','นม Meiji','dairy'],['REDSYRUP','น้ำแดง/ไซรัปแดง','sweet'],['HONEY','น้ำผึ้ง','sweet'],['SODA','โซดา','base'],['LIME','น้ำมะนาว','base'],['WATER','น้ำดื่ม','base'],
    ['CUP8','แก้วร้อน 8 oz','pack'],['icecup','แก้วเย็น 16 oz','pack'],['STRAW','หลอด','pack'],['x1','ป้ายราคา','other']];
  for(const [id,name,want] of cases)assert.equal(stockGroupOf({id,name}),want,id+' '+name);
  assert.deepEqual(STOCK_GROUPS.map(g=>g.key),['tea','dairy','sweet','base','pack','other']);
});

test('restock flag covers empty and low items but never archived ones',()=>{
  assert.equal(needsRestock({qty:0}),true);assert.equal(needsRestock({qty:5,lowStock:true}),true);
  assert.equal(needsRestock({qty:5}),false);assert.equal(needsRestock({qty:0,archived:true}),false);
});
