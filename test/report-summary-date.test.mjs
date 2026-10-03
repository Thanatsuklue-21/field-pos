import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('reports summary uses current Bangkok business date rather than last sales date',async()=>{
  const api=await read('lib/api.mjs');
  const start=api.indexOf("if(path==='/api/reports/summary'");
  const end=api.indexOf("if(path==='/api/pos/split/cancel'",start);
  assert.ok(start>0&&end>start);
  const seg=api.slice(start,end);
  assert.match(seg,/const today=bangkokDate\(now\),todayRevenue=Number\(byDate\[today\]\)\|\|0/);
  assert.doesNotMatch(seg,/today=dates\.at\(-1\)/);
});
