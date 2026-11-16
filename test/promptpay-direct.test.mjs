import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClient} from '@libsql/client';
import {SCHEMA} from '../lib/schema.mjs';
import {startSplitPayment} from '../lib/pos-api.mjs';
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
  const dir=await mkdtemp(join(tmpdir(),'field-pp-direct-'));
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

// ---------- QR payload ----------
test('PromptPay payload matches the reference EMVCo/CRC-16 output and locks the amount',()=>{
  // Golden value computed independently (CRC-16/CCITT-FALSE, check value 29B1).
  assert.equal(buildPromptPayPayload('081-234-5678',5500),'00020101021229370016A000000677010111011300668123456785303764540555.005802TH6304D753');
  assert.match(buildPromptPayPayload('0812345678',6525),/540565\.255802TH6304[0-9A-F]{4}$/);
  assert.match(buildPromptPayPayload('1234567890123',100),/0213123456789012353037645404\d\.\d{2}/);
});

test('invalid PromptPay id or amount fails closed instead of producing an open-amount QR',()=>{
  for(const id of ['08123456789','12345','','0212345678'])assert.throws(()=>buildPromptPayPayload(id,5500),/promptpay_direct_id_invalid/);
  for(const s of [0,-1,1.5,NaN,15_000_001])assert.throws(()=>buildPromptPayPayload('0812345678',s),/promptpay_amount_out_of_range/);
  assert.throws(()=>toSatang('abc'),/promptpay_amount_out_of_range/);
  assert.throws(()=>toSatang(55.555),/promptpay_amount_out_of_range/);
  assert.equal(toSatang(0.1+0.2),30);
  assert.deepEqual(normalizePromptPayId('081 234 5678'),{type:'phone',value:'0812345678'});
});

// ---------- notification parser ----------
test('incoming transfer amount is extracted; balance and outgoing are never used',()=>{
  const cases=[
    ['เงินเข้าบัญชี xxx1234 จำนวน 55.00 บาท คงเหลือ 12,345.67 บาท',55],
    ['คงเหลือ 9,999.00 บาท · รับโอนเงิน 65.25 บ. จาก นาย ก',65.25],
    ['Krungsri: ได้รับเงิน 1,250.50 THB เวลา 08:31',1250.5],
    ['Deposit THB 90.00 to acct x1234. Avail bal THB 5,000.00',90],
  ];
  for(const [text,amount] of cases)assert.deepEqual(parseBankNotification(text),{direction:'in',amount},text);
  assert.equal(parseBankNotification('โอนเงินออก 55.00 บาท ไปยัง ...').direction,'out');
  assert.equal(parseBankNotification('ชำระบิล 55.00 บาท').direction,'out');
  assert.deepEqual(parseBankNotification('ยอดคงเหลือ 55.00 บาท'),{direction:'unknown',amount:null});
  assert.deepEqual(parseBankNotification('เงินเข้า คงเหลือ 120.00 บาท'),{direction:'in',amount:null});
  assert.deepEqual(parseBankNotification('เงินเข้า 55 บาท'),{direction:'in',amount:null},'amount without satang is not trusted');
  assert.deepEqual(parseBankNotification(''),{direction:'unknown',amount:null});
});

test('config requires a valid PromptPay id and a long notification secret',t=>{
  withEnv(t,{PROMPTPAY_DIRECT_ID:'0812345678',BANK_NOTIFY_SECRET:'short'});
  assert.deepEqual(directPromptPayConfig().missing,['BANK_NOTIFY_SECRET']);
  process.env.BANK_NOTIFY_SECRET=SECRET;
  assert.equal(directPromptPayConfig().ready,true);
  assert.equal(directPromptPayConfig().mode,'live');
});

// ---------- matching rules (module level, controlled clock) ----------
test('matching: one pending QR per amount, window, single use, unknown/ambiguous never auto-pay',async t=>{
  withEnv(t,{PROMPTPAY_DIRECT_ID:'0812345678',BANK_NOTIFY_SECRET:SECRET});
  const db=await setup(t),h={'x-field-bank-key':SECRET};
  const a=await createDirectPromptPayCharge({amount:55,reference:'ref-a'},{db,now:1000});
  assert.equal(a.status,'pending');assert.match(a.qrUrl,/^data:image\/svg\+xml;base64,/);
  // Same reference is idempotent; same amount for another bill is refused.
  assert.equal((await createDirectPromptPayCharge({amount:55,reference:'ref-a'},{db,now:1100})).chargeId,a.chargeId);
  await assert.rejects(createDirectPromptPayCharge({amount:55,reference:'ref-b'},{db,now:1200}),/promptpay_direct_amount_in_use/);
  // Wrong amount → unmatched, QR still pending.
  let r=await receiveBankNotification({body:{text:'เงินเข้า 56.00 บาท'},headers:h},{db,now:2000});
  assert.equal(r.status,'unmatched');
  // Outgoing → ignored.
  r=await receiveBankNotification({body:{text:'โอนเงินออก 55.00 บาท'},headers:h},{db,now:2100});
  assert.equal(r.status,'ignored');
  // Correct → matched once; exact duplicate within window → duplicate, no second credit.
  r=await receiveBankNotification({body:{text:'เงินเข้า 55.00 บาท เวลา 08:31'},headers:h},{db,now:3000});
  assert.equal(r.status,'matched');assert.equal(r.chargeId,a.chargeId);assert.equal(r.referenceId,'ref-a');
  r=await receiveBankNotification({body:{text:'เงินเข้า  55.00 บาท เวลา 08:31'},headers:h},{db,now:3500});
  assert.equal(r.duplicate,true);
  // A different 55.00 transfer with no pending QR stays unmatched for review.
  r=await receiveBankNotification({body:{text:'เงินเข้า 55.00 บาท เวลา 08:40'},headers:h},{db,now:4000});
  assert.equal(r.status,'unmatched');
  // Expired QR never matches.
  const b=await createDirectPromptPayCharge({amount:70,reference:'ref-c'},{db,now:5000});
  r=await receiveBankNotification({body:{text:'เงินเข้า 70.00 บาท'},headers:h},{db,now:5000+DIRECT_QR_TTL_MS+1});
  assert.equal(r.status,'unmatched');
  const row=(await db.execute({sql:'SELECT status FROM field_promptpay_direct WHERE id=?',args:[b.chargeId]})).rows[0];
  assert.equal(row.status,'pending');
  // Raw text (payer names) is never persisted.
  const cols=(await db.execute('PRAGMA table_info(field_bank_notifications)')).rows.map(x=>String(x.name));
  assert.ok(!cols.includes('text')&&!cols.includes('raw_text'));
  await assert.rejects(receiveBankNotification({body:{text:'เงินเข้า 55.00 บาท'},headers:{'x-field-bank-key':'wrong'}},{db,now:6000}),/invalid_bank_notification_key/);
});

// ---------- end-to-end through the HTTP API ----------
test('HTTP: QR → MacroDroid notification finalises the sale once; no key / no origin rules',async t=>{
  withEnv(t,{PROMPTPAY_PROVIDER:'direct',PROMPTPAY_DIRECT_ID:'0812345678',BANK_NOTIFY_SECRET:SECRET,PUBLIC_ORIGIN:'https://field.test',VERCEL_ENV:'production'});
  const db=await setup(t),api=createApi({db,origin:'https://field.test'});
  const s=await startSplitPayment({db,user,body:{requestKey:'pp-start',cart:[{id:'latte',variant:'100%',qty:1}],date:bangkokDate(),mode:'promptpay_full'}});
  const created=await call(api,['payments','promptpay','create'],{reference:s.session.id});
  assert.equal(created.status,200,JSON.stringify(created.body));assert.equal(created.body.provider,'direct');assert.equal(created.body.amount,55);
  // No key → 401, nothing paid.
  let n=await call(api,['payments','bank-notification'],{text:'เงินเข้า 55.00 บาท'},{session:false});
  assert.equal(n.status,401);
  n=await call(api,['payments','bank-notification'],{text:'เงินเข้า 55.00 บาท'},{session:false,headers:{'x-field-bank-key':SECRET}});
  assert.equal(n.status,200);assert.equal(n.body.finalized,true);
  let doc=await state(db);assert.equal(doc.sales.length,1);assert.equal(doc.sales[0].payment,'promptpay');assert.equal(doc.ingredients.matcha.qty,995);
  // MacroDroid retry of the same notification never creates a second sale.
  n=await call(api,['payments','bank-notification'],{text:'เงินเข้า 55.00 บาท'},{session:false,headers:{'x-field-bank-key':SECRET}});
  assert.equal(n.status,200);doc=await state(db);assert.equal(doc.sales.length,1);
  const status=await call(api,['payments','promptpay','status'],{chargeId:created.body.chargeId});
  assert.equal(status.body.paid,true);assert.equal(status.body.confirmMode,'notification');
});

test('HTTP: manual confirm fallback and operator release of an unpaid QR',async t=>{
  withEnv(t,{PROMPTPAY_PROVIDER:'direct',PROMPTPAY_DIRECT_ID:'0812345678',BANK_NOTIFY_SECRET:SECRET,PUBLIC_ORIGIN:'https://field.test'});
  const db=await setup(t),api=createApi({db,origin:'https://field.test'});
  // Release: pending direct QR is cancelled by the operator and the session is released.
  const s1=await startSplitPayment({db,user,body:{requestKey:'pp-release-1',cart:[{id:'latte',variant:'100%',qty:1}],date:bangkokDate(),mode:'promptpay_full'}});
  const c1=await call(api,['payments','promptpay','create'],{reference:s1.session.id});
  const rel=await call(api,['pos','split','provider-release'],{requestKey:crypto.randomUUID(),sessionId:s1.session.id,paymentReference:c1.body.chargeId});
  assert.equal(rel.status,200,JSON.stringify(rel.body));
  const st1=await call(api,['payments','promptpay','status'],{chargeId:c1.body.chargeId});assert.equal(st1.body.status,'cancelled');
  // A late transfer for the cancelled QR stays unmatched (review at close), no sale.
  const late=await call(api,['payments','bank-notification'],{text:'เงินเข้า 55.00 บาท ก'},{session:false,headers:{'x-field-bank-key':SECRET}});
  assert.equal(late.body.status,'unmatched');assert.equal((await state(db)).sales.length,0);
  // Manual confirm then normal split pay finalises; audit row records the actor.
  const s2=await startSplitPayment({db,user,body:{requestKey:'pp-manual-1',cart:[{id:'latte',variant:'100%',qty:1}],date:bangkokDate(),mode:'promptpay_full'}});
  const c2=await call(api,['payments','promptpay','create'],{reference:s2.session.id});
  const conf=await call(api,['payments','promptpay','direct','confirm'],{chargeId:c2.body.chargeId});
  assert.equal(conf.status,200);assert.equal(conf.body.paid,true);assert.equal(conf.body.confirmMode,'manual');
  const pay=await call(api,['pos','split','pay'],{requestKey:crypto.randomUUID(),sessionId:s2.session.id,method:'promptpay',allocations:[{index:0,qty:1}],paymentReference:c2.body.chargeId});
  assert.equal(pay.status,200,JSON.stringify(pay.body));assert.equal(pay.body.completed,true);
  const audit=(await db.execute("SELECT actor_id FROM field_audit WHERE action='promptpay_direct_manual_confirm'")).rows;
  assert.equal(audit.length,1);assert.equal(audit[0].actor_id,'owner');
  // The same charge can never pay a second session.
  const again=await call(api,['payments','promptpay','direct','confirm'],{chargeId:c2.body.chargeId});
  assert.equal(again.status,200);assert.equal((await state(db)).sales.length,1);
});

test('POS shows the two-step manual confirm only for pending own-account QR and speaks Thai on transfer',async()=>{
  const pos=await readFile(new URL('../app/pos/page.tsx',import.meta.url),'utf8');
  assert.match(pos,/prompt\.provider==="direct"&&!prompt\.paid&&String\(prompt\.status\|\|""\)==="pending"/);
  assert.match(pos,/data-direct-confirm-yes/);
  assert.match(pos,/u\.lang="th-TH"/);
  assert.match(pos,/if\(opts\.payment==="promptpay"\)announcePayment/);
});

test('bank notification accepts text/plain so quotes in the bank text cannot break delivery',async()=>{
  const route=await readFile(new URL('../app/api/[...route]/route.js',import.meta.url),'utf8');
  assert.match(route,/route\.join\("\/"\)==="payments\/bank-notification"&&!String\(headers\["content-type"\]\|\|""\)\.includes\("json"\)/);
  assert.match(route,/body=\{text:raw\.slice\(0,2000\)\}/);
});
