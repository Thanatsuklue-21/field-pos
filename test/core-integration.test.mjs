import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClient} from '@libsql/client';
import {SCHEMA} from '../lib/schema.mjs';
import {checkoutPos,queuePosAction,startSplitPayment,paySplitPayment} from '../lib/pos-api.mjs';
import {createApi} from '../lib/api.mjs';
import {digest} from '../lib/security.mjs';
import {bangkokDate} from '../lib/time.mjs';

const user={id:'owner',role:'admin',permissions:{}};
const cart=[{id:'latte',variant:'100%',qty:2}];
const seed=()=>({menu:[{id:'latte',enabled:true,price:55,name:'Latte',variants:[{label:'100%',recipe:{items:{matcha:5,milk:110}}}]}],ingredients:{matcha:{qty:1000,unitCost:2},milk:{qty:30000,unitCost:0.06}},settings:{pagerCount:10},sales:[],orders:[],billSeq:{}});
async function setup(t,doc=seed()){
  const dir=await mkdtemp(join(tmpdir(),'field-core-'));
  const db=createClient({url:'file:'+join(dir,'test.db')});t.after(async()=>{db.close();await rm(dir,{recursive:true,force:true})});
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

test('real libSQL: legacy finish cannot bypass FIFO; cancelled order cannot reopen',async t=>{
  const db=await setup(t);const first=await sell(db,'first-request');const second=await sell(db,'second-request');
  await act(db,second.orderId,'start',{itemIndex:0,unit:1});
  await assert.rejects(act(db,second.orderId,'finish',{itemIndex:0,unit:1}),/fifo_violation/);
  const doc=await state(db);doc.orders[0].status='void';
  await db.execute({sql:'UPDATE field_state SET document=? WHERE singleton=1',args:[JSON.stringify(doc)]});
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
