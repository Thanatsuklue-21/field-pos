import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const load=()=>import('../lib/work-modes.mjs');
const staff=permissions=>({role:'staff',permissions});
test('front/back routes match staff capabilities and safe landing pages',async()=>{
 const {canAccessRoute,defaultWorkRoute,workModeForPath}=await load();
 assert.equal(defaultWorkRoute(staff({queue:true}),'front'),'/queue');
 assert.equal(defaultWorkRoute(staff({order:true}),'front'),'/pos');
 assert.equal(defaultWorkRoute(staff({order:true}),'back'),null);
 assert.equal(defaultWorkRoute(staff({order:true,stock:true}),'back'),'/stock');
 assert.equal(defaultWorkRoute(staff({order:true,report:true}),'back'),'/dashboard');
 assert.equal(canAccessRoute(staff({queue:true}),'/pos'),false);
 assert.equal(canAccessRoute(staff({order:true}),'/queue'),false);
 assert.equal(canAccessRoute(staff({order:true,report:true}),'/users'),false);
 assert.equal(canAccessRoute(staff({order:true}),'/reports'),false);
 assert.equal(canAccessRoute(staff({order:true}),'/settings'),true);
 assert.equal(canAccessRoute(null,'/pos'),false);
 assert.equal(canAccessRoute(staff({order:true}),'/stock/nested'),false);
 assert.equal(workModeForPath('/close'),'back');
 assert.equal(workModeForPath('/queue'),'front');
});
test('staff presets use only existing backend permission keys and retain a front task',async()=>{
 const {STAFF_PRESETS,PERMISSION_INFO}=await load();
 for(const preset of STAFF_PRESETS){
  assert.deepEqual(Object.keys(preset.permissions).sort(),['order','queue','report','stock']);
  assert.ok(preset.permissions.order||preset.permissions.queue);
  assert.ok(preset.label.length>0&&preset.description.length>0);
 }
 assert.ok(PERMISSION_INFO.report.description.includes('ปิดยอด'));
});
test('tablet sidebar gives every navigation link a name and keeps text visible',async()=>{
 const shell=await readFile('components/app-shell.tsx','utf8');
 assert.ok(shell.includes('aria-label={t[key]}'));
 assert.ok(shell.includes('โหมดหน้าร้าน'));
 assert.ok(shell.includes('โหมดหลังร้าน'));
 assert.ok(!shell.includes('hidden xl:block">{t[key]}'));
});
test('auth gate checks route access before mounting protected views',async()=>{
 const gate=await readFile('components/auth-gate.tsx','utf8');
 assert.ok(gate.includes('canAccessRoute(session.user,path)'));
 assert.ok(gate.includes('หน้านี้ไม่อยู่ในสิทธิ์ของคุณ'));
 assert.ok(gate.includes('defaultWorkRoute(session.user,"front")'));
});

test('network status never blocks mode controls and uses accurate offline guidance',async()=>{
 const source=await readFile('components/network-status.tsx','utf8');
 assert.ok(source.includes('pointer-events-none'));
 assert.ok(!source.includes('SALES WRITES PAUSED'));
});

test('all staff presets follow the existing server permission vocabulary for every registered route',async()=>{
 const {ROUTE_ACCESS,STAFF_PRESETS,canAccessRoute}=await load();
 const {mayView,normalizePermissions}=await import('../lib/security.mjs');
 for(const preset of STAFF_PRESETS){
  const user={role:'staff',active:true,permissions:normalizePermissions(preset.permissions)};
  for(const [route,permission] of Object.entries(ROUTE_ACCESS))assert.equal(canAccessRoute(user,route),permission==='any'||!!mayView(user,permission),preset.id+' '+route);
 }
 for(const route of Object.keys(ROUTE_ACCESS))assert.equal(canAccessRoute({role:'admin'},route),true,route);
});
