import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');

function countId(id){
  return html.split('id="'+id+'"').length-1;
}

test('critical POS modal and payment ids are unique',()=>{
  const critical=[
    'variantModal','addVariantBtn',
    'confirmOrderModal','payModal','confirmPaymentBtn',
    'cashReceived','promptPaidConfirm',
    'splitPaySection','splitItemList','splitCurrentTotal',
    'systemHealthCard','splitRecoveryCard'
  ];
  for(const id of critical){
    assert.equal(countId(id),1,'duplicate or missing id: '+id);
  }
});

test('recipe admin uses a distinct add-variant id',()=>{
  assert.equal(countId('addRecipeVariantBtn'),1);
  assert.match(html,/body\.querySelector\('#addRecipeVariantBtn'\)/);
});

test('mobile checkout hardening and split recovery stay installed',()=>{
  assert.match(html,/field-v83-mobile-viewport-hardening/);
  assert.match(html,/field-keyboard-open/);
  assert.match(html,/--vv-height/);
  assert.match(html,/async function renderSplitRecovery\(\)/);
  assert.match(html,/FIELD_ONLINE_POS\.splitList/);
});

test('payment UI remains a single sequential checkout flow',()=>{
  assert.equal(countId('confirmOrderModal'),1);
  assert.equal(countId('payModal'),1);
  assert.equal(countId('confirmGoPayBtn'),1);
  assert.equal(countId('confirmPaymentBtn'),1);
  assert.match(html,/ขั้นตอน 1\/2/);
  assert.match(html,/ขั้นตอน 2\/2/);
});
