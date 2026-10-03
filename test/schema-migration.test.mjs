import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureSchemaMigrations} from '../lib/db.mjs';

test('existing databases add missing purchase package history columns once',async()=>{
  const columns=new Set(['id','stock_transaction_id','ingredient_id','package_qty','package_unit','quantity_received','usage_unit']);
  const applied=[];
  const db={
    async execute(sql){
      if(String(sql).startsWith('PRAGMA table_info'))return {rows:[...columns].map(name=>({name}))};
      applied.push(String(sql));
      const match=String(sql).match(/ADD COLUMN\s+(\w+)/i);if(match)columns.add(match[1]);
      return {rows:[]};
    },
    async batch(statements){
      for(const statement of statements){
        applied.push(statement.sql);
        const match=statement.sql.match(/ADD COLUMN\s+(\w+)/i);if(match)columns.add(match[1]);
      }
      return [];
    }
  };
  assert.equal(await ensureSchemaMigrations(db),true);
  assert.equal(applied.length,4);
  assert.ok(columns.has('pack_size'));
  assert.ok(columns.has('pack_size_unit'));
  assert.ok(columns.has('conversion_approximate'));
  assert.ok(columns.has('payment_method'));
  applied.length=0;
  assert.equal(await ensureSchemaMigrations(db),false);
  assert.equal(applied.length,0);
});
