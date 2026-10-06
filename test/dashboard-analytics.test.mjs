import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
test('management dashboard exposes operating analytics and purchase recommendations',async()=>{const api=await read('lib/api.mjs'),ui=await read('app/dashboard/page.tsx');assert.match(api,/buildOperationalAnalytics/);assert.match(api,/purchaseRecommendations/);assert.match(api,/ช่วงเวลายอดเด่น/);assert.match(ui,/OPERATING PATTERN · 14 DAYS/);assert.match(ui,/PURCHASE PLAN · 7-DAY TARGET/);assert.match(ui,/daysCover/);assert.match(ui,/suggestQty/);});


test('dashboard exposes a direct order-entry shortcut and Thai nav names it clearly',async()=>{const ui=await read('app/dashboard/page.tsx'),i18n=await read('lib/i18n.ts');assert.match(ui,/href="\/pos"/);assert.match(ui,/รับออเดอร์/);assert.match(i18n,/pos:"รับออเดอร์"/);});
