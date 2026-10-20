// Exact decimal accumulation, then one half-away-from-zero rounding to THB satang.
// Keep JSON/API values in baht; no binary floating-point arithmetic on amounts.
function decimal(value){
  if(typeof value!=='number'&&typeof value!=='string')throw new Error('invalid_money');
  const text=String(value).trim();
  if(!text||text.length>400||!Number.isFinite(Number(text)))throw new Error('invalid_money');
  const match=/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if(!match)throw new Error('invalid_money');
  const scale=(match[3]||'').length-Number(match[4]||0);
  if(Math.abs(scale)>400)throw new Error('invalid_money');
  return {units:BigInt((match[1]==='-'?'-':'')+match[2]+(match[3]||'')),scale};
}

export function sumMoney(values){
  let units=0n,scale=2;
  for(const value of values){
    const part=decimal(value),nextScale=Math.max(scale,part.scale);
    units=units*10n**BigInt(nextScale-scale)+part.units*10n**BigInt(nextScale-part.scale);
    scale=nextScale;
  }
  const divisor=10n**BigInt(scale-2),sign=units<0n?-1n:1n,absolute=units*sign;
  const minor=sign*((absolute+divisor/2n)/divisor);
  if(minor>BigInt(Number.MAX_SAFE_INTEGER)||minor<BigInt(Number.MIN_SAFE_INTEGER))throw new Error('money_overflow');
  // Conversion is only at the serialization boundary, after integer calculation.
  const magnitude=minor<0n?-minor:minor;
  return Number((minor<0n?'-':'')+String(magnitude/100n)+'.'+String(magnitude%100n).padStart(2,'0'));
}

export function multiplyMoney(amount,multiplier){
  const a=decimal(amount),b=decimal(multiplier);
  return sumMoney([String(a.units*b.units)+'e'+String(-a.scale-b.scale)]);
}

export function floorMoneyRatio(amount,divisor){
  const a=decimal(amount),b=decimal(divisor),scale=Math.max(a.scale,b.scale);
  if(a.units<0n||b.units<=0n)throw new Error('invalid_money_ratio');
  const result=(a.units*10n**BigInt(scale-a.scale))/(b.units*10n**BigInt(scale-b.scale));
  if(result>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('money_overflow');
  return Number(result);
}
