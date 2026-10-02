const ALIASES=new Map([
  ['g','g'],['gram','g'],['grams','g'],['กรัม','g'],
  ['kg','kg'],['kilogram','kg'],['kilograms','kg'],['กก','kg'],['กิโลกรัม','kg'],
  ['ml','ml'],['milliliter','ml'],['milliliters','ml'],['มล','ml'],['มิลลิลิตร','ml'],
  ['l','l'],['liter','l'],['liters','l'],['litre','l'],['litres','l'],['ลิตร','l'],
  ['piece','piece'],['pieces','piece'],['pc','piece'],['pcs','piece'],['ชิ้น','piece']
]);

export function normalizeUsageUnit(unit){
  const key=String(unit||'').trim().toLowerCase();
  const normalized=ALIASES.get(key);
  if(!normalized)throw new Error('unsupported_stock_unit');
  return normalized;
}

export function convertQuantityToUsageUnit(value,fromUnit,toUnit){
  const qty=Number(value);
  if(!Number.isFinite(qty)||qty<=0)throw new Error('invalid_pack_size');
  const from=normalizeUsageUnit(fromUnit),to=normalizeUsageUnit(toUnit);
  if(from===to)return {quantity:qty,approximate:false};
  const mass={g:1,kg:1000},volume={ml:1,l:1000};
  if(from in mass&&to in mass)return {quantity:qty*mass[from]/mass[to],approximate:false};
  if(from in volume&&to in volume)return {quantity:qty*volume[from]/volume[to],approximate:false};
  // FIELD operational policy: liquid ingredients may use 1 ml ≈ 1 g.
  if((from in mass&&to in volume)||(from in volume&&to in mass)){
    const base=from in mass?qty*mass[from]:qty*volume[from];
    return {quantity:to==='kg'||to==='l'?base/1000:base,approximate:true};
  }
  throw new Error('incompatible_stock_unit');
}

export function calculateReceivedQuantity({packageQty,packSize,packSizeUnit,usageUnit}){
  const packages=Number(packageQty);
  if(!Number.isFinite(packages)||packages<=0)throw new Error('invalid_package_qty');
  const converted=convertQuantityToUsageUnit(packSize,packSizeUnit,usageUnit);
  return {
    quantity:packages*converted.quantity,
    quantityPerPackage:converted.quantity,
    approximate:converted.approximate,
  };
}
