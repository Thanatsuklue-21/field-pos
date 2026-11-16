import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClient} from '@libsql/client';
import {SCHEMA} from '../lib/schema.mjs';
import {startSplitPayment,checkoutPos} from '../lib/pos-api.mjs';
import {buildPromptPayPayload as sharedPayload} from '../lib/promptpay-payload.mjs';
import {createApi} from '../lib/api.mjs';
import {digest} from '../lib/security.mjs';
import {bangkokDate} from '../lib/time.mjs';
import {
  buildPromptPayPayload,normalizePromptPayId,parseBankNotification,toSatang,
  createDirectPromptPayCharge,receiveBankNotification,directPromptPayConfig,DIRECT_QR_TTL_MS
} from '../lib/payment-promptpay-direct.mjs';

const SECRET='test-secret-0123456789-abcdefghijklmnop';
const user={id:'owner',role:'admin',permissions:{}};

function withEnv(t,vars){
  const saved={};
  for(const [k,v] of Object.entries(vars)){saved[k]=process.env[k];if(v===undefined)delete process.env[k];else process.env[k]=v}
  t.after(()=>{for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v}});
}
async function setup(t){
  const dir=await mkdtemp(join(tmpdir(),'field-pp-offline-'));
  const db=createClient({url:'file:'+join(dir,'test.db')});t.after(()=>db.close());
  await db.batch(SCHEMA,'write');
  await db.execute("INSERT INTO field_users(id,username,password_hash,role,created_at,updated_at) VALUES('owner','owner','unused','admin',0,0)");
  const doc={menu:[{id:'latte',enabled:true,price:55,name:'Latte',variants:[{label:'100%',recipe:{items:{matcha:5}}}]}],ingredients:{matcha:{qty:1000,unitCost:2}},settings:{pagerCount:10},sales:[],orders:[],billSeq:{},cashShifts:[{id:'shift',date:bangkokDate(),status:'open',openingCash:100,openedAt:1,openedBy:'owner'}]};
  await db.execute({sql:'UPDATE field_state SET document=? WHERE singleton=1',args:[JSON.stringify(doc)]});
  await db.execute({sql:'INSERT INTO field_sessions VALUES(?,?,?,?)',args:[digest('token'),user.id,'csrf',Date.now()+60000]});
  return db;
}
async function call(api,route,body,{session=true,headers={}}={}){
  const res={writeHead(status){this.status=status},end(raw){this.body=JSON.parse(raw)}};
  const h=session?{origin:'https://field.test',cookie:'field_session=token','x-csrf-token':'csrf',...headers}:{...headers};
  await api({method:'POST',query:{route},headers:h,body,rawBody:JSON.stringify(body)},res);return res;
}
const state=async db=>JSON.parse((await db.execute('SELECT document FROM field_state')).rows[0].document);


// Owner-approved 2026-11-16: offline PromptPay is recorded unverified and only
// becomes verified by exactly one unconsumed incoming bank notification.
const KRUNGSRI_IN=amt=>`เงินเข้าบัญชี xxx1234 จำนวน ${amt} บาท จาก นาย ทดสอบ`;
function offlineBody(key,createdAt,extra={}){
  return {requestKey:key,date:bangkokDate(),cart:[{id:'latte',variant:'100%',qty:1}],payment:'promptpay',received:55,total:55,
    customerId:null,pointsRedeemed:0,checkoutMode:'full',offlineFulfilled:true,offlinePromptPay:true,offlineCreatedAt:createdAt,offlineMenuRevision:0,...extra};
}

test('browser and server build the identical PromptPay QR payload',()=>{
  assert.equal(sharedPayload('0826119798',5500),buildPromptPayPayload('0826119798',5500));
  assert.equal(sharedPayload('081-234-5678',5500),'00020101021229370016A000000677010111011300668123456785303764540555.005802TH6304D753');
});

test('config exposes the public receiving number for local QR only when the id is valid',t=>{
  withEnv(t,{PROMPTPAY_DIRECT_ID:'082-611-9798',BANK_NOTIFY_SECRET:SECRET});
  assert.equal(directPromptPayConfig().offlineQrId,'0826119798');
  withEnv(t,{PROMPTPAY_DIRECT_ID:'bad'});
  assert.equal(directPromptPayConfig().offlineQrId,null);
});

test('offline PromptPay without a bank notification syncs as UNVERIFIED, never verified',async t=>{
  const db=await setup(t);const now=Date.now();
  const r=await checkoutPos({db,user,now,body:offlineBody('offline-pp-none-0001',now-60_000)});
  assert.equal(r.ok,true);assert.equal(r.offlineFulfilled,true);assert.equal(r.offlinePromptPay,'unverified');
  assert.equal(r.pager,0);assert.equal(r.total,55);assert.equal(r.received,55);assert.equal(r.change,0);
  const sale=(await state(db)).sales[0];
  assert.equal(sale.payment,'promptpay');assert.equal(sale.paymentVerified,false);
  assert.equal(sale.payments[0].paymentVerified,'offline_unverified');
});

test('offline PromptPay is matched to exactly one earlier unmatched incoming notification and consumes it once',async t=>{
  withEnv(t,{PROMPTPAY_DIRECT_ID:'0826119798',BANK_NOTIFY_SECRET:SECRET});
  const db=await setup(t);const now=Date.now();
  const n=await receiveBankNotification({body:{text:KRUNGSRI_IN('55.00')},headers:{'x-field-bank-key':SECRET}},{db,now:now-120_000});
  assert.equal(n.status,'unmatched');
  const r=await checkoutPos({db,user,now,body:offlineBody('offline-pp-match-0001',now-90_000)});
  assert.equal(r.offlinePromptPay,'matched');
  const sale=(await state(db)).sales[0];
  assert.equal(sale.paymentVerified,true);assert.equal(sale.payments[0].paymentVerified,'bank_notification_offline');
  const row=(await db.execute('SELECT status,matched_charge_id FROM field_bank_notifications')).rows[0];
  assert.equal(row.status,'matched_offline');assert.equal(row.matched_charge_id,'offline:'+sale.id);
  // A second offline bill of the same amount cannot reuse that notification.
  const r2=await checkoutPos({db,user,now,body:offlineBody('offline-pp-match-0002',now-80_000)});
  assert.equal(r2.offlinePromptPay,'unverified');
});

test('wrong amount, outside the time window, or two candidates never verify an offline PromptPay bill',async t=>{
  withEnv(t,{PROMPTPAY_DIRECT_ID:'0826119798',BANK_NOTIFY_SECRET:SECRET});
  const db=await setup(t);const now=Date.now();const key={'x-field-bank-key':SECRET};
  await receiveBankNotification({body:{text:KRUNGSRI_IN('60.00')}, headers:key},{db,now:now-60_000});
  await receiveBankNotification({body:{text:KRUNGSRI_IN('55.00')+' a'},headers:key},{db,now:now-60*60_000});
  let r=await checkoutPos({db,user,now,body:offlineBody('offline-pp-miss-0001',now-30_000)});
  assert.equal(r.offlinePromptPay,'unverified');
  await receiveBankNotification({body:{text:KRUNGSRI_IN('55.00')+' b'},headers:key},{db,now:now-20_000});
  await receiveBankNotification({body:{text:KRUNGSRI_IN('55.00')+' c'},headers:key},{db,now:now-10_000});
  r=await checkoutPos({db,user,now,body:offlineBody('offline-pp-miss-0002',now-15_000)});
  assert.equal(r.offlinePromptPay,'ambiguous');
  assert.equal((await state(db)).sales.every(s=>s.paymentVerified===false),true);
});

test('offline sync rejects other non-cash tenders and PromptPay without the explicit offline flag',async t=>{
  const db=await setup(t);const now=Date.now();
  await assert.rejects(checkoutPos({db,user,now,body:offlineBody('offline-pp-flag-0001',now-1000,{offlinePromptPay:false})}),/offline_cash_only/);
  await assert.rejects(checkoutPos({db,user,now,body:offlineBody('offline-pp-card-0001',now-1000,{payment:'card'})}),/offline_cash_only/);
});

test('offline PromptPay replay returns the committed result without a second sale',async t=>{
  const db=await setup(t);const now=Date.now();const body=offlineBody('offline-pp-replay-0001',now-1000);
  const a=await checkoutPos({db,user,now,body});const b=await checkoutPos({db,user,now:now+5,body});
  assert.equal(b.replayed,true);assert.equal(b.orderId,a.orderId);
  assert.equal((await state(db)).sales.length,1);
});

test('bank-notifications endpoint lists offline PromptPay bills and counts the unverified ones',async t=>{
  withEnv(t,{PROMPTPAY_DIRECT_ID:'0826119798',BANK_NOTIFY_SECRET:SECRET,PUBLIC_ORIGIN:'https://field.test'});
  const db=await setup(t);const now=Date.now();
  await checkoutPos({db,user,now,body:offlineBody('offline-pp-list-0001',now-1000)});
  const api=createApi({db});
  const res={writeHead(status){this.status=status},end(raw){this.body=JSON.parse(raw)}};
  await api({method:'GET',query:{route:'payments/bank-notifications'},headers:{origin:'https://field.test',cookie:'field_session=token'}},res);
  assert.equal(res.status,200,JSON.stringify(res.body));
  assert.equal(res.body.offlinePromptPayUnverified,1);
  assert.equal(res.body.offlinePromptPay[0].verification,'unverified');
});
