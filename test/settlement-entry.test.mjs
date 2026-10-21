import test from 'node:test';
import assert from 'node:assert/strict';
test('settlement entry rejects blanks and fractional satang but permits explicit zero',async()=>{
 const {settlementEntryAmount}=await import('../lib/settlement-entry.mjs');
 for(const value of ['', ' ', '70.001','Infinity','1e99','-1'])assert.equal(settlementEntryAmount(value),null,value);
 for(const [value,amount] of [['0',0],['70.50',70.5],['.25',.25]])assert.equal(settlementEntryAmount(value),amount);
});
