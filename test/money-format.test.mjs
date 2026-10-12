import test from 'node:test';
import assert from 'node:assert/strict';
import {formatMoney} from '../lib/money-format.mjs';

test('money display groups thousands and preserves satang without changing numeric input',()=>{
  for(const [input,expected]of [[2000,'2,000'],[25000.5,'25,000.50'],[2000000.25,'2,000,000.25'],[-2000.5,'-2,000.50'],[0,'0'],[-0,'0'],[-0.001,'0'],[55.25,'55.25']])assert.equal(formatMoney(input),expected);
});
test('invalid or unavailable money does not display a false zero',()=>{
  for(const input of [null,undefined,'',NaN,Infinity,'not-money'])assert.equal(formatMoney(input),'—');
});
