import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import {createClient} from '@libsql/client';
import {createApi} from '../lib/api.mjs';
import {digest} from '../lib/security.mjs';
import {seedTenCupDatabase} from '../scripts/qa-ten-cup-scenario.mjs';

async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'field-payment-60-')),db=createClient({url:'file:'+join(dir,'qa.db')});
  t.after(async()=>{db.close();try{await rm(dir,{recursive:true,force:true})}catch(e){if(process.platform!=='win32'||e.code!=='EBUSY')throw e}});
  await seedTenCupDatabase(db);
  await db.execute({sql:'INSERT INTO field_sessions VALUES(?,?,?,?)',args:[digest('payment-qa'),'ten-cup-owner','csrf',Date.now()+600000]});
  const handler=createApi({db,origin:'https://field.test'});
  const call=async(route,method='GET',body,expected=200)=>{
    const res={writeHead(status){this.status=status},end(raw){this.body=JSON.parse(raw)}};
    await handler({method,query:{route},headers:{origin:'https://field.test',cookie:'field_session=payment-qa','x-csrf-token':'csrf'},body},res);
    await setImmediate();
    assert.equal(res.status,expected,route+': '+JSON.stringify(res.body));return res.body;
  };
  const saved=Object.fromEntries(['PROMPTPAY_PROVIDER','BEAM_MERCHANT_ID','BEAM_API_KEY','BEAM_ENV','BEAM_WEBHOOK_HMAC_KEY'].map(k=>[k,process.env[k]])),fetch=globalThis.fetch;
  Object.assign(process.env,{PROMPTPAY_PROVIDER:'beam',BEAM_MERCHANT_ID:'qa-only',BEAM_API_KEY:'qa-only',BEAM_ENV:'playground',BEAM_WEBHOOK_HMAC_KEY:Buffer.from('qa-only').toString('base64')});
  t.after(()=>{globalThis.fetch=fetch;for(const [k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v}});
  return {db,call};
}

test('60 isolated API bills: cash/bank/card/Beam fixture reconcile, replay, handoff and close',async t=>{
  const {db,call}=await fixture(t);let checks=0;
  globalThis.fetch=async url=>{assert.match(String(url),/^https:\/\/playground\.api\.beamcheckout\.com\//);checks++;return new Response(JSON.stringify({chargeId:String(url).split('/').at(-1),status:'SUCCEEDED',amount:5500,currency:'THB'}))};
  await call('cash-shift/open','POST',{openingCash:500},201);
  const ids=new Set();
  for(let i=0;i<60;i++){
    const payment=['cash','bank','card','promptpay'][i%4];
    const body={requestKey:'sixty-bill-'+i,cart:[{id:'qa-latte',variant:'100%',qty:1}],payment,received:100,...(payment==='promptpay'?{paymentReference:'ch_sixty_'+i}:{})};
    const receipt=await call('pos/checkout','POST',body);ids.add(receipt.orderId);
    const replay=await call('pos/checkout','POST',body);assert.equal(replay.orderId,receipt.orderId);assert.equal(replay.replayed,true);
    for(const action of ['complete_item','call','return'])await call('pos/queue','POST',{requestKey:`sixty-${i}-${action}`,orderId:receipt.orderId,action,itemIndex:0,expectedReadyQty:0});
  }
  assert.equal(ids.size,60);assert.equal(checks,15,'committed QR retries do not call provider again');
  const {close}=await call('close-day','POST',{countedCash:1325},201);
  assert.equal(close.revenue,3300);assert.equal(close.cups,60);assert.equal(close.orders,60);assert.equal(close.cashVariance,0);
  for(const channel of ['cash','bank','card','promptpay'])assert.equal(close[channel],825);
  const report=await call('reports/accounting-export');assert.equal(report.sales.length,60);assert.equal(new Set(report.sales.map(s=>s.billNo)).size,60);
  const stock=(await call('pos/bootstrap')).availabilityStock;
  assert.equal(stock.matcha.qty,700);assert.equal(stock.milk.qty,23400);assert.equal(stock.cup.qty,440);
  assert.equal(Number((await db.execute("SELECT COUNT(*) n FROM field_stock_transactions WHERE tx_type='SALE'")).rows[0].n),180);
});

for(const route of ['pos/checkout','pos/split/pay'])test(route+' rejects successful QR in another currency without a sale',async t=>{
  const {db,call}=await fixture(t);
  globalThis.fetch=async()=>new Response(JSON.stringify({chargeId:'ch_wrong_currency',status:'SUCCEEDED',amount:5500,currency:'USD'}));
  const body={requestKey:'wrong-currency',payment:'promptpay',method:'promptpay',paymentReference:'ch_wrong_currency',cart:[{id:'qa-latte',variant:'100%',qty:1}]};
  if(route.includes('split')){body.sessionId=(await call('pos/split/start','POST',{requestKey:'currency-reserve',cart:body.cart,mode:'promptpay_full'})).session.id;body.allocations=[{index:0,qty:1}];}
  const rejected=await call(route,'POST',body,409);assert.equal(rejected.error,'promptpay_currency_mismatch');
  const doc=JSON.parse((await db.execute('SELECT document FROM field_state')).rows[0].document);assert.equal(doc.sales.length,0);
});

test('one paid charge cannot fund another bill or a split payment; original replay remains safe',async t=>{
  const {db,call}=await fixture(t);
  globalThis.fetch=async()=>new Response(JSON.stringify({chargeId:'ch_unique_charge',status:'SUCCEEDED',amount:5500,currency:'THB'}));
  const body={requestKey:'unique-charge-first',cart:[{id:'qa-latte',variant:'100%',qty:1}],payment:'promptpay',paymentReference:'ch_unique_charge'};
  const first=await call('pos/checkout','POST',body);
  assert.equal((await call('pos/checkout','POST',body)).orderId,first.orderId);
  assert.equal((await call('pos/checkout','POST',{...body,requestKey:'unique-charge-second'},409)).error,'promptpay_charge_already_used');
  const {session}=await call('pos/split/start','POST',{requestKey:'unique-charge-reserve',cart:body.cart,mode:'promptpay_full'});
  assert.equal((await call('pos/split/pay','POST',{requestKey:'unique-charge-split',sessionId:session.id,method:'promptpay',paymentReference:body.paymentReference,allocations:[{index:0,qty:1}]},409)).error,'promptpay_charge_already_used');
  const doc=JSON.parse((await db.execute('SELECT document FROM field_state')).rows[0].document);
  assert.equal(doc.sales.length,1);assert.equal(doc.paymentSessions[0].payments.length,0);
});

for(const [name,patch,error]of [
  ['pending',{status:'PENDING'},'promptpay_not_verified'],
  ['failed',{status:'FAILED'},'promptpay_not_verified'],
  ['wrong amount',{amount:5400},'promptpay_amount_mismatch'],
  ['missing currency',{currency:null},'promptpay_currency_mismatch'],
  ['wrong charge identity',{chargeId:'ch_another_charge'},'promptpay_charge_mismatch']
])test('QR '+name+' preserves stock and creates no sale',async t=>{
  const {db,call}=await fixture(t);
  globalThis.fetch=async()=>new Response(JSON.stringify({chargeId:'ch_negative_test',status:'SUCCEEDED',amount:5500,currency:'THB',...patch}));
  assert.equal((await call('pos/checkout','POST',{requestKey:'negative-'+name,cart:[{id:'qa-latte',variant:'100%',qty:1}],payment:'promptpay',paymentReference:'ch_negative_test'},409)).error,error);
  const doc=JSON.parse((await db.execute('SELECT document FROM field_state')).rows[0].document);
  assert.equal(doc.sales.length,0);assert.equal(doc.ingredients.matcha.qty,1000);
});

