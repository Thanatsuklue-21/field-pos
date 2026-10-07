import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildDeliverySettlementGroups,createDeliveryReconciliation,deliveryReconciliationSummary} from '../lib/domain/delivery-reconciliation.mjs';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const sale=(id,date,platform,total,gpFee,net,status='paid')=>({id,date,status,salesChannel:platform,deliveryPlatform:platform,total,gpFee,netSettlement:net});

test('delivery receivables group paid delivery sales by date and platform',()=>{
  const sales=[
    sale('s1','2026-10-01','grab',100,30,70),
    sale('s2','2026-10-01','grab',200,60,140),
    sale('s3','2026-10-01','lineman',80,20,60),
    sale('s4','2026-10-01','grab',999,300,699,'refunded'),
    {id:'store1',date:'2026-10-01',status:'paid',salesChannel:'store',total:50}
  ];
  const groups=buildDeliverySettlementGroups(sales,[]);
  assert.equal(groups.length,2);
  const grab=groups.find(x=>x.platform==='grab');
  assert.equal(grab.orders,2);
  assert.equal(grab.gross,300);
  assert.equal(grab.gpFees,90);
  assert.equal(grab.expectedAmount,210);
});

test('reconciliation records matched and variance outcomes server-side',()=>{
  const sales=[sale('s1','2026-10-01','grab',100,30,70),sale('s2','2026-10-01','grab',200,60,140)];
  const matched=createDeliveryReconciliation({sales,reconciliations:[],saleDate:'2026-10-01',platform:'grab',receivedAmount:210,receivedDate:'2026-10-03',now:1,userId:'admin'});
  assert.equal(matched.expectedAmount,210);
  assert.equal(matched.variance,0);
  assert.equal(matched.status,'matched');
  const variance=createDeliveryReconciliation({sales,reconciliations:[],saleDate:'2026-10-01',platform:'grab',receivedAmount:205,receivedDate:'2026-10-03',now:2,userId:'admin'});
  assert.equal(variance.variance,-5);
  assert.equal(variance.status,'variance');
});

test('reconciled sales leave pending list and cancelled reconciliation reopens them',()=>{
  const sales=[sale('s1','2026-10-01','grab',100,30,70)];
  const rec=createDeliveryReconciliation({sales,reconciliations:[],saleDate:'2026-10-01',platform:'grab',receivedAmount:70,receivedDate:'2026-10-03',now:1,userId:'admin'});
  assert.equal(buildDeliverySettlementGroups(sales,[rec]).length,0);
  assert.equal(buildDeliverySettlementGroups(sales,[{...rec,cancelledAt:2}]).length,1);
});

test('summary excludes cancelled reconciliations',()=>{
  const rows=[
    {expectedAmount:70,receivedAmount:70,variance:0,status:'matched'},
    {expectedAmount:100,receivedAmount:95,variance:-5,status:'variance'},
    {expectedAmount:50,receivedAmount:50,variance:0,status:'matched',cancelledAt:1}
  ];
  assert.deepEqual(deliveryReconciliationSummary(rows),{records:2,matched:1,variance:1,expected:170,received:165,netVariance:-5});
});

test('invalid dates and missing groups are rejected',()=>{
  assert.throws(()=>createDeliveryReconciliation({sales:[],saleDate:'2026-02-30',platform:'grab',receivedAmount:1,receivedDate:'2026-10-03'}),/invalid_settlement_date/);
  assert.throws(()=>createDeliveryReconciliation({sales:[],saleDate:'2026-10-01',platform:'grab',receivedAmount:1,receivedDate:'2026-10-03'}),/delivery_settlement_group_not_found/);
});

test('API and UI expose auditable delivery settlement workflow',async()=>{
  const api=await read('lib/api.mjs'),ui=await read('app/settlements/page.tsx'),reports=await read('app/reports/page.tsx'),settings=await read('app/settings/page.tsx');
  assert.match(api,/\/api\/accounting\/settlements/);
  assert.match(api,/delivery_settlement_reconcile/);
  assert.match(api,/delivery_settlement_cancel/);
  assert.match(api,/before_delivery_reconciliation/);
  assert.match(ui,/รอกระทบยอด/);
  assert.match(ui,/ยอดเงินที่เข้าจริง/);
  assert.match(ui,/ยืนยันเงินเข้าและกระทบยอด/);
  assert.match(ui,/ยกเลิก reconciliation/);
  assert.match(reports,/href="\/settlements"/);
  assert.match(settings,/กระทบยอด Delivery/);
});
