import test from 'node:test';
import assert from 'node:assert/strict';
import {SCHEMA} from '../lib/schema.mjs';

test('v8 schema contains required additive tables', () => {
  const sql = SCHEMA.join('\n');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS field_stock_transactions/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS field_recipe_versions/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS field_cost_snapshots/);

  assert.match(sql, /CREATE INDEX IF NOT EXISTS field_stock_transactions_ingredient_created/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS field_stock_transactions_reference/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS field_cost_snapshots_sale/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS field_purchase_records/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS field_purchase_records_ingredient_date/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS field_cost_history/);
  assert.match(sql, /cost_status IN \('MISSING','PROVISIONAL','CONFIRMED'\)/);
  assert.match(sql, /effective_date TEXT NOT NULL/);
});

test('v8 stock ledger enforces non-zero quantity', () => {
  const sql = SCHEMA.join('\n');
  assert.match(sql, /qty_delta REAL NOT NULL CHECK\(qty_delta<>0\)/);
});

test('v8 recipe versions are unique per menu and version', () => {
  const sql = SCHEMA.join('\n');
  assert.match(sql, /UNIQUE\(menu_id,version\)/);
});
