import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClient} from '@libsql/client';
import {SCHEMA} from '../lib/schema.mjs';
import {checkoutPos,startSplitPayment,paySplitPayment} from '../lib/pos-api.mjs';
import {createApi} from '../lib/api.mjs';
import {digest} from '../lib/security.mjs';
import {bangkokDate} from '../lib/time.mjs';
import {buildFullBackup,validateFullBackup,FULL_BACKUP_TABLES} from '../lib/full-backup.mjs';
const user={id:'owner',role:'admin',permissions:{}};
const cart=[{id:'latte',variant:'100%',qty:2}];
async function setup(t){
  const dir=await mkdtemp(join(tmpdir(),'field-payment-integrity-'));
  const db=createClient({url:'file:'+join(dir,'test.db')});t.after(()=>db.close());
  await db.batch(SCHEMA,'write');
  await db.execute("INSERT INTO field_users(id,username,password_hash,role,created_at,updated_at) VALUES('owner','owner','unused','admin',0,0)");
  const doc={menu:[{id:'latte',enabled:true,price:55,name:'Latte',variants:[{label:'100%',recipe:{items:{matcha:5}}}]}],ingredients:{matcha:{qty:1000,unitCost:2}},settings:{pagerCount:10},sales:[],orders:[],billSeq:{},cashShifts:[{id:'shift',date:bangkokDate(),status:'open',openingCash:100,openedAt:1,openedBy:'owner'}]};
  await db.execute({sql:'UPDATE field_state SET document=? WHERE singleton=1',args:[JSON.stringify(doc)]});
  await db.execute({sql:'INSERT INTO field_sessions VALUES(?,?,?,?)',args:[digest('token'),user.id,'csrf',Date.now()+60000]});
  return db;
}
async function post(api,route,body){const res={writeHead(status){this.status=status},end(raw){this.body=JSON.parse(raw)}};await api({method:'POST',query:{route},headers:{origin:'https://field.test',cookie:'field_session=token','x-csrf-token':'csrf'},body},res);return res}
const metadata=(reference,charge='chrg_paid')=>({paymentReference:charge,paymentVerified:charge,paymentProviderAmount:55,paymentProvider:'opn',paymentProviderCurrency:'THB',paymentProviderReference:reference});
test('HTTP split pay replays a committed cash payment after a lost response',async t=>{
  const db=await setup(t),api=createApi({db,origin:'https://field.test'});
  const started=await post(api,['pos','split','start'],{requestKey:'start-retry',cart,date:bangkokDate()});
  const body={requestKey:'pay-retry-key',sessionId:started.body.session.id,method:'cash',received:200,allocations:[{index:0,qty:2}]};
  const first=await post(api,['pos','split','pay'],body),retry=await post(api,['pos','split','pay'],body);
  assert.equal(first.status,200);assert.equal(retry.status,200);assert.equal(retry.body.replayed,true);assert.equal(retry.body.saleId,first.body.saleId);
});
test('split charge is consumed once across fresh request keys, retaining committed replay',async t=>{
  const db=await setup(t),s=await startSplitPayment({db,user,body:{requestKey:'start-consume',cart,date:bangkokDate()}});
  const body={requestKey:'consume-pay-one',sessionId:s.session.id,method:'promptpay',allocations:[{index:0,qty:1}],...metadata(s.session.id)};
  await paySplitPayment({db,user,body});
  await assert.rejects(paySplitPayment({db,user,body:{...body,requestKey:'consume-pay-two'}}),/promptpay_charge_already_used/);
  assert.equal((await paySplitPayment({db,user,body})).replayed,true);
  const state=JSON.parse((await db.execute('SELECT document FROM field_state')).rows[0].document);
  assert.equal(state.paymentSessions[0].payments.length,1);
});
test('direct QR rejects wrong intended reference and currency before creating a sale',async t=>{
  const db=await setup(t),body={requestKey:'direct-qr-key',cart:[{...cart[0],qty:1}],date:bangkokDate(),payment:'promptpay',...metadata('another-request')};
  await assert.rejects(checkoutPos({db,user,body}),/promptpay_reference_mismatch/);
  await assert.rejects(checkoutPos({db,user,body:{...body,paymentProviderReference:body.requestKey,paymentProviderCurrency:'USD'}}),/promptpay_currency_mismatch/);
  const state=JSON.parse((await db.execute('SELECT document FROM field_state')).rows[0].document);assert.equal(state.sales.length,0);assert.equal(state.ingredients.matcha.qty,1000);
});

test('HTTP provider metadata overrides client claims and committed QR retry skips provider lookup',async t=>{
  const originalFetch=globalThis.fetch,originalProvider=process.env.PROMPTPAY_PROVIDER,originalKey=process.env.OMISE_SECRET_KEY;
  t.after(()=>{globalThis.fetch=originalFetch;for(const [k,v] of [['PROMPTPAY_PROVIDER',originalProvider],['OMISE_SECRET_KEY',originalKey]]){if(v===undefined)delete process.env[k];else process.env[k]=v}});
  process.env.PROMPTPAY_PROVIDER='opn';process.env.OMISE_SECRET_KEY='skey_test_fixture';
  const db=await setup(t),api=createApi({db,origin:'https://field.test'});
  const s=await startSplitPayment({db,user,body:{requestKey:'http-qr-start',cart:[{...cart[0],qty:1}],date:bangkokDate(),mode:'promptpay_full'}});
  let reference=s.session.id,lookups=0;
  globalThis.fetch=async()=>{lookups++;return new Response(JSON.stringify({id:'chrg_http',status:'successful',paid:true,amount:5500,currency:'THB',metadata:{field_reference:reference}}),{status:200})};
  const body={requestKey:'http-qr-paid-key',sessionId:s.session.id,method:'promptpay',allocations:[{index:0,qty:1}],...metadata(s.session.id,'chrg_http')};
  reference='wrong-session';const rejected=await post(api,['pos','split','pay'],body);assert.equal(rejected.status,409);assert.equal(rejected.body.error,'promptpay_reference_mismatch');
  reference=s.session.id;const paid=await post(api,['pos','split','pay'],body);assert.equal(paid.status,200);assert.equal(paid.body.completed,true);
  const before=lookups;globalThis.fetch=async()=>{throw new Error('provider should not be called for committed replay')};
  const retry=await post(api,['pos','split','pay'],body);assert.equal(retry.status,200);assert.equal(retry.body.replayed,true);assert.equal(lookups,before);
  const stateRow=(await db.execute('SELECT * FROM field_state')).rows[0],tables={};
  for(const [key,table] of Object.entries(FULL_BACKUP_TABLES))tables[key]=(await db.execute('SELECT * FROM '+table)).rows;
  const backup=validateFullBackup(buildFullBackup({stateRow,tables}));
  assert.equal(backup.tables.posRequests.filter(r=>r.request_key.startsWith('payment-charge:')).length,1);
  const restored=await post(api,['admin','backup','restore'],{requestKey:'restore-payment-proof',confirm:true,expectedRevision:Number(stateRow.revision),backup,backupFingerprint:digest(JSON.stringify(backup))});
  assert.equal(restored.status,200);
  assert.equal((await post(api,['pos','split','pay'],body)).body.replayed,true);
  assert.equal((await db.execute("SELECT * FROM field_pos_requests WHERE request_key LIKE 'payment-charge:%'")).rows.length,1);
});

test('concurrent fresh keys consume a partial split charge only once',async t=>{
  const db=await setup(t),s=await startSplitPayment({db,user,body:{requestKey:'race-qr-start',cart,date:bangkokDate()}});
  const body={sessionId:s.session.id,method:'promptpay',allocations:[{index:0,qty:1}],...metadata(s.session.id)};
  const results=await Promise.allSettled(['race-qr-one','race-qr-two'].map(requestKey=>paySplitPayment({db,user,body:{...body,requestKey}})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.message,'promptpay_charge_already_used');
});

test('a failed sale rolls back charge consumption and a later exact retry can commit',async t=>{
  const db=await setup(t),requestKey='atomic-qr-key';
  await db.execute("CREATE TRIGGER reject_snapshot BEFORE INSERT ON field_cost_snapshots BEGIN SELECT RAISE(ABORT,'test_snapshot_failure'); END");
  const body={requestKey,cart:[{...cart[0],qty:1}],date:bangkokDate(),payment:'promptpay',...metadata(requestKey)};
  await assert.rejects(checkoutPos({db,user,body}),/test_snapshot_failure/);
  assert.equal((await db.execute("SELECT * FROM field_pos_requests WHERE request_key LIKE 'payment-charge:%'")).rows.length,0);
  await db.execute('DROP TRIGGER reject_snapshot');
  assert.equal((await checkoutPos({db,user,body})).replayed,false);
});

test('pre-migration paid charge evidence blocks reuse without a consumption row',async t=>{
  const db=await setup(t),requestKey='historical-qr-key';
  const row=(await db.execute('SELECT document FROM field_state')).rows[0],doc=JSON.parse(row.document);
  doc.sales=[{id:'historical',payment:'promptpay',paymentReference:'chrg_paid',status:'refunded'}];
  await db.execute({sql:'UPDATE field_state SET document=? WHERE singleton=1',args:[JSON.stringify(doc)]});
  await assert.rejects(checkoutPos({db,user,body:{requestKey,cart:[{...cart[0],qty:1}],date:bangkokDate(),payment:'promptpay',...metadata(requestKey)}}),/promptpay_charge_already_used/);
});

test('restoring a pre-payment backup cannot make a consumed QR reusable',async t=>{
  const db=await setup(t),api=createApi({db,origin:'https://field.test'});
  const s=await startSplitPayment({db,user,body:{requestKey:'old-backup-start',cart,date:bangkokDate()}});
  const stateRow=(await db.execute('SELECT * FROM field_state')).rows[0],tables={};
  for(const [key,table] of Object.entries(FULL_BACKUP_TABLES))tables[key]=(await db.execute('SELECT * FROM '+table)).rows;
  const backup=validateFullBackup(buildFullBackup({stateRow,tables}));
  const body={requestKey:'old-backup-pay-one',sessionId:s.session.id,method:'promptpay',allocations:[{index:0,qty:1}],...metadata(s.session.id)};
  await paySplitPayment({db,user,body});
  const current=(await db.execute('SELECT revision FROM field_state')).rows[0];
  const restored=await post(api,['admin','backup','restore'],{requestKey:'restore-pre-payment',confirm:true,expectedRevision:Number(current.revision),backup,backupFingerprint:digest(JSON.stringify(backup))});
  assert.equal(restored.status,200);
  await assert.rejects(paySplitPayment({db,user,body:{...body,requestKey:'old-backup-pay-two'}}),/promptpay_charge_already_used/);
});
