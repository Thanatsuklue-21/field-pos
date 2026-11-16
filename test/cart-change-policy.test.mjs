import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildPosAvailability} from '../lib/domain/availability.mjs';
import {LOCAL_CART_PROJECTION_MAX_AGE_MS,planCartChange} from '../lib/domain/cart-change-policy.mjs';

const recipe={items:{matcha:5,milk:100,cup:1}};
const {menu,stock}=buildPosAvailability({menu:[{id:'latte',variants:[{label:'A',recipe}]}],ingredients:{matcha:{name:'มัทฉะ',qty:20},milk:{name:'นมสด',qty:250},cup:{name:'แก้ว',qty:10}}});
const now=1_000_000;

test('fresh projection with enough stock applies the tap instantly',()=>{
  assert.deepEqual(planCartChange({next:[{id:'latte',variant:'A',qty:2}],menu,stock,projectionAt:now-5_000,now}),{mode:'apply-local'});
});

test('local shortage is re-checked against the server instead of being added',()=>{
  assert.deepEqual(planCartChange({next:[{id:'latte',variant:'A',qty:3}],menu,stock,projectionAt:now-5_000,now}),{mode:'verify-server',reason:'local_shortage'});
});

test('stale, future or missing projection timestamps force a server read',()=>{
  const next=[{id:'latte',variant:'A',qty:1}];
  assert.equal(planCartChange({next,menu,stock,projectionAt:now-LOCAL_CART_PROJECTION_MAX_AGE_MS-1,now}).reason,'stale_projection');
  assert.equal(planCartChange({next,menu,stock,projectionAt:now+10,now}).reason,'stale_projection');
  assert.equal(planCartChange({next,menu,stock,projectionAt:undefined,now}).reason,'stale_projection');
});

test('no catalog loaded yet always waits for the server',()=>{
  assert.equal(planCartChange({next:[],menu:[],stock,projectionAt:now,now}).reason,'no_projection');
  assert.equal(planCartChange({next:[],menu,stock:null,projectionAt:now,now}).reason,'no_projection');
});

test('quantity decrease applies locally even when the cart is already short',()=>{
  assert.deepEqual(planCartChange({next:[{id:'latte',variant:'A',qty:5}],menu,stock,allowShortage:true,projectionAt:now,now}),{mode:'apply-local'});
});

test('unknown or disabled variant is never applied from the local projection',()=>{
  assert.equal(planCartChange({next:[{id:'ghost',variant:'A',qty:1}],menu,stock,projectionAt:now,now}).mode,'verify-server');
});

test('POS cart taps use the local policy and keep checkout as the stock authority',async()=>{
  const source=await readFile(new URL('../app/pos/page.tsx',import.meta.url),'utf8');
  assert.match(source,/planCartChange\(/);
  assert.match(source,/projectionAtRef/);
  // The authoritative bootstrap re-read remains for blocked/stale taps.
  assert.match(source,/await api<Bootstrap>\("\/api\/pos\/bootstrap"\)/);
  // Payment opening still blocks on the local cart availability check.
  assert.match(source,/if\(!current\.available\)\{setNotice\(availabilityMessage\(current\)\)/);
});

test('instant cart taps roll back when the background stock read says sold out',async()=>{
  const source=await readFile(new URL('../app/pos/page.tsx',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('function revalidateCartInBackground'),source.indexOf('function addVariant('));
  assert.match(fn,/useCartStore\.getState\(\)\.items===guard\.after\)cart\.replaceItems\(guard\.before\)/);
  assert.match(fn,/setNotice\(availabilityMessage\(checked\)\)/);
  // Quantity decreases are never rolled back.
  assert.match(source,/revalidateCartInBackground\(allowShortage\?null:/);
});
