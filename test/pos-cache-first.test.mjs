import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('POS bootstrap is cache-first and still revalidates against the server',async()=>{
  const pos=await read('app/pos/page.tsx');
  assert.match(pos,/cacheGet<Bootstrap>\("\/api\/pos\/bootstrap",BOOTSTRAP_CACHE_MAX_AGE_MS\)/);
  assert.match(pos,/load\(true\)\.catch/);
  assert.match(pos,/acceptBootstrap\(cached\)/);
  assert.match(pos,/36\*60\*60\*1000/);
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


test('POS starts safe bootstrap preloading through AuthGate before waiting for the session',async()=>{
  const gate=await read('components/auth-gate.tsx');
  const pos=await read('app/pos/page.tsx');
  assert.match(pos,/<AuthGate preloadPath="\/api\/pos\/bootstrap">/);
  assert.match(gate,/preloadPath\?:string/);
  assert.match(gate,/preloadSafeGet/);
  const preload=gate.indexOf('preloadSafeGet(preloadPath)');
  const session=gate.indexOf('getSessionCached()');
  assert.ok(preload>=0&&session>preload,'bootstrap preload must start before session request');
  assert.match(gate,/if\(loading\)return/);
});
