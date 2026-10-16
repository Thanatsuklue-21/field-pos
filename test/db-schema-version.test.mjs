import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('schema startup uses a durable version marker before replaying DDL',async()=>{
  const db=await read('lib/db.mjs');
  const startup=db.slice(db.indexOf('schemaReady=(async()=>{'));
  assert.match(db,/const SCHEMA_VERSION=1/);
  assert.match(startup,/PRAGMA user_version/);
  assert.ok(startup.indexOf('PRAGMA user_version')<startup.indexOf('db.batch'));
  assert.ok(startup.indexOf('ensureSchemaMigrations(db)')<startup.lastIndexOf('PRAGMA user_version ='));
});
