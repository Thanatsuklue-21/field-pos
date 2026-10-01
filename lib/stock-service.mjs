import {randomUUID} from 'node:crypto';
import {STOCK_TX_TYPES, createStockTransaction} from './domain/stock-ledger.mjs';
import {bangkokDate} from './time.mjs';

const VALID_TYPES = new Set(Object.values(STOCK_TX_TYPES));
const REQUEST_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

function cleanText(value, max = 120) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (!text || text.length > max) throw new Error('invalid_stock_text');
  return text;
}

function validateSign(type, qtyDelta) {
  if (type === STOCK_TX_TYPES.PURCHASE && qtyDelta <= 0) throw new Error('purchase_must_increase_stock');
  if (type === STOCK_TX_TYPES.SALE && qtyDelta >= 0) throw new Error('sale_must_decrease_stock');
  if (type === STOCK_TX_TYPES.WASTE && qtyDelta >= 0) throw new Error('waste_must_decrease_stock');
  if (type === STOCK_TX_TYPES.VOID_REVERSAL && qtyDelta <= 0) throw new Error('void_reversal_must_increase_stock');
}

export function normalizeStockWrite(input, {actorId, now = Date.now()} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_stock_transaction');

  const requestKey = String(input.requestKey || '').trim();
  if (!REQUEST_KEY_RE.test(requestKey)) throw new Error('invalid_request_key');

  const ingredientId = cleanText(input.ingredientId, 80);
  if (!ingredientId) throw new Error('ingredient_required');

  const type = String(input.type || '');
  if (!VALID_TYPES.has(type)) throw new Error('invalid_stock_transaction_type');

  const qtyDelta = Number(input.qtyDelta);
  if (!Number.isFinite(qtyDelta) || qtyDelta === 0) throw new Error('invalid_qty_delta');
  validateSign(type, qtyDelta);

  const tx = createStockTransaction({
    id: `stx_${randomUUID()}`,
    ingredientId,
    type,
    qtyDelta,
    unit: cleanText(input.unit || 'g', 16),
    referenceType: cleanText(input.referenceType, 40),
    referenceId: cleanText(input.referenceId, 120),
    reason: cleanText(input.reason, 240) || '',
    createdAt: now,
    createdBy: actorId || null,
  });

  const purchaseCost=input.purchaseCost===undefined?null:Number(input.purchaseCost);
  if(type===STOCK_TX_TYPES.PURCHASE&&purchaseCost!==null&&(!Number.isFinite(purchaseCost)||purchaseCost<0))throw new Error('invalid_purchase_cost');
  return {...tx, requestKey, purchaseCost};
}

function rowToStock(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    ingredientId: String(row.ingredient_id),
    type: String(row.tx_type),
    qtyDelta: Number(row.qty_delta),
    unit: String(row.unit),
    referenceType: row.reference_type == null ? null : String(row.reference_type),
    referenceId: row.reference_id == null ? null : String(row.reference_id),
    requestKey: String(row.request_key),
    reason: String(row.reason || ''),
    createdBy: row.actor_id == null ? null : String(row.actor_id),
    createdAt: Number(row.created_at),
  };
}

function sameRequest(a, b) {
  return a.ingredientId === b.ingredientId &&
    a.type === b.type &&
    a.qtyDelta === b.qtyDelta &&
    a.unit === b.unit &&
    a.referenceType === b.referenceType &&
    a.referenceId === b.referenceId &&
    a.reason === b.reason;
}

export async function recordStockTransaction({db, actorId, input, now = Date.now()}) {
  const wanted = normalizeStockWrite(input, {actorId, now});
  const tx = await db.transaction('write');

  try {
    const found = (await tx.execute({
      sql: 'SELECT * FROM field_stock_transactions WHERE request_key=?',
      args: [wanted.requestKey],
    })).rows[0];

    if (found) {
      const existing = rowToStock(found);
      if (!sameRequest(existing, wanted)) {
        await tx.rollback();
        return {status: 'conflict', transaction: existing};
      }
      await tx.rollback();
      return {status: 'replayed', transaction: existing};
    }

    await tx.execute({
      sql: `INSERT INTO field_stock_transactions(
        id,ingredient_id,tx_type,qty_delta,unit,reference_type,reference_id,request_key,reason,actor_id,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        wanted.id,
        wanted.ingredientId,
        wanted.type,
        wanted.qtyDelta,
        wanted.unit,
        wanted.referenceType,
        wanted.referenceId,
        wanted.requestKey,
        wanted.reason,
        wanted.createdBy,
        wanted.createdAt,
      ],
    });

    const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0];
    if(!state)throw new Error('state_missing');
    const doc=JSON.parse(state.document||'{}');
    if(!doc.ingredients||typeof doc.ingredients!=='object')doc.ingredients={};
    const ingredient=doc.ingredients[wanted.ingredientId];
    if(!ingredient)throw new Error('ingredient_missing');
    const nextQty=Number(ingredient.qty||0)+wanted.qtyDelta;
    if(nextQty<0)throw new Error('stock_shortage');
    ingredient.qty=nextQty;
    if(wanted.type===STOCK_TX_TYPES.PURCHASE&&wanted.purchaseCost!==null){
      ingredient.unitCost=wanted.qtyDelta>0?wanted.purchaseCost/wanted.qtyDelta:Number(ingredient.unitCost||0);
      if(!Array.isArray(doc.expenses))doc.expenses=[];
      doc.expenses.push({
        id:'exp_'+randomUUID(),date:bangkokDate(now),time:now,
        category:'PURCHASE',description:'Purchase '+(ingredient.name||wanted.ingredientId),
        amount:wanted.purchaseCost,ingredientId:wanted.ingredientId,qty:wanted.qtyDelta,unit:wanted.unit,
        referenceId:wanted.referenceId||wanted.id,createdBy:actorId||null
      });
    }
    await tx.execute({
      sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',
      args:[JSON.stringify(doc),now],
    });

    await tx.execute({
      sql: 'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',
      args: [
        actorId || null,
        'stock_transaction_create',
        JSON.stringify({
          id: wanted.id,
          ingredientId: wanted.ingredientId,
          type: wanted.type,
          qtyDelta: wanted.qtyDelta,
          referenceType: wanted.referenceType,
          referenceId: wanted.referenceId,
          requestKey: wanted.requestKey,
        }),
        now,
      ],
    });

    await tx.commit();
    return {status: 'created', transaction: wanted};
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  }
}
