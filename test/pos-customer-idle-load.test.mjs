import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('POS defers optional CRM loading without delaying payment access',async()=>{
  const pos=await readFile(new URL('../app/pos/page.tsx',import.meta.url),'utf8');
  assert.match(pos,/requestIdleCallback\(\(\)=>\{void loadCustomers\(\)\},\{timeout:5000\}\)/);
  assert.match(pos,/window\.setTimeout\(\(\)=>\{void loadCustomers\(\)\},3000\)/);
  assert.ok(pos.includes('if((paymentReviewOpen||payOpen)&&customers.length===0)loadCustomers().catch(()=>{})'));
  assert.match(pos,/cancelIdleCallback\?\.\(customerIdle\)/);
  assert.match(pos,/window\.clearTimeout\(customerTimer\)/);
  assert.match(pos,/if\(\(paymentReviewOpen\|\|payOpen\)&&promptConfig===null\)/);
});



test('POS defers offline maintenance on first mount while recovery remains immediate',async()=>{
  const pos=await readFile(new URL('../app/pos/page.tsx',import.meta.url),'utf8');
  assert.match(pos,/scheduleInitialMaintenance/);
  assert.match(pos,/requestIdleCallback\(runMaintenance,\{timeout:5000\}\)/);
  assert.match(pos,/window\.setTimeout\(runMaintenance,3000\)/);
  assert.match(pos,/if\(next\)recoverCashCheckout\(\)\.then\(\(\)=>recoverPending\(\)\)/);
  const initial=pos.slice(pos.indexOf('const scheduleInitialMaintenance'),pos.indexOf('const resume=',pos.indexOf('const scheduleInitialMaintenance')));
  assert.match(initial,/if\(initial\)/);
  assert.match(initial,/scheduleInitialMaintenance\(\)/);
});
