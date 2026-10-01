import {recordStockTransaction} from './stock-service.mjs';

const STOCK_INPUT_ERRORS = new Set([
  'invalid_stock_transaction',
  'invalid_request_key',
  'ingredient_required',
  'invalid_stock_transaction_type',
  'invalid_qty_delta',
  'invalid_stock_text',
  'purchase_must_increase_stock',
  'sale_must_decrease_stock',
  'waste_must_decrease_stock',
  'void_reversal_must_increase_stock',
  'ingredient_missing',
]);

export function canWriteStock(user) {
  return !!user && (
    user.role === 'admin' ||
    (user.role === 'staff' && user.permissions?.stock === true)
  );
}

export async function handleStockApi({
  path,
  method,
  user,
  db,
  body,
  now = Date.now(),
}) {
  if (path !== '/api/stock/transactions' || method !== 'POST') return null;

  if (!canWriteStock(user)) {
    return {status: 403, body: {error: 'stock_permission_required'}};
  }

  try {
    const result = await recordStockTransaction({
      db,
      actorId: user.id,
      input: body,
      now,
    });

    if (result.status === 'conflict') {
      return {
        status: 409,
        body: {
          error: 'idempotency_conflict',
          transaction: result.transaction,
        },
      };
    }

    return {
      status: result.status === 'created' ? 201 : 200,
      body: {
        ok: true,
        replayed: result.status === 'replayed',
        transaction: result.transaction,
      },
    };
  } catch (error) {
    const code = String(error?.message || '');
    if(code==='stock_shortage')return {status:409,body:{error:code}};
    if (STOCK_INPUT_ERRORS.has(code)) {
      return {status: 400, body: {error: code}};
    }
    throw error;
  }
}
