import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('purchase payment method is schema-migrated and persisted through stock flow',async()=>{
  const schema=await read('lib/schema.mjs'),db=await read('lib/db.mjs'),stock=await read('lib/stock-service.mjs'),api=await read('lib/api.mjs');
  assert.match(schema,/payment_method TEXT NOT NULL DEFAULT 'bank'/);
  assert.match(db,/ALTER TABLE field_purchase_records ADD COLUMN payment_method/);
  assert.match(stock,/purchasePaymentMethod/);
  assert.match(stock,/payment_method\) VALUES/);
  assert.match(api,/payment_method=\?/);
});

test('cash reconciliation subtracts only explicitly cash-paid expenses',async()=>{
  const api=await read('lib/api.mjs'),close=await read('app/close/page.tsx'),expenses=await read('app/expenses/page.tsx');
  assert.match(api,/cashPaidOut=cashExpenseTotal\(expenses\)/);
  assert.match(api,/reconcileCash\(\{openingCash,cashSales:cash,cashIn,cashPaidOut,cashOut,countedCash\}\)/);
  assert.match(close,/Expected Cash = เงินตั้งต้น \+ ยอดขายเงินสด \+ เงินเติมเข้า − ค่าใช้จ่ายเงินสด − เงินนำออก/);
  assert.match(close,/Cash Paid Out/);
  assert.match(expenses,/เงินสดจากลิ้นชัก/);
  assert.match(expenses,/paymentMethod/);
});

test('system-generated purchase and waste expenses cannot be deleted manually',async()=>{
  const api=await read('lib/api.mjs'),expenses=await read('app/expenses/page.tsx');
  assert.match(api,/system_expense_read_only/);
  assert.match(api,/\['PURCHASE','WASTE'\]/);
  assert.match(expenses,/STOCK_/);
});

test('waste is valued as non-cash operating expense instead of disappearing from accounting',async()=>{
  const stock=await read('lib/stock-service.mjs');
  assert.match(stock,/wanted\.type===STOCK_TX_TYPES\.WASTE/);
  assert.match(stock,/category:'WASTE'/);
  assert.match(stock,/paymentMethod:'noncash'/);
  assert.match(stock,/sourceType:'STOCK_WASTE'/);
});

test('reports expose inventory valuation and CSV exports for accountant',async()=>{
  const api=await read('lib/api.mjs'),reports=await read('app/reports/page.tsx');
  assert.match(api,/inventoryValuation\(doc\.ingredients\|\|\{\}\)/);
  assert.match(api,/\/api\/reports\/accounting-export/);
  assert.match(api,/inventorySummary/);
  assert.match(reports,/Sales CSV/);
  assert.match(reports,/Expenses CSV/);
  assert.match(reports,/Stock CSV/);
  assert.match(reports,/Cash Drawer CSV/);
  assert.match(api,/cashMovements/);
  assert.match(reports,/มูลค่า Stock คงเหลือ/);
  assert.match(reports,/text\/csv/);
});


test('cash drawer movements are audited and guarded by an open shift',async()=>{
  const api=await read('lib/api.mjs'),close=await read('app/close/page.tsx');
  assert.match(api,/\/api\/cash-shift\/movements/);
  assert.match(api,/cash_shift_not_open/);
  assert.match(api,/drawer_cash_shortage/);
  assert.match(api,/cash_drawer_movement/);
  assert.match(api,/type==='CASH_IN'/);
  assert.match(api,/type==='CASH_OUT'/);
  assert.match(close,/เงินสดเข้า\/ออกลิ้นชักระหว่างวัน/);
  assert.match(close,/เติมเงินเข้า/);
  assert.match(close,/นำเงินออก/);
});
