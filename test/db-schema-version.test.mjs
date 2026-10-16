import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('schema startup uses a durable Turso metadata row before replaying DDL',async()=>{
  const db=await read('lib/db.mjs');
  const startup=db.slice(db.indexOf('schemaReady=(async()=>{'));
  assert.match(db,/const SCHEMA_VERSION=1/);
  assert.match(db,/field_schema_meta/);
  assert.match(db,/SELECT version FROM/);
  assert.match(db,/CREATE TABLE IF NOT EXISTS/);
  assert.match(db,/INSERT INTO/);
  assert.doesNotMatch(db,/PRAGMA user_version/);
  assert.ok(startup.indexOf('readSchemaVersion(db)')<startup.indexOf('db.batch'));
  assert.ok(startup.indexOf('ensureSchemaMigrations(db)')<startup.indexOf('writeSchemaVersion(db)'));
});

test('schema version read only treats a missing metadata table as version zero',async()=>{
  const db=await read('lib/db.mjs');
  const start=db.indexOf('async function readSchemaVersion');
  const end=db.indexOf('async function writeSchemaVersion',start);
  const block=db.slice(start,end);
  assert.match(block,/no such table/);
  assert.match(block,/throw error/);
  assert.doesNotMatch(block,/catch\{return 0\}/);
});

test('newer schema version fails closed instead of downgrading',async()=>{
  const db=await read('lib/db.mjs');
  assert.match(db,/version>SCHEMA_VERSION/);
  assert.match(db,/schema_version_newer_than_app/);
});
