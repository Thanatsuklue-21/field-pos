import test from 'node:test';
import assert from 'node:assert/strict';
import {formatMoney} from '../lib/money-format.mjs';
import {floorMoneyRatio,multiplyMoney,sumMoney} from '../lib/domain/money.mjs';
test('money display preserves satang and grouping while whole-baht controls retain labels',()=>{
  assert.equal(formatMoney(55),'55');assert.equal(formatMoney(0.1),'0.10');assert.equal(formatMoney(25000.5),'25,000.50');
  assert.equal(formatMoney(1.005),'1.01');assert.equal(formatMoney(-0.001),'0');assert.equal(formatMoney(NaN),'—');
});
test('same decimal operations drive quantities, GP, change and exact loyalty thresholds',()=>{
  assert.equal(multiplyMoney(0.1,3),0.3);assert.equal(sumMoney([0.3,-0.1]),0.2);
  assert.equal(floorMoneyRatio(0.3,0.1),3);assert.equal(floorMoneyRatio(0.29,0.1),2);
  assert.throws(()=>floorMoneyRatio(1,0),/invalid_money_ratio/);
});
