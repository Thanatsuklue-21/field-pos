import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('POS defers optional CRM loading without delaying payment access',async()=>{
  const pos=await readFile(new URL('../app/pos/page.tsx',import.meta.url),'utf8');
  assert.match(pos,/window\.setTimeout\(\(\)=>loadCustomers\(\),1200\)/);
  assert.match(pos,/if\(\(paymentReviewOpen\|\|payOpen\)&&customers\.length===0\)loadCustomers\(\)\.catch\(\)=>\{\}\)/);
  assert.match(pos,/window\.clearTimeout\(customerTimer\)/);
});
