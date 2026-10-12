const SATANG_SCALE=100;
const SATANG_EPSILON=1e-7;

/**
 * Monetary input accepted by FIELD POS must resolve to a whole satang.
 * Keep this guard at transaction boundaries; ingredient unit costs and
 * recipe costing intentionally retain higher precision.
 */
export function isSatangAmount(value){
  const amount=Number(value);
  if(!Number.isFinite(amount))return false;
  const scaled=amount*SATANG_SCALE;
  return Math.abs(scaled-Math.round(scaled))<SATANG_EPSILON;
}

export function roundSatang(value){
  const amount=Number(value);
  if(!Number.isFinite(amount))throw new Error('invalid_money_amount');
  return Math.round((amount+Number.EPSILON)*SATANG_SCALE)/SATANG_SCALE;
}
