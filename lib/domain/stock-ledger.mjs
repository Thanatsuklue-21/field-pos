export const STOCK_TX_TYPES = Object.freeze({
  OPENING_BALANCE: 'OPENING_BALANCE',
  PURCHASE: 'PURCHASE',
  SALE: 'SALE',
  VOID_REVERSAL: 'VOID_REVERSAL',
  WASTE: 'WASTE',
  ADJUSTMENT: 'ADJUSTMENT',
});

const VALID_TYPES = new Set(Object.values(STOCK_TX_TYPES));

function stableIdPart(value) {
  return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'none';
}

export function createStockTransaction({
  id,
  ingredientId,
  type,
  qtyDelta,
  unit = 'g',
  referenceType = null,
  referenceId = null,
  reason = '',
  createdAt = Date.now(),
  createdBy = null,
}) {
  if (!ingredientId) throw new Error('ingredient_required');
  if (!VALID_TYPES.has(type)) throw new Error('invalid_stock_transaction_type');
  const delta = Number(qtyDelta);
  if (!Number.isFinite(delta) || delta === 0) throw new Error('invalid_qty_delta');

  return {
    id: id || `stx_${createdAt}_${stableIdPart(ingredientId)}_${stableIdPart(referenceId)}`,
    ingredientId: String(ingredientId),
    type,
    qtyDelta: delta,
    unit: String(unit || 'g'),
    referenceType,
    referenceId,
    reason: String(reason || ''),
    createdAt,
    createdBy,
  };
}

export function stockBalance(transactions, ingredientId, opening = 0) {
  if (!Array.isArray(transactions)) throw new Error('transactions_required');
  return transactions
    .filter((tx) => tx?.ingredientId === ingredientId)
    .reduce((sum, tx) => sum + Number(tx.qtyDelta || 0), Number(opening) || 0);
}

export function saleTransactionsFromRecipe({
  recipe,
  quantity = 1,
  saleId,
  createdAt = Date.now(),
  createdBy = null,
}) {
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) throw new Error('invalid_recipe');
  const multiplier = Number(quantity);
  if (!Number.isFinite(multiplier) || multiplier <= 0) throw new Error('invalid_quantity');

  return Object.entries(recipe)
    .filter(([, usage]) => Number(usage) > 0)
    .map(([ingredientId, usage], index) => createStockTransaction({
      id: `stx_sale_${stableIdPart(saleId || createdAt)}_${index}`,
      ingredientId,
      type: STOCK_TX_TYPES.SALE,
      qtyDelta: -Number(usage) * multiplier,
      unit: 'g',
      referenceType: 'sale',
      referenceId: saleId || null,
      createdAt,
      createdBy,
    }));
}

export function reverseTransactions(transactions, {
  referenceType = 'void',
  referenceId,
  createdAt = Date.now(),
  createdBy = null,
  reason = 'void',
} = {}) {
  if (!Array.isArray(transactions) || transactions.length === 0) throw new Error('transactions_required');

  return transactions.map((tx, index) => createStockTransaction({
    id: `stx_reverse_${stableIdPart(referenceId || createdAt)}_${index}`,
    ingredientId: tx.ingredientId,
    type: STOCK_TX_TYPES.VOID_REVERSAL,
    qtyDelta: -Number(tx.qtyDelta),
    unit: tx.unit,
    referenceType,
    referenceId: referenceId || tx.referenceId || null,
    reason,
    createdAt,
    createdBy,
  }));
}

export function dedupeTransactions(transactions) {
  const seen = new Set();
  const out = [];
  for (const tx of transactions || []) {
    if (!tx?.id || seen.has(tx.id)) continue;
    seen.add(tx.id);
    out.push(tx);
  }
  return out;
}
