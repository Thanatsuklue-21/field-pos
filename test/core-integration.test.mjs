import {createHmac} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClient} from '@libsql/client';
import {SCHEMA} from '../lib/schema.mjs';
import {checkoutPos,queuePosAction,startSplitPayment,paySplitPayment,refundSale,getQueueSnapshot} from '../lib/pos-api.mjs';
import {createApi} from '../lib/api.mjs';
import {digest} from '../lib/security.mjs';
import {bangkokDate} from '../lib/time.mjs';

const user={id:'owner',role:'admin',permissions:{}};
const cart=[{id:'latte',variant:'100%',qty:2}];
const seed=()=>({menu:[{id:'latte',enabled:true,price:55,name:'Latte',variants:[{label:'100%',recipe:{items:{matcha:5,milk:110}}}]}],ingredients:{matcha:{qty:1000,unitCost:2},milk:{qty:30000,unitCost:0.06}},settings:{pagerCount:10},sales:[],orders:[],billSeq:{}});
async function setup(t,doc=seed()){
  const dir=await mkdtemp(join(tmpdir(),'field-core-'));
  const db=createClient({url:'file:'+join(dir,'test.db')});t.after(async()=>{
    db.close();
    try{await rm(dir,{recursive:true,force:true})}
    catch(error){
      // libSQL retains native handles until process exit on Windows.
      // Only temp-file cleanup can be deferred; assertion/SQL errors still fail.
      if(process.platform!=='win32'||error.code!=='EBUSY')throw error;
    }
  });
  await db.batch(SCHEMA,'write');
  await db.execute({sql:"INSERT INTO field_users(id,username,password_hash,role,created_at,updated_at) VALUES('owner','owner','unused','admin',0,0)",args:[]});
  await db.execute({sql:'UPDATE field_state SET document=? WHERE singleton=1',args:[JSON.stringify(doc)]});
  return db;
}
async function state(db){return JSON.parse((await db.execute('SELECT document FROM field_state')).rows[0].document)}
const sell=(db,key,extras={})=>checkoutPos({db,user,body:{requestKey:key,cart,date:bangkokDate(),payment:'cash',received:200,...extras}});
const act=(db,orderId,action,extras={})=>queuePosAction({db,user,body:{requestKey:crypto.randomUUID(),orderId,action,...extras}});

test('real libSQL: checkout → grouped preparation → early/full call → handoff → close day',async t=>{
  const db=await setup(t);
  const sale=await sell(db,'real-checkout');
  assert.equal(sale.total,110);assert.equal(sale.change,90);
  const s=await state(db);assert.equal(s.ingredients.matcha.qty,990);
  assert.equal((await db.execute('SELECT * FROM field_stock_transactions')).rows.length,2);
  await act(db,sale.orderId,'select',{itemIndex:0,selected:true});
  await act(db,sale.orderId,'complete_item',{itemIndex:0,expectedReadyQty:0});
  assert.equal((await state(db)).orders[0].items[0].readyQty,2);
  await assert.rejects(act(db,sale.orderId,'complete_item',{itemIndex:0,expectedReadyQty:0}),/queue_state_changed/);
  const token='integration-token';
  await db.execute({sql:'INSERT INTO field_sessions VALUES(?,?,?,?)',args:[digest(token),user.id,'csrf',Date.now()+60000]});
  const handler=createApi({db,origin:'https://field.test'});
  async function close(countedCash){const res={writeHead(status){this.status=status},end(body){this.body=JSON.parse(body)}};await handler({method:'POST',query:{route:'close-day'},headers:{origin:'https://field.test',cookie:'field_session='+token,'x-csrf-token':'csrf'},body:{openingCash:100,countedCash}},res);return res}
  assert.equal((await close('')).body.error,'counted_cash_required');
  assert.equal((await close(210)).body.error,'close_day_open_orders');
  await act(db,sale.orderId,'call');await act(db,sale.orderId,'return');
  const closed=await close(210);assert.equal(closed.status,201);assert.equal(closed.body.close.cashVariance,0);
  const expenseRes={writeHead(status){this.status=status},end(body){this.body=JSON.parse(body)}};
  await handler({method:'POST',query:{route:'expenses'},headers:{origin:'https://field.test',cookie:'field_session='+token,'x-csrf-token':'csrf'},body:{amount:10,category:'OTHER'}},expenseRes);
  assert.equal(expenseRes.body.error,'day_closed');
  await assert.rejects(sell(db,'closed-checkout'),/day_closed/);
});

test('real libSQL: production refund clears the order and close day excludes refunded cash sale',async t=>{
  const db=await setup(t);
  const paid=await sell(db,'refund-close-checkout');
  await act(db,paid.orderId,'start',{itemIndex:0,unit:1});
  let doc=await state(db),sale=doc.sales.find(x=>x.id===paid.saleIds[0]);
  assert.equal(sale.status,'paid');
  const refunded=await refundSale({db,user,now:Date.now(),body:{requestKey:'refund-close-0001',saleId:sale.id,reason:'customer complaint'}});
  assert.equal(refunded.refundAmount,110);
  assert.equal(refunded.stockRestored,false);
  doc=await state(db);
  assert.equal(doc.sales[0].status,'refunded');
  assert.equal(doc.orders[0].status,'void');
  assert.equal(doc.ingredients.matcha.qty,990);

  const token='refund-close-token';
  await db.execute({sql:'INSERT INTO field_sessions VALUES(?,?,?,?)',args:[digest(token),user.id,'csrf',Date.now()+60000]});
  const handler=createApi({db,origin:'https://field.test'});
  const res={writeHead(status){this.status=status},end(body){this.body=JSON.parse(body)}};
  await handler({method:'POST',query:{route:'close-day'},headers:{origin:'https://field.test',cookie:'field_session='+token,'x-csrf-token':'csrf'},body:{openingCash:100,countedCash:100}},res);
  assert.equal(res.status,201);
  assert.equal(res.body.close.revenue,0);
  assert.equal(res.body.close.cash,0);
  assert.equal(res.body.close.expectedCash,100);
  assert.equal(res.body.close.cashVariance,0);
  assert.equal(res.body.close.orders,0);
});

test('real libSQL: durable checkout retry survives 100 newer queue mutations',async t=>{
  const db=await setup(t);const first=await sell(db,'original-request');
  for(let i=0;i<105;i++)await act(db,first.orderId,'select',{itemIndex:0,selected:i%2===0});
  assert.equal((await state(db)).posRequestKeys['original-request'],undefined);
  const replay=await sell(db,'original-request');assert.equal(replay.replayed,true);assert.equal(replay.orderId,first.orderId);
  assert.equal((await state(db)).sales.length,1);assert.equal((await state(db)).ingredients.matcha.qty,990);
});

test('real libSQL: split rejects repeated indexes and fractional quantities without modifying stock/payments',async t=>{
  const db=await setup(t);
  const split=await startSplitPayment({db,user,body:{requestKey:'split-start',cart,date:bangkokDate()}});
  const before=await state(db);
  for(const allocations of [[{index:0,qty:1},{index:0,qty:1}],[{index:0,qty:1.5}]]){
    await assert.rejects(paySplitPayment({db,user,body:{requestKey:crypto.randomUUID(),sessionId:split.session.id,allocations,method:'cash',received:200}}),/duplicate_payment_allocation|invalid_payment_allocation/);
    assert.deepEqual(await state(db),before);
  }
  const paid=await paySplitPayment({db,user,body:{requestKey:'split-pay',sessionId:split.session.id,allocations:[{index:0,qty:2}],method:'cash',received:200}});
  assert.equal(paid.completed,true);assert.equal((await state(db)).sales.length,1);
});

test('real libSQL: preparation cannot start or complete a later queue before the oldest queue',async t=>{
  const db=await setup(t);
  const first=await sell(db,'prep-fifo-first');
  const second=await sell(db,'prep-fifo-second');
  await assert.rejects(act(db,second.orderId,'select',{itemIndex:0,selected:true}),/fifo_violation/);
  await assert.rejects(act(db,second.orderId,'start',{itemIndex:0,unit:1}),/fifo_violation/);
  await act(db,first.orderId,'select',{itemIndex:0,selected:true});
  await act(db,first.orderId,'complete_item',{itemIndex:0,expectedReadyQty:0});
  await assert.rejects(act(db,second.orderId,'select',{itemIndex:0,selected:true}),/fifo_violation/);
  await act(db,first.orderId,'call');
  await act(db,first.orderId,'return');
  await act(db,second.orderId,'select',{itemIndex:0,selected:true});
  const doc=await state(db);
  assert.equal(doc.orders.find(x=>x.id===second.orderId).items[0].prepSelected,true);
});

test('real libSQL: legacy production actions cannot bypass FIFO; cancelled order cannot reopen',async t=>{
  const db=await setup(t);const first=await sell(db,'first-request');const second=await sell(db,'second-request');
  await assert.rejects(act(db,second.orderId,'start',{itemIndex:0,unit:1}),/fifo_violation/);
  const doc=await state(db);
  doc.orders.find(x=>x.id===second.orderId).items[0].readyQty=1;
  await db.execute({sql:'UPDATE field_state SET document=? WHERE singleton=1',args:[JSON.stringify(doc)]});
  await assert.rejects(act(db,second.orderId,'finish',{itemIndex:0,unit:1}),/fifo_violation/);
  const next=await state(db);next.orders[0].status='void';
  await db.execute({sql:'UPDATE field_state SET document=? WHERE singleton=1',args:[JSON.stringify(next)]});
  await assert.rejects(act(db,first.orderId,'select',{itemIndex:0,selected:true}),/order_not_found/);
  await assert.rejects(sell(db,'void-addon',{targetOrderId:first.orderId}),/target_order_unavailable/);
});

test('real libSQL: invalid recipes and fractional carts never create free sales or increase stock',async t=>{
  for(const recipe of [undefined,{}, {matcha:-5},{matcha:'invalid'}]){
    const doc=seed();doc.menu[0].variants[0].recipe={items:recipe};const db=await setup(t,doc);
    await assert.rejects(sell(db,'invalid-recipe'),/recipe_unavailable/);assert.equal((await state(db)).sales.length,0);
  }
  const db=await setup(t);await assert.rejects(sell(db,'fractional-cart',{cart:[{id:'latte',variant:'100%',qty:1.5}]}),/invalid_cart/);
});

test('real libSQL: reused key with different cart or actor is rejected',async t=>{const db=await setup(t);await sell(db,'stable-request');await assert.rejects(sell(db,'stable-request',{cart:[{id:'latte',variant:'100%',qty:1}]}),/request_key_conflict/);await assert.rejects(checkoutPos({db,user:{...user,id:'other'},body:{requestKey:'stable-request',cart,date:bangkokDate(),payment:'cash',received:200}}),/request_key_conflict/);assert.equal((await state(db)).sales.length,1)});

test('real libSQL: simultaneous checkout retries commit one sale and one stock deduction',async t=>{const db=await setup(t);const results=await Promise.all([sell(db,'concurrent-request'),sell(db,'concurrent-request')]);assert.equal(results[0].orderId,results[1].orderId);assert.equal(results.filter(x=>x.replayed).length,1);assert.equal((await state(db)).sales.length,1);assert.equal((await state(db)).ingredients.matcha.qty,990)});

test('real libSQL: revision-aware POS and Queue reads skip unchanged state payloads',async t=>{
  const db=await setup(t);
  const firstQueue=await getQueueSnapshot({db});
  assert.equal(firstQueue.revision,0);
  assert.ok(Array.isArray(firstQueue.orders));
  const sameQueue=await getQueueSnapshot({db,sinceRevision:firstQueue.revision});
  assert.deepEqual(sameQueue,{revision:0,unchanged:true});

  const token='revision-poll-token';
  await db.execute({sql:'INSERT INTO field_sessions VALUES(?,?,?,?)',args:[digest(token),user.id,'csrf',Date.now()+60000]});
  const handler=createApi({db,origin:'https://field.test'});
  async function getBootstrap(revision){
    const res={writeHead(status){this.status=status},end(raw){this.body=JSON.parse(raw)}};
    const headers={cookie:'field_session='+token};
    if(revision!==undefined)headers['x-field-revision']=String(revision);
    await handler({method:'GET',query:{route:'pos/bootstrap'},headers},res);
    return res;
  }
  const bootstrap=await getBootstrap();
  assert.equal(bootstrap.status,200);
  assert.equal(bootstrap.body.revision,0);
  assert.ok(Array.isArray(bootstrap.body.menu));
  assert.equal('orders' in bootstrap.body,false);
  assert.deepEqual((await getBootstrap(0)).body,{revision:0,unchanged:true});

  await sell(db,'revision-poll-sale');
  const changed=await getBootstrap(0);
  assert.equal(changed.body.revision,1);
  assert.equal(changed.body.unchanged,undefined);
  assert.ok(Array.isArray(changed.body.menu));
  assert.deepEqual(await getQueueSnapshot({db,sinceRevision:1}),{revision:1,unchanged:true});
});

test('real libSQL: stale precheck still rejects stock race on the server',async t=>{const doc=seed();doc.ingredients.matcha.qty=10;doc.ingredients.milk.qty=220;const db=await setup(t,doc);const staleBootstrap=structuredClone(doc);assert.equal(staleBootstrap.ingredients.matcha.qty,10);await sell(db,'race-winner');await assert.rejects(sell(db,'race-stale-client'),/stock_shortage/);assert.equal((await state(db)).sales.length,1);assert.equal((await state(db)).ingredients.matcha.qty,0)});

test('real libSQL: full backup restores ledger and durable retry together',async t=>{
  const db=await setup(t);const sale=await sell(db,'backed-up-request');
  const token='backup-token';await db.execute({sql:'INSERT INTO field_sessions VALUES(?,?,?,?)',args:[digest(token),user.id,'csrf',Date.now()+60000]});
  const handler=createApi({db,origin:'https://field.test'});
  async function request(method,route,body){const res={writeHead(status){this.status=status},end(raw){this.body=JSON.parse(raw)}};await handler({method,query:{route},headers:{origin:'https://field.test',cookie:'field_session='+token,'x-csrf-token':'csrf'},body},res);return res}
  const exported=await request('GET','admin/backup/export');assert.equal(exported.status,200);assert.equal(exported.body.tables.posRequests.length,1);
  await act(db,sale.orderId,'select',{itemIndex:0,selected:true});
  const revision=Number((await db.execute('SELECT revision FROM field_state')).rows[0].revision);
  const restored=await request('POST','admin/backup/restore',{backup:exported.body,expectedRevision:revision,confirm:true});
  assert.equal(restored.status,200);assert.equal((await sell(db,'backed-up-request')).replayed,true);
  assert.equal((await state(db)).sales.length,1);assert.equal((await db.execute('SELECT * FROM field_stock_transactions')).rows.length,2);
});


test('real libSQL: separate-person bills share one queue and pager while keeping separate sales',async t=>{
  const db=await setup(t);
  const one=[{id:'latte',variant:'100%',qty:1}];
  const first=await sell(db,'group-person-1',{cart:one,received:55});
  const second=await sell(db,'group-person-2',{cart:one,received:55,targetOrderId:first.orderId});
  assert.equal(second.orderId,first.orderId);
  assert.equal(second.queueNo,first.queueNo);
  assert.equal(second.pager,first.pager);
  assert.notEqual(second.billNo,first.billNo);
  const doc=await state(db);
  assert.equal(doc.orders.length,1);
  assert.equal(doc.sales.length,2);
  assert.equal(doc.orders[0].saleIds.length,2);
  assert.equal(doc.orders[0].items.reduce((s,x)=>s+Number(x.qty||0),0),2);
  assert.equal(doc.sales[0].paymentGroupId,doc.sales[1].paymentGroupId);
});

test('real libSQL: payment reservation for next person can target the same queue order',async t=>{
  const db=await setup(t);
  const one=[{id:'latte',variant:'100%',qty:1}];
  const first=await sell(db,'reserved-group-person-1',{cart:one,received:55});
  const split=await startSplitPayment({db,user,body:{
    requestKey:'reserved-group-start',date:bangkokDate(),cart:one,mode:'promptpay_full',targetOrderId:first.orderId
  }});
  assert.equal(split.session.pager,first.pager);
  assert.equal(split.session.targetOrderId,first.orderId);
  const paid=await paySplitPayment({db,user,body:{
    requestKey:'reserved-group-pay',sessionId:split.session.id,allocations:[{index:0,qty:1}],method:'cash',received:55
  }});
  assert.equal(paid.completed,true);
  assert.equal(paid.orderId,first.orderId);
  assert.equal(paid.queueNo,first.queueNo);
  assert.equal(paid.pager,first.pager);
  const doc=await state(db);
  assert.equal(doc.orders.length,1);
  assert.equal(doc.sales.length,2);
  assert.equal(doc.orders[0].saleIds.length,2);
});


test('real libSQL: queue merges duplicate menu lines across separate-person payments and groups shared prep base',async t=>{
  const doc={
    menu:[
      {id:'pure',enabled:true,price:45,name:'Pure Matcha Iced',category:'MATCHA',variants:[{label:'0%',recipeVersion:1,recipe:{items:{matcha:4,water:170}}}]},
      {id:'latte',enabled:true,price:55,name:'Matcha Latte',category:'MATCHA',variants:[{label:'100%',recipeVersion:1,recipe:{items:{matcha:5,water:40,milk:110}}}]}
    ],
    ingredients:{
      matcha:{name:'Yamito Matcha',qty:1000,unit:'g',unitCost:2},
      water:{name:'Water',qty:50000,unit:'g',unitCost:0},
      milk:{name:'Milk',qty:30000,unit:'g',unitCost:.06}
    },
    settings:{pagerCount:10},sales:[],orders:[],billSeq:{}
  };
  const db=await setup(t,doc),date=bangkokDate();
  const cart=[{id:'pure',variant:'0%',qty:1},{id:'latte',variant:'100%',qty:1}];
  const first=await checkoutPos({db,user,body:{requestKey:'prep-group-p1',cart,date,payment:'cash',received:100}});
  await checkoutPos({db,user,body:{requestKey:'prep-group-p2',cart,date,payment:'cash',received:100,targetOrderId:first.orderId}});
  const snapshot=await getQueueSnapshot({db});
  assert.equal(snapshot.orders.length,1);
  const order=snapshot.orders[0];
  assert.equal(order.items.length,2);
  assert.equal(order.items.find(x=>x.id==='pure').qty,2);
  assert.equal(order.items.find(x=>x.id==='latte').qty,2);
  assert.equal(order.prepGroups.length,1);
  const matchaGroup=order.prepGroups[0];
  assert.equal(matchaGroup.id,'MATCHA');
  assert.equal(matchaGroup.batchMode,'SEQUENTIAL');
  assert.equal(matchaGroup.qty,4);
  assert.equal(matchaGroup.items.length,2);
  const pureItem=matchaGroup.items.find(i=>i.id==='pure');
  const latteItem=matchaGroup.items.find(i=>i.id==='latte');
  assert.equal(pureItem.qty,2);
  assert.equal(latteItem.qty,2);
  assert.equal(pureItem.baseUsage.find(x=>x.id==='matcha').perCup,4);
  assert.equal(pureItem.baseUsage.find(x=>x.id==='matcha').qty,8);
  assert.equal(latteItem.baseUsage.find(x=>x.id==='matcha').perCup,5);
  assert.equal(latteItem.baseUsage.find(x=>x.id==='matcha').qty,10);
  assert.equal(matchaGroup.compatibilityKeys.length,2);
  assert.equal(matchaGroup.baseUsage.find(x=>x.id==='matcha').qty,18);
  assert.equal(matchaGroup.baseUsage.find(x=>x.id==='matcha').unit,'g');

  await act(db,first.orderId,'select',{itemIndex:0,selected:true});
  await act(db,first.orderId,'complete_item',{itemIndex:0,expectedReadyQty:0});
  await act(db,first.orderId,'select',{itemIndex:1,selected:true});
  await act(db,first.orderId,'complete_item',{itemIndex:1,expectedReadyQty:0});
  const completedSnapshot=await getQueueSnapshot({db});
  const completedGroup=completedSnapshot.orders[0].prepGroups.find(x=>x.id==='MATCHA');
  assert.ok(completedGroup);
  assert.equal(completedGroup.qty,4);
  assert.equal(completedGroup.pendingQty,0);
  assert.equal(completedGroup.items.find(i=>i.id==='pure').qty,2);
  assert.equal(completedGroup.items.find(i=>i.id==='latte').qty,2);
  assert.equal(completedGroup.items.find(i=>i.id==='pure').baseUsage.find(x=>x.id==='matcha').qty,8);
  assert.equal(completedGroup.items.find(i=>i.id==='latte').baseUsage.find(x=>x.id==='matcha').qty,10);
});


test('real libSQL: identical prep bases stay separated between different queue cards',async t=>{
  const db=await setup(t),date=bangkokDate();
  const first=await checkoutPos({db,user,body:{requestKey:'queue-base-card-1',cart:[{id:'latte',variant:'100%',qty:2}],date,payment:'cash',received:200}});
  const second=await checkoutPos({db,user,body:{requestKey:'queue-base-card-2',cart:[{id:'latte',variant:'100%',qty:2}],date,payment:'cash',received:200}});
  const snapshot=await getQueueSnapshot({db});
  assert.equal(snapshot.orders.length,2);
  assert.equal(snapshot.orders.find(x=>x.id===first.orderId).prepGroups[0].qty,2);
  assert.equal(snapshot.orders.find(x=>x.id===second.orderId).prepGroups[0].qty,2);
});


test('real libSQL: remake waste deducts one extra sale-time recipe once and reopens ready work',async t=>{
  const db=await setup(t);
  const sale=await sell(db,'remake-waste-sale');
  await act(db,sale.orderId,'select',{itemIndex:0,selected:true});
  await act(db,sale.orderId,'complete_item',{itemIndex:0,expectedReadyQty:0});
  let doc=await state(db);
  assert.equal(doc.ingredients.matcha.qty,990);
  assert.equal(doc.ingredients.milk.qty,29780);
  assert.equal(doc.orders[0].items[0].readyQty,2);

  const body={requestKey:'remake-waste-0001',orderId:sale.orderId,itemIndex:0,action:'waste_remake',reason:'ทำหก'};
  const first=await queuePosAction({db,user,now:5000,body});
  assert.equal(first.wasteCost,16.6);
  doc=await state(db);
  assert.equal(doc.ingredients.matcha.qty,985);
  assert.equal(doc.ingredients.milk.qty,29670);
  assert.equal(doc.orders[0].items[0].readyQty,1);
  assert.equal(doc.orders[0].items[0].prepSelected,true);
  assert.equal(doc.orders[0].items[0].wasteCount,1);
  const wasteExpenses=(doc.expenses||[]).filter(x=>x.sourceType==='STOCK_REMAKE_WASTE');
  assert.equal(wasteExpenses.length,1);
  assert.equal(wasteExpenses[0].amount,16.6);
  assert.equal(wasteExpenses[0].paymentMethod,'noncash');
  const wasteLedger=(await db.execute("SELECT * FROM field_stock_transactions WHERE tx_type='WASTE'")).rows;
  assert.equal(wasteLedger.length,2);

  const replay=await queuePosAction({db,user,now:6000,body});
  assert.equal(replay.replayed,true);
  doc=await state(db);
  assert.equal(doc.ingredients.matcha.qty,985);
  assert.equal(doc.ingredients.milk.qty,29670);
  assert.equal((doc.expenses||[]).filter(x=>x.sourceType==='STOCK_REMAKE_WASTE').length,1);
  assert.equal((await db.execute("SELECT * FROM field_stock_transactions WHERE tx_type='WASTE'")).rows.length,2);
});

test('real libSQL: remake waste obeys FIFO and cannot auto-reverse after item was fully called',async t=>{
  const db=await setup(t);
  const first=await sell(db,'remake-fifo-first');
  const second=await sell(db,'remake-fifo-second');
  await assert.rejects(
    queuePosAction({db,user,body:{requestKey:'remake-fifo-block',orderId:second.orderId,itemIndex:0,action:'waste_remake'}}),
    /fifo_violation/
  );
  await act(db,first.orderId,'select',{itemIndex:0,selected:true});
  await act(db,first.orderId,'complete_item',{itemIndex:0,expectedReadyQty:0});
  await act(db,first.orderId,'call');
  await assert.rejects(
    queuePosAction({db,user,body:{requestKey:'remake-after-call',orderId:first.orderId,itemIndex:0,action:'waste_remake'}}),
    /waste_after_call_not_supported/
  );
});

test('queue UI exposes one-person remake waste shortcut with explicit accounting wording',async()=>{
  const queue=await readFile(new URL('../app/queue/page.tsx',import.meta.url),'utf8');
  assert.match(queue,/ชงเสีย \/ ทำใหม่/);
  assert.match(queue,/หักวัตถุดิบเพิ่มตามสูตรที่ใช้ตอนขาย/);
  assert.match(queue,/ลงค่าใช้จ่าย WASTE อัตโนมัติ/);
  assert.match(queue,/waste_remake/);
});


test('real libSQL: signed payment webhook duplicate keeps one sale, stock deduction, queue and LINE message',async t=>{
 const db=await setup(t),now=Date.now();
 const started=await startSplitPayment({db,user,body:{requestKey:'webhook-start',cart,date:bangkokDate(),mode:'promptpay_full'},now});
 const sessionId=started.session.id,chargeId='ch_webhook_test';
 const saved={...process.env},originalFetch=globalThis.fetch;
 process.env.PROMPTPAY_PROVIDER='beam';process.env.BEAM_MERCHANT_ID='merchant';process.env.BEAM_API_KEY='key';process.env.BEAM_WEBHOOK_HMAC_KEY=Buffer.from('test-webhook-key').toString('base64');
 process.env.LINE_CHANNEL_ACCESS_TOKEN='test-token';process.env.LINE_KITCHEN_GROUP_ID='C'+'a'.repeat(32);
 t.after(()=>{globalThis.fetch=originalFetch;for(const key of ['PROMPTPAY_PROVIDER','BEAM_MERCHANT_ID','BEAM_API_KEY','BEAM_WEBHOOK_HMAC_KEY','LINE_CHANNEL_ACCESS_TOKEN','LINE_KITCHEN_GROUP_ID']){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key]}});
 const event={merchantId:'merchant',chargeId,status:'SUCCEEDED',amount:11000,currency:'THB',referenceId:sessionId};
 let pushes=0;
 globalThis.fetch=async url=>{if(String(url).startsWith('https://api.line.me/')){pushes++;return new Response('{}',{status:200})}return new Response(JSON.stringify(event),{status:200})};
 const rawBody=JSON.stringify(event),signature=createHmac('sha256',Buffer.from('test-webhook-key')).update(rawBody).digest('base64');
 const handler=createApi({db,origin:'https://field.test'});
 async function callback(){const res={writeHead(status){this.status=status},end(body){this.body=JSON.parse(body)}};await handler({method:'POST',query:{route:['payments','promptpay','webhook']},headers:{'x-beam-signature':signature,'x-beam-event':'charge.succeeded'},body:event,rawBody},res);return res}
 assert.equal((await callback()).status,200);assert.equal((await callback()).status,200);
 const doc=await state(db);assert.equal(doc.sales.length,1);assert.equal(doc.orders.length,1);assert.equal(doc.ingredients.matcha.qty,990);assert.equal(pushes,1);
 assert.equal((await db.execute('SELECT state FROM field_line_outbox')).rows[0].state,'sent');
});


test('real libSQL: called queues wait for pickup without blocking production or out-of-order handoff',async t=>{
 const db=await setup(t),first=await sell(db,'pickup-first'),second=await sell(db,'pickup-second');
 await assert.rejects(act(db,second.orderId,'complete_item',{itemIndex:0,expectedReadyQty:0}),/fifo_violation/);
 // One completion tap no longer needs a select round trip.
 await act(db,first.orderId,'complete_item',{itemIndex:0,expectedReadyQty:0});
 await assert.rejects(act(db,second.orderId,'complete_item',{itemIndex:0,expectedReadyQty:0}),/fifo_violation/);
 await act(db,first.orderId,'call');
 await act(db,second.orderId,'complete_item',{itemIndex:0,expectedReadyQty:0});
 await assert.rejects(act(db,second.orderId,'complete_item',{itemIndex:0,expectedReadyQty:0}),/queue_state_changed/);
 await act(db,second.orderId,'call');
 assert.equal((await getQueueSnapshot({db})).orders.length,2);
 const handoffKey='pickup-second-return';
 const body={requestKey:handoffKey,orderId:second.orderId,action:'return'};
 await queuePosAction({db,user,body});
 assert.equal((await queuePosAction({db,user,body})).replayed,true);
 const pending=(await getQueueSnapshot({db})).orders;assert.equal(pending.length,1);assert.equal(pending[0].id,first.orderId);assert.equal(pending[0].status,'ready');
 await act(db,first.orderId,'return');assert.equal((await getQueueSnapshot({db})).orders.length,0);
 const doc=await state(db);assert.equal(doc.sales.length,2);assert.equal(doc.ingredients.matcha.qty,980);
 for(const cached of Object.values(doc.posRequestKeys))assert.equal(cached.response.orders,undefined);
});
