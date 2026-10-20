import test from 'node:test';
import assert from 'node:assert/strict';
import {sumMoney} from '../lib/domain/money.mjs';

test('decimal money sums satang and cancels independent of ordering',()=>{
  assert.equal(sumMoney(Array(1000).fill(0.01)),10);
  for(const values of [[0.1,0.2,-0.3],[0.2,-0.3,0.1],[-0.3,0.1,0.2]])assert.equal(sumMoney(values),0);
  assert.equal(sumMoney(['10000000.01','0.02','-10000000']),0.03);
});
test('fractional cost precision is retained until final satang rounding',()=>{
  assert.equal(sumMoney(['0.004','0.004']),0.01);
  assert.equal(sumMoney(['1.005']),1.01);
  assert.equal(sumMoney(['-1.005']),-1.01);
  assert.equal(sumMoney([1e-7,0.0099999]),0.01);
  assert.equal(sumMoney([]),0);
  assert.equal(Object.is(sumMoney([-0.001]),-0),false);
});
test('invalid money and unsafe minor-unit totals fail closed',()=>{
  for(const value of [NaN,Infinity,'bad','',null,undefined,{},'0x10','1e999'])assert.throws(()=>sumMoney([value]),/invalid_money/);
  assert.throws(()=>sumMoney(['90071992547409.92']),/money_overflow/);
});

test('operator money labels preserve satang and existing whole-baht labels',async()=>{
  const money=await import('../lib/domain/money.mjs');
  for(const [value,label] of [[55,'55'],[55.5,'55.50'],[44.5,'44.50'],[0.1,'0.10'],[19.95*3,'59.85'],[-0.001,'0'],[-0.1,'-0.10']]){
    assert.equal(money.formatBaht?.(value),label);
  }
});

test('money labels cannot disguise invalid or overflowing amounts as zero',async()=>{
  const {formatBaht}=await import('../lib/domain/money.mjs');
  for(const value of [NaN,Infinity,'bad',null])assert.throws(()=>formatBaht(value),/invalid_money/);
  assert.throws(()=>formatBaht('90071992547409.92'),/money_overflow/);
});
