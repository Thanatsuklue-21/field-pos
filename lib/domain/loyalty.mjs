const n=v=>Number(v)||0;
const money=v=>Math.round((n(v)+Number.EPSILON)*100)/100;
const fail=message=>{throw new Error(message)};

export function resolveLoyalty({customer,grossTotal,requestedPoints=0,settings={}}={}){
  const gross=money(Math.max(0,n(grossTotal)));
  const rawRequested=Number(requestedPoints??0);
  if(!Number.isFinite(rawRequested)||rawRequested<0||!Number.isInteger(rawRequested)||rawRequested>1e6)fail('invalid_points_redeem');
  const pointsRedeemed=Math.trunc(rawRequested);
  const pointsSpend=Math.max(0,n(settings?.pointsSpend));
  const pointsRedeemValue=Math.max(0,n(settings?.pointsRedeemValue));
  if(pointsRedeemed>0&&!customer)fail('customer_required_for_points');
  if(pointsRedeemed>0&&pointsRedeemValue<=0)fail('points_redemption_disabled');
  const availablePoints=Math.max(0,Math.trunc(n(customer?.points)));
  if(pointsRedeemed>availablePoints)fail('insufficient_points');
  const discountTotal=money(pointsRedeemed*pointsRedeemValue);
  if(discountTotal>gross)fail('points_discount_exceeds_total');
  const netTotal=money(gross-discountTotal);
  const pointsAwarded=customer&&pointsSpend>0?Math.floor(netTotal/pointsSpend):0;
  return {grossTotal:gross,subtotal:gross,discountTotal,crmDiscount:discountTotal,netTotal,pointsRedeemed,pointsRedeemValue,pointsAwarded,pointsSpend};
}

export function applyLoyaltyToCustomer(customer,loyalty,now=Date.now()){
  if(!customer)return null;
  customer.points=Math.max(0,Math.trunc(n(customer.points))-Math.trunc(n(loyalty?.pointsRedeemed))+Math.trunc(n(loyalty?.pointsAwarded)));
  customer.visits=Math.max(0,Math.trunc(n(customer.visits)))+1;
  customer.totalSpend=money(Math.max(0,n(customer.totalSpend))+Math.max(0,n(loyalty?.netTotal)));
  customer.lastVisit=now;
  return customer;
}

export function reverseLoyaltyFromCustomer(customer,sale){
  if(!customer)return null;
  customer.totalSpend=money(Math.max(0,n(customer.totalSpend)-Math.max(0,n(sale?.total))));
  customer.points=Math.max(0,Math.trunc(n(customer.points))-Math.trunc(n(sale?.pointsAwarded))+Math.trunc(n(sale?.pointsRedeemed)));
  customer.visits=Math.max(0,Math.trunc(n(customer.visits))-1);
  return customer;
}
