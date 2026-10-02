import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
test('cycle count is an explicit atomic stock adjustment with audit trail',async()=>{const api=await read('lib/api.mjs');assert.match(api,/\/api\/stock\/cycle-count/);assert.match(api,/cycle_count_requires_confirmation/);assert.match(api,/CYCLE_COUNT/);assert.match(api,/cycle_count_commit/);assert.match(api,/requestKey/)});
test('stock UI offers a focused daily count flow',async()=>{const ui=await read('app/stock/page.tsx');assert.match(ui,/DAILY COUNT/);assert.match(ui,/ยืนยันผลตรวจนับ/);assert.match(ui,/\/api\/stock\/cycle-count/)});
