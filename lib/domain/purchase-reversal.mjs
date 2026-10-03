const n=v=>Number.isFinite(Number(v))?Number(v):0;

export function activePurchaseProfile(row){
  if(!row)return null;
  const packageQty=n(row.package_qty),quantityReceived=n(row.quantity_received),quantityPerPackage=packageQty>0?quantityReceived/packageQty:0;
  return {
    packageUnit:String(row.package_unit||''),
    packSize:row.pack_size==null?null:n(row.pack_size),
    packSizeUnit:String(row.pack_size_unit||''),
    quantityPerPackage,
    usageUnit:String(row.usage_unit||'g'),
    conversionApproximate:!!n(row.conversion_approximate),
    supplier:String(row.supplier||''),
    sourceUrl:String(row.source_url||''),
    imageUrl:String(row.image_url||''),
    purchaseCost:n(row.total_cost),
    purchaseDate:String(row.purchased_at||''),
    note:String(row.note||''),
    paymentMethod:String(row.payment_method||'bank'),
    updatedAt:n(row.created_at),
  };
}

export function applyPurchaseReversal({ingredient,purchase,previousPurchase=null}={}){
  if(!ingredient||!purchase)throw new Error('purchase_reversal_input_required');
  const qty=n(purchase.quantity_received),current=n(ingredient.qty);
  if(!(qty>0))throw new Error('invalid_purchase_quantity');
  if(current<qty)throw new Error('purchase_cancel_stock_negative');
  const next={...ingredient,qty:current-qty};
  if(previousPurchase){
    next.unitCost=n(previousPurchase.unit_cost);
    next.costStatus=next.unitCost>0?'CONFIRMED':'MISSING';
    next.purchaseProfile=activePurchaseProfile(previousPurchase);
  }else{
    next.unitCost=0;
    next.costStatus='MISSING';
    next.purchaseProfile=null;
  }
  return {ingredient:next,stockDelta:-qty,restoredPurchaseId:previousPurchase?String(previousPurchase.id):null};
}
