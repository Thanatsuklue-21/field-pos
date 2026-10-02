import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('product API preserves archived menus with dated removal reasons',async()=>{
  const api=await read('lib/api.mjs');
  assert.match(api,/archived:!!m\.archived/);
  assert.match(api,/archivedReason:m\.archivedReason\|\|''/);
  assert.match(api,/archivedAt:Number\(m\.archivedAt\)\|\|null/);
  assert.match(api,/archive_reason_required/);
  assert.match(api,/product\.archivedReason=reason/);
});

test('product management exposes active and archived lists and submits a reason',async()=>{
  const ui=await read('app/products/page.tsx');
  assert.match(ui,/"active"\|"archived"/);
  assert.match(ui,/เมนูที่ตัดออก/);
  assert.match(ui,/archiveReason/);
  assert.match(ui,/reason:archiveReason/);
});
