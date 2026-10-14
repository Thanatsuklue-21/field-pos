import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
test('admin readiness is read-only and exposes operational readiness without provider secrets',async()=>{const api=await read('lib/api.mjs');const start=api.indexOf("if(path==='/api/admin/readiness'"),end=api.indexOf("if(path==='/api/admin/business-settings'",start);assert.ok(start>0&&end>start);const seg=api.slice(start,end);assert.match(seg,/promptPayConfig\(\)/);for(const field of ['readyForCashSales','readyForPromptPay','readyForFullOperations','openOrders','pendingPayments','splitCollecting','splitRequiresResolution','missingCost','pendingCost','lowStock','availableMenus','availableVariants','no_available_menu'])assert.match(seg,new RegExp(field));assert.doesNotMatch(seg,/OMISE_SECRET_KEY|secret\(/);assert.doesNotMatch(seg,/UPDATE |INSERT |DELETE /)});
test('settings surfaces readiness without exposing secrets',async()=>{const ui=await read('app/settings/page.tsx');assert.match(ui,/SYSTEM READINESS/);assert.match(ui,/READY FOR CASH SALES/);assert.match(ui,/\/api\/admin\/readiness/);assert.match(ui,/PromptPay/);assert.doesNotMatch(ui,/OMISE_SECRET_KEY/)});


test('readiness cash flag is gated by actual stock availability',async()=>{const api=await read('lib/api.mjs');const start=api.indexOf("if(path==='/api/admin/readiness'"),end=api.indexOf("if(path==='/api/admin/business-settings'",start),seg=api.slice(start,end);assert.match(seg,/buildPosAvailability/);assert.match(seg,/availableVariants>0/);assert.match(seg,/no_available_menu/)});


test('terminal orders do not create false readiness warnings',async()=>{const api=await read('lib/api.mjs');const start=api.indexOf("if(path==='/api/admin/readiness'"),end=api.indexOf("if(path==='/api/admin/business-settings'",start),seg=api.slice(start,end);assert.match(seg,/\['returned','void','refunded','cancelled'\]/)});


test('AI system readiness includes accounting and module blockers',async()=>{
  const api=await read('lib/api.mjs'),ui=await read('app/settings/page.tsx');
  const start=api.indexOf("if(path==='/api/admin/readiness'");
  const end=api.indexOf("if(path==='/api/admin/business-settings'",start);
  const seg=api.slice(start,end);
  assert.match(seg,/buildAccountingReconciliation/);
  assert.match(seg,/aiSystemCheck/);
  assert.match(seg,/status:aiBlockers\.length\?'NOT_READY':aiWarnings\.length\?'READY_WITH_WARNINGS':'READY'/);
  assert.match(seg,/id:'accounting'/);
  assert.match(seg,/id:'payment'/);
  assert.match(seg,/id:'stock'/);
  assert.match(seg,/id:'queue'/);
  assert.match(ui,/AI SYSTEM CHECK/);
  assert.match(ui,/BLOCKERS/);
  assert.match(ui,/aiSystemCheck\.modules/);
});

test('full operation readiness is blocked by accounting reconciliation failure',async()=>{
  const api=await read('lib/api.mjs');
  const start=api.indexOf("if(path==='/api/admin/readiness'");
  const end=api.indexOf("if(path==='/api/admin/business-settings'",start);
  const seg=api.slice(start,end);
  assert.match(seg,/readyForFullOperations=.*accounting\.ok/);
  assert.match(seg,/accounting_reconciliation_failed/);
});


test('production readiness separates cash-only from full operations',async()=>{
  const api=await read('lib/api.mjs'),ui=await read('app/settings/page.tsx');
  const start=api.indexOf("if(path==='/api/admin/readiness'");
  const end=api.indexOf("if(path==='/api/admin/business-settings'",start);
  const seg=api.slice(start,end);
  assert.match(seg,/productionGate/);
  assert.match(seg,/READY_CASH_ONLY/);
  assert.match(seg,/READY_FULL/);
  assert.match(seg,/payment_recovery/);
  assert.match(seg,/offline_safety/);
  assert.match(seg,/disaster_recovery/);
  assert.match(seg,/backup_restore_drill/);
  assert.match(ui,/PRODUCTION GATE/);
  assert.match(ui,/ต้องแก้ก่อนเปิดจริง/);
  assert.match(ui,/PromptPay/);
});

test('production readiness keeps backup restore drill visible before opening',async()=>{
  const api=await read('lib/api.mjs');
  const start=api.indexOf("if(path==='/api/admin/readiness'");
  const end=api.indexOf("if(path==='/api/admin/business-settings'",start);
  const seg=api.slice(start,end);
  assert.match(seg,/Full Backup \+ Restore Preview แบบ transactional/);
  assert.match(seg,/ทดลอง Export Backup → Preview Restore ก่อนเปิดจริง/);
});


test('release freshness is exposed without secrets',async()=>{
  const api=await read('lib/api.mjs'),ui=await read('app/settings/page.tsx');
  assert.match(api,/VERCEL_GIT_COMMIT_SHA/);
  assert.match(api,/VERCEL_GIT_COMMIT_REF/);
  assert.match(api,/VERCEL_ENV/);
  assert.match(api,/Release Freshness/);
  assert.match(ui,/Release/);
  assert.doesNotMatch(api,/TURSO_AUTH_TOKEN|OMISE_SECRET_KEY/);
});

test('health endpoint includes release identity for production smoke checks',async()=>{
  const api=await read('lib/api.mjs');
  const start=api.indexOf("if(path==='/api/health'");
  const end=api.indexOf("const signedPaymentWebhook",start);
  const seg=api.slice(start,end);
  assert.match(seg,/release:\{/);
  assert.match(seg,/commit:/);
  assert.match(seg,/branch:/);
  assert.match(seg,/environment:/);
  assert.match(seg,/deploymentId:/);
});


test('production smoke workflow checks health routes and stale release without creating deployments',async()=>{
  const yml=await read('.github/workflows/production-smoke.yml');
  assert.match(yml,/deployment_status:/);
  assert.match(yml,/workflow_dispatch:/);
  assert.match(yml,/\/api\/health/);
  for(const route of ['/','/pos','/queue','/stock','/orders','/settings','/close','/backup'])assert.ok(yml.includes(route),route);
  assert.match(yml,/Stale release/);
  assert.match(yml,/release_identity_missing/);
  assert.doesNotMatch(yml,/vercel deploy|create_deployment|deploy --prod/);
});


test('scheduled production smoke fails when production is stale behind default-branch main',async()=>{
  const yml=await read('.github/workflows/production-smoke.yml');
  assert.match(yml,/schedule:/);
  assert.ok(yml.includes("cron: '17 * * * *'"));
  assert.match(yml,/github\.event_name == 'schedule'/);
  assert.match(yml,/EXPECTED_SHA: .*deployment_status.*deployment\.sha.*github\.event_name == 'schedule'.*github\.sha/);
  assert.match(yml,/Stale release: expected SHA/);
  assert.doesNotMatch(yml,/vercel deploy|create_deployment|deploy --prod/);
});


test('runtime health guard probes repeatedly and enforces security and latency budgets',async()=>{
  const yml=await read('.github/workflows/production-smoke.yml');
  assert.match(yml,/for attempt in 1 2 3/);
  assert.match(yml,/strict-transport-security/);
  assert.match(yml,/x-content-type-options/);
  assert.match(yml,/x-frame-options/);
  assert.match(yml,/content-security-policy/);
  assert.match(yml,/health_latency_budget_exceeded/);
  assert.match(yml,/max>5/);
  assert.match(yml,/release_context_missing/);
});


test('Next route health fast path exposes the same release identity contract',async()=>{
  const route=await read('app/api/[...route]/route.js');
  const health=route.slice(route.indexOf('if(routePath==="/api/health"'),route.indexOf('if(routePath==="/api/build"'));
  for(const field of ['VERCEL_GIT_COMMIT_SHA','VERCEL_GIT_COMMIT_REF','VERCEL_ENV','VERCEL_DEPLOYMENT_ID','commit','branch','environment','deploymentId']) assert.match(health,new RegExp(field));
  assert.match(health,/Response\.json\(\{ok:true,storage:"turso",release\}/);
});


test('Vercel production deploys are gated by an explicit release marker change',async()=>{
  const raw=await read('vercel.json');
  const config=JSON.parse(raw);
  assert.match(config.ignoreCommand,/VERCEL_GIT_COMMIT_REF/);
  assert.match(config.ignoreCommand,/main/);
  assert.match(config.ignoreCommand,/\.vercel-release/);
  assert.match(config.ignoreCommand,/git diff --quiet HEAD\^ HEAD/);
  assert.doesNotMatch(config.ignoreCommand,/force|deploy --prod/);
});


test('deployment-status smoke uses the public production alias instead of protected deployment URLs',async()=>{
  const yml=await read('.github/workflows/production-smoke.yml');
  assert.match(yml,/BASE_URL: .*https:\/\/field-pos\.vercel\.app/);
  assert.doesNotMatch(yml,/deployment_status\.environment_url/);
});


test('production keeps the proven Vercel routing path while pinning Node 24',async()=>{
  const pkg=JSON.parse(await read('package.json'));
  const lock=JSON.parse(await read('package-lock.json'));
  const vercel=JSON.parse(await read('vercel.json'));
  const route=await read('app/api/[...route]/route.js');
  assert.equal(pkg.engines?.node,'24.x');
  assert.equal(lock.packages?.['']?.engines?.node,'24.x');
  assert.deepEqual(vercel.builds,[{src:'package.json',use:'@vercel/next'}]);
  assert.equal(Object.prototype.hasOwnProperty.call(vercel,'regions'),false);
  assert.match(route,/preferredRegion="sin1"/);
});


test('cashier-flow QA measures the guided checkout without weakening durable cash identity',async()=>{
  const qa=await read('scripts/qa-cashier-flow.py');
  assert.match(qa,/menu → modifier → cart → payment → queue\/pager\/change|Cashier-flow metrics browser QA/);
  assert.match(qa,/pos\/checkout/);
  assert.match(qa,/requestKey/);
  assert.match(qa,/checkoutRequests/);
  assert.match(qa,/uiInteractions/);
  assert.match(qa,/automationElapsedMs/);
  assert.match(qa,/not a human training-time claim/);
  assert.match(qa,/payment\"\]==\"cash\"/);
  assert.match(qa,/received\"\]==100/);
  assert.doesNotMatch(qa,/field-pos\.vercel\.app/);
});
