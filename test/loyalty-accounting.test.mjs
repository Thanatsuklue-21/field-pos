import test from 'node:test';import assert from 'node:assert/strict';
import {resolveLoyalty,applyLoyaltyToCustomer,reverseLoyaltyFromCustomer} from '../lib/domain/loyalty.mjs';

test('loyalty redemption converts points to discount and awards new points from net spend',()=>{
  const x=resolveLoyalty({customer:{points:20},grossTotal:225,requestedPoints:10,settings:{pointsSpend:50,pointsRedeemValue:2}});
  assert.deepEqual(x,{grossTotal:225,subtotal:225,discountTotal:20,crmDiscount:20,netTotal:205,pointsRedeemed:10,pointsRedeemValue:2,pointsAwarded:4,pointsSpend:50});
});

test('loyalty redemption is server bounded by customer balance and bill total',()=>{
  assert.throws(()=>resolveLoyalty({customer:{points:2},grossTotal:100,requestedPoints:3,settings:{pointsRedeemValue:1}}),/insufficient_points/);
  assert.throws(()=>resolveLoyalty({customer:{points:100},grossTotal:20,requestedPoints:21,settings:{pointsRedeemValue:1}}),/points_discount_exceeds_total/);
  assert.throws(()=>resolveLoyalty({grossTotal:100,requestedPoints:1,settings:{pointsRedeemValue:1}}),/customer_required_for_points/);
  assert.throws(()=>resolveLoyalty({customer:{points:10},grossTotal:100,requestedPoints:1,settings:{pointsRedeemValue:0}}),/points_redemption_disabled/);
});

test('customer effects apply and reverse redeemed and awarded points exactly once at sale level',()=>{
  const customer={points:20,visits:2,totalSpend:300,lastVisit:0},loyalty=resolveLoyalty({customer,grossTotal:100,requestedPoints:5,settings:{pointsSpend:50,pointsRedeemValue:2}});
  applyLoyaltyToCustomer(customer,loyalty,123);
  assert.deepEqual(customer,{points:16,visits:3,totalSpend:390,lastVisit:123});
  reverseLoyaltyFromCustomer(customer,{total:90,pointsAwarded:1,pointsRedeemed:5});
  assert.equal(customer.points,20);assert.equal(customer.visits,2);assert.equal(customer.totalSpend,300);
});
