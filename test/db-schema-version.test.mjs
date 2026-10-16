import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('schema startup uses a durable version marker before replaying DDL',async()=>{
  const db=await read('lib/db.mjs');
  assert.match(db,/const SCHEMA_VERSION=1/);
  assert.match(db,/PRAGMA user_version/);
  assert.ok(db.indexOf('PRAGMA user_version')<db.indexOf('db\.batch'));
  assert.ok(db.indexOf('ensureSchemaMigrations\(db\)')<db.lastIndexOf('PRAGMA user_version ='));
});
