import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('POS bootstrap is cache-first and still revalidates against the server',async()=>{
  const pos=await read('app/pos/page.tsx'),offlineDb=await read('lib/offline-db.ts');
  assert.match(pos,/cacheGet<Bootstrap>\("\/api\/pos\/bootstrap",BOOTSTRAP_CACHE_MAX_AGE_MS\)/);
  assert.match(pos,/load\(true\)\.catch/);
  assert.match(pos,/acceptBootstrap\(cached\)/);
  const db=await read('lib/offline-db.ts');
  assert.match(pos,/BOOTSTRAP_CACHE_MAX_AGE_MS=BOOTSTRAP_OFFLINE_MAX_AGE_MS/);
  assert.match(db,/BOOTSTRAP_OFFLINE_MAX_AGE_MS=36\*60\*60\*1000/);
  const effectStart=pos.indexOf('// Render the last known sellable catalog immediately');
  const cache=pos.indexOf('cacheGet<Bootstrap>',effectStart);
  const network=pos.indexOf('load(true).catch',effectStart);
  assert.ok(effectStart>=0&&cache>effectStart&&network>cache);
});

test('cache-first bootstrap adds no client dependency',async()=>{
  const pkg=JSON.parse(await read('package.json'));
  assert.equal(pkg.dependencies.dexie,undefined);
  assert.ok(pkg.dependencies.zustand);
});
