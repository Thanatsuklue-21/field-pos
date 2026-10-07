import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {deliverySettlement,deliverySummary,normalizeDeliveryGp} from '../lib/domain/delivery.mjs';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('delivery settlement uses configured GP and preserves gross sale value',()=>{
  const settings={deliveryGp:{grab:.30,lineman:.25,other_delivery:.12}};
  assert.deepEqual(deliverySettlement({salesChannel:'grab',total:100,settings}),{
    salesChannel:'grab',delivery:true,platform:'grab',gpRate:.30,gpFee:30,netSettlement:70
  });
  assert.deepEqual(deliverySettlement({salesChannel:'store',total:100,settings}),{
    salesChannel:'store',delivery:false,platform:null,gpRate:0,gpFee:0,netSettlement:100
  });
  assert.throws(()=>deliverySettlement({salesChannel:'unknown',total:100,settings}),/invalid_sales_channel/);
});

test('delivery GP settings are bounded and summary excludes non-paid/store sales',()=>{
  assert.deepEqual(normalizeDeliveryGp({deliveryGp:{grab:.3,lineman:1.2,other_delivery:-1}}),{grab:.3,lineman:.8,other_delivery:0});
  assert.deepEqual(deliverySummary([
    {status:'paid',salesChannel:'grab',total:100,gpFee:30,netSettlement:70},
    {status:'paid',salesChannel:'lineman',total:200,gpFee:50,netSettlement:150},
    {status:'paid',salesChannel:'store',total:80},
    {status:'refunded',salesChannel:'grab',total:100,gpFee:30,netSettlement:70},
  ]),{gross:300,gpFees:80,netSettlement:220,orders:2});
});

test('checkout persists server-authoritative delivery settlement and rejects split delivery',async()=>{
  const api=await read('lib/pos-api.mjs');
  assert.match(api,/deliverySettlement\(\{salesChannel:body\.salesChannel\|\|'store',total,settings:doc\.settings\|\|\{\}\}\)/);
  assert.match(api,/delivery_payment_must_be_platform/);
  assert.match(api,/delivery_split_not_supported/);
  assert.match(api,/delivery_offline_not_supported/);
  assert.match(api,/salesChannel:settlement\.salesChannel/);
  assert.match(api,/gpFee:settlement\.gpFee/);
  assert.match(api,/netSettlement:settlement\.netSettlement/);
});

test('settings bootstrap reports and CSV expose delivery GP without hard-coding platform rates',async()=>{
  const api=await read('lib/api.mjs'),settings=await read('app/settings/page.tsx'),pos=await read('app/pos/page.tsx'),reports=await read('app/reports/page.tsx');
  assert.match(api,/deliveryGp:normalizeDeliveryGp/);
  assert.match(api,/invalid_delivery_gp/);
  assert.match(api,/delivery=deliverySummary\(sales\)/);
  assert.match(api,/salesChannel:String\(s\.salesChannel\|\|'store'\)/);
  assert.match(api,/netSettlement:Number\(s\.netSettlement\?\?s\.total\)/);
  assert.match(settings,/Delivery GP/);
  assert.match(settings,/LINE MAN/);
  assert.match(settings,/GP %/);
  assert.match(pos,/CONFIRM DELIVERY ORDER/);
  assert.match(pos,/รับสุทธิ/);
  assert.match(pos,/payment:method==="delivery"\?"other":method/);
  assert.match(reports,/DELIVERY SETTLEMENT/);
});
