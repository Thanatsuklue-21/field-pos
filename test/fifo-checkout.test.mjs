import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClient} from '@libsql/client';
import {SCHEMA} from '../lib/schema.mjs';
import {checkoutPos,voidSale,startSplitPayment,paySplitPayment,refundSale} from '../lib/pos-api.mjs';
import {recordStockTransaction} from '../lib/stock-service.mjs';
import {bangkokDate} from '../lib/time.mjs';
import {createApi} from '../lib/api.mjs';
import {digest} from '../lib/security.mjs';

const user={id:'owner',role:'admin',permissions:{}};
async function setup(t){
  const dir=await mkdtemp(join(tmpdir(),'field-fifo-'));
  const db=createClient({url:'file:'+join(dir,'test.db')});
  t.after(async()=>{db.close();await rm(dir,{recursive:true,force:true}).catch(e=>{if(process.platform!=='win32'||e.code!=='EBUSY')throw e})});
  await db.batch(SCHEMA,'write');
  await db.execute("INSERT INTO field_users(id,username,password_hash,role,created_at,updated_at) VALUES('owner','owner','unused','admin',0,0)");
  const doc={menu:[{id:'latte',name:'Latte',enabled:true,price:50,variants:[{label:'S',recipeVersion:1,recipe:{items:{milk:3}}},{label:'L',recipeVersion:2,recipe:{items:{milk:5}}}]}],ingredients:{milk:{qty:0,unit:'g',unitCost:99}},settings:{pagerCount:10},sales:[],orders:[],billSeq:{},cashShifts:[{id:'shift',date:bangkokDate(),status:'open',openingCash:100}]};
  await put(db,doc);return db;
}
const state=async db=>JSON.parse((await db.execute('SELECT document FROM field_state')).rows[0].document);
const put=(db,doc)=>db.execute({sql:'UPDATE field_state SET document=? WHERE singleton=1',args:[JSON.stringify(doc)]});
const buy=(db,key,qty,cost,now)=>recordStockTransaction({db,actorId:user.id,now,input:{requestKey:key,ingredientId:'milk',type:'PURCHASE',qtyDelta:qty,unit:'g',purchaseCost:cost}});
const sell=(db,key,variant='S',qty=1)=>checkoutPos({db,user,body:{requestKey:key,cart:[{id:'latte',variant,qty}],date:bangkokDate(),payment:'cash',received:500}});
async function post(db,route,body,method='POST'){
  await db.execute({sql:'INSERT OR REPLACE INTO field_sessions VALUES(?,?,?,?)',args:[digest('fifo-token'),user.id,'csrf',Date.now()+60000]});
  const res={writeHead(status){this.status=status},end(raw){this.body=JSON.parse(raw)}};
  await createApi({db,origin:'https://field.test'})({method,query:{route},headers:{origin:'https://field.test',cookie:'field_session=fifo-token','x-csrf-token':'csrf'},body},res);return res;
}
async function snapshots(db){return (await db.execute('SELECT * FROM field_cost_snapshots ORDER BY created_at,id')).rows.map(r=>({...r,document:JSON.parse(r.document)}))}

test('FIFO checkout consumes single lot and snapshots actual purchase cost, not current cost',async t=>{
  const db=await setup(t);await buy(db,'purchase-single',10,20,Date.now()-2000);
  const doc=await state(db);doc.ingredients.milk.unitCost=99;await put(db,doc);
  await sell(db,'fifo-single-sale');
  assert.equal((await state(db)).sales[0].costTotal,6);
  const [snapshot]=await snapshots(db);
  assert.equal(snapshot.document.consumptions.length,1);
  assert.equal(snapshot.document.consumptions[0].qty,'3');
  assert.equal(snapshot.document.consumptions[0].totalCost,'6');
  assert.equal(snapshot.document.recipeVersion,1);
  assert.ok(snapshot.order_item_id);
});

test('FIFO spans lots by receivedAt and deterministic lot ID and preserves historical COGS',async t=>{
  const db=await setup(t),now=Date.now()-5000;
  await buy(db,'purchase-first',2,4,now);await buy(db,'purchase-second',10,30,now+1);
  const result=await sell(db,'fifo-multi-sale','L');
  assert.equal((await state(db)).sales[0].costTotal,13);
  const before=await snapshots(db),parts=before[0].document.consumptions;
  assert.deepEqual(parts.map(x=>[x.qty,x.totalCost]),[['2','4'],['3','9']]);
  const doc=await state(db);doc.menu[0].variants[1].recipe={items:{milk:99}};doc.ingredients.milk.unitCost=999;await put(db,doc);
  const replay=await sell(db,'fifo-multi-sale','L');assert.equal(replay.orderId,result.orderId);assert.equal(replay.replayed,true);
  assert.deepEqual(await snapshots(db),before);assert.equal((await state(db)).ingredients.milk.qty,7);
});

test('FIFO exact boundary and fractional monetary cost use one exact total rounding',async t=>{
  const db=await setup(t);await buy(db,'purchase-precision',3,0.1,Date.now()-1000);
  await sell(db,'fifo-precision-sale');
  const doc=await state(db);assert.equal(doc.ingredients.milk.qty,0);assert.equal(doc.sales[0].costTotal,0.1);
  assert.equal((await snapshots(db))[0].document.consumptions[0].totalCost,'0.1');
  await assert.rejects(sell(db,'fifo-boundary-next'),/stock_shortage/);
  assert.equal((await state(db)).sales.length,1);
});

test('FIFO void compensates original lots without deleting consumption and retry cannot restore twice',async t=>{
  const db=await setup(t);await buy(db,'purchase-reversal',10,20,Date.now()-1000);
  const paid=await sell(db,'fifo-reversal-sale');const before=await snapshots(db);
  const body={requestKey:'fifo-void-request',saleId:paid.saleIds[0],reason:'mistake',riskConfirmed:true};
  await voidSale({db,user,body});await voidSale({db,user,body});
  assert.deepEqual((await snapshots(db)).filter(x=>x.sale_id===paid.saleIds[0]&&x.document.consumptions),before);
  assert.equal((await state(db)).ingredients.milk.qty,10);
  const reversals=(await snapshots(db)).filter(x=>x.document.reversals);
  assert.equal(reversals.length,1);assert.equal(reversals[0].document.reversals[0].qty,'3');
});

test('concurrent final checks cannot oversell and failed checkout rolls back all effects',async t=>{
  const db=await setup(t);await buy(db,'purchase-race-test',3,6,Date.now()-1000);
  const replies=await Promise.allSettled([sell(db,'fifo-race-first'),sell(db,'fifo-race-second')]);
  assert.equal(replies.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(replies.filter(x=>x.status==='rejected'&&/stock_shortage/.test(x.reason.message)).length,1);
  assert.equal((await state(db)).ingredients.milk.qty,0);assert.equal((await snapshots(db)).length,1);
});

test('shared ingredient items reverse each original lot allocation exactly once',async t=>{
  const db=await setup(t),now=Date.now()-1000;await buy(db,'shared-lot-first',2,4,now);await buy(db,'shared-lot-second',10,30,now+1);
  const body={requestKey:'shared-items-sale',cart:[{id:'latte',variant:'S',qty:1},{id:'latte',variant:'L',qty:1}],date:bangkokDate(),payment:'bank',paymentReference:'bank-reference'};
  const paid=await checkoutPos({db,user,body});assert.equal((await state(db)).sales[0].costTotal,22);
  await refundSale({db,user,body:{requestKey:'shared-items-refund',saleId:paid.saleIds[0],manualConfirmed:true,manualReference:'refund-reference',reason:'cancel'}});
  await sell(db,'shared-items-resale','L');
  assert.equal((await state(db)).sales[1].costTotal,13);
});

test('split reservation excludes reserved demand and final payment snapshots actual lots',async t=>{
  const db=await setup(t);await buy(db,'split-lot-purchase',6,12,Date.now()-1000);
  const started=await startSplitPayment({db,user,body:{requestKey:'fifo-split-start',cart:[{id:'latte',variant:'S',qty:1}],date:bangkokDate()}});
  await sell(db,'fifo-other-sale');
  await assert.rejects(sell(db,'fifo-reserved-shortage'),/stock_shortage/);
  const paid=await paySplitPayment({db,user,body:{requestKey:'fifo-split-finish',sessionId:started.session.id,allocations:[{index:0,qty:1}],method:'cash',received:50}});
  assert.equal(paid.completed,true);assert.equal((await state(db)).sales[1].costTotal,6);
  assert.equal((await snapshots(db)).filter(x=>x.document.consumptions).length,2);
});

test('decimal recipe quantities deduct exact stock and roll back on late persistence failure',async t=>{
  const db=await setup(t);await buy(db,'decimal-lot-purchase',0.3,0.1,Date.now()-1000);
  const doc=await state(db);doc.menu[0].variants[0].recipe.items.milk=0.1;await put(db,doc);
  await db.execute("CREATE TRIGGER fail_fifo_snapshot BEFORE INSERT ON field_cost_snapshots BEGIN SELECT RAISE(ABORT,'test_persistence_failure'); END");
  await assert.rejects(sell(db,'fifo-rollback-test','S',3),/test_persistence_failure/);
  assert.deepEqual(await state(db),doc);assert.equal((await snapshots(db)).length,0);
  await db.execute('DROP TRIGGER fail_fifo_snapshot');await sell(db,'fifo-rollback-test','S',3);
  assert.equal((await state(db)).ingredients.milk.qty,0);
  await assert.rejects(sell(db,'fifo-decimal-next'),/stock_shortage/);
});

test('server cart precheck validates size and shared demand before accepting an order',async t=>{
  const db=await setup(t);await buy(db,'precheck-lot-purchase',6,12,Date.now()-1000);
  const response=await post(db,['pos','availability'],{cart:[{id:'latte',variant:'S',qty:1},{id:'latte',variant:'L',qty:1}]});
  assert.equal(response.status,200);assert.equal(response.body.available,false);
  assert.equal(response.body.menu[0].variants[0].maxServings,2);
  assert.equal(response.body.menu[0].variants[1].maxServings,1);
  assert.equal(response.body.menu[0].variants[0].lowStock,true);
  assert.equal((await state(db)).sales.length,0);
});

test('receivedAt ties use lotId and consumed purchases cannot be rewritten',async t=>{
  const db=await setup(t),now=Date.now()-1000;
  await buy(db,'tie-purchase-first',3,6,now);await buy(db,'tie-purchase-second',3,9,now);
  const rows=(await db.execute('SELECT * FROM field_purchase_records ORDER BY id')).rows;
  const paid=await sell(db,'tie-lot-sale');
  assert.equal((await snapshots(db))[0].document.consumptions[0].lotId,rows[0].id);
  const response=await post(db,['stock','purchases',String(rows[0].id)],{requestKey:'consumed-lot-edit',totalCost:99},'PATCH');
  assert.equal(response.status,409);assert.equal(response.body.error,'purchase_has_fifo_consumption');
  assert.equal((await state(db)).sales[0].id,paid.saleIds[0]);
});

test('cancelling a later unused purchase removes that lot rather than the oldest lot',async t=>{
  const db=await setup(t),now=Date.now()-2000;
  await buy(db,'cancel-purchase-first',10,20,now);await buy(db,'cancel-purchase-second',10,30,now+1);
  const lot=(await db.execute('SELECT * FROM field_purchase_records ORDER BY created_at DESC')).rows[0];
  const cancelled=await post(db,['stock','purchases',String(lot.id),'cancel'],{requestKey:'cancel-unused-lot',confirm:'CANCEL PURCHASE',reason:'duplicate receipt'});
  assert.equal(cancelled.status,200);
  await sell(db,'sale-after-cancelled-lot');assert.equal((await state(db)).sales[0].costTotal,6);
});

test('a purchase without a confirmed cost cannot become confirmed zero-cost COGS',async t=>{
  const db=await setup(t);
  await recordStockTransaction({db,actorId:user.id,input:{requestKey:'missing-cost-purchase',ingredientId:'milk',type:'PURCHASE',qtyDelta:10,unit:'g'}});
  await sell(db,'missing-cost-sale');
  const sale=(await state(db)).sales[0];
  assert.equal(sale.costStatus,'MISSING');assert.deepEqual(sale.items[0].missingCost,['milk']);
  assert.equal((await snapshots(db))[0].document.consumptions[0].costStatus,'MISSING');
});

test('opening stock is listed explicitly and its initial cost cannot follow subsequent ingredient price edits',async t=>{
  const db=await setup(t),doc=await state(db);doc.ingredients.milk={name:'Milk',qty:10,unit:'g',unitCost:2};await put(db,doc);
  const preview=await post(db,['stock','overview'],{},'GET');
  assert.deepEqual(preview.body.openingInventory.items.map(x=>[x.id,x.name,x.qty,x.unit]),[['milk','Milk',10,'g']]);
  await sell(db,'opening-first-sale');
  const after=await state(db);after.ingredients.milk.unitCost=999;await put(db,after);
  await sell(db,'opening-second-sale');
  const saved=await state(db);assert.equal(saved.sales[1].costTotal,6);
  assert.equal(saved.ingredients.milk.fifoOpeningLot.qty,'10');
  assert.equal(saved.ingredients.milk.fifoOpeningLot.costStatus,'PROVISIONAL');
});

test('two split sessions reserve distinct FIFO lots and finalizing the older session keeps its original lot',async t=>{
  const db=await setup(t),now=Date.now()-2000;
  await buy(db,'reserved-lot-first',3,6,now);await buy(db,'reserved-lot-second',3,9,now+1);
  const start=key=>startSplitPayment({db,user,body:{requestKey:key,cart:[{id:'latte',variant:'S',qty:1}],date:bangkokDate()}});
  const first=await start('fifo-reservation-first'),second=await start('fifo-reservation-second');
  const pay=(key,id)=>paySplitPayment({db,user,body:{requestKey:key,sessionId:id,allocations:[{index:0,qty:1}],method:'cash',received:50}});
  await pay('fifo-reservation-first-paid',first.session.id);
  await pay('fifo-reservation-second-paid',second.session.id);
  const doc=await state(db);assert.deepEqual(doc.sales.map(x=>x.costTotal),[6,9]);
});

test('fractional receipts cannot create a phantom opening lot at an exact stock boundary',async t=>{
  const db=await setup(t),now=Date.now()-2000;
  await buy(db,'fractional-receipt-one',0.1,0.01,now);await buy(db,'fractional-receipt-two',0.2,0.02,now+1);
  const doc=await state(db);doc.menu[0].variants[0].recipe.items.milk=0.1;await put(db,doc);
  await sell(db,'fractional-exact-sale','S',3);
  assert.equal((await state(db)).ingredients.milk.qty,0);
  assert.equal((await snapshots(db))[0].document.consumptions.length,2);
});

test('disabled menus fail the server precheck even while their ingredients are sufficient',async t=>{
  const db=await setup(t);await buy(db,'disabled-menu-stock',10,20,Date.now()-1000);
  const doc=await state(db);doc.menu[0].enabled=false;await put(db,doc);
  const checked=await post(db,['pos','availability'],{cart:[{id:'latte',variant:'S',qty:1}]});
  assert.equal(checked.status,200);assert.equal(checked.body.available,false);
});

test('resetting test stock prevents old opening quantities from appearing in the new opening list',async t=>{
  const db=await setup(t),doc=await state(db);doc.ingredients.milk.qty=10;await put(db,doc);
  await sell(db,'opening-before-reset');
  const reset=await state(db);reset.ingredients.milk.qty=0;reset.ingredients.milk.historyResetAt=Date.now()+1;await put(db,reset);
  const preview=await post(db,['stock','overview'],{},'GET');
  assert.equal(preview.body.openingInventory.items[0].qty,0);
});

test('existing split sessions created before FIFO rollout retain deterministic lot reservations',async t=>{
  const db=await setup(t),now=Date.now()-2000;
  await buy(db,'legacy-reserved-first',3,6,now);await buy(db,'legacy-reserved-second',3,9,now+1);
  const start=key=>startSplitPayment({db,user,body:{requestKey:key,cart:[{id:'latte',variant:'S',qty:1}],date:bangkokDate()}});
  const first=await start('legacy-session-first'),second=await start('legacy-session-second');
  const doc=await state(db);for(const session of doc.paymentSessions)delete session.fifoReservations;await put(db,doc);
  const pay=(key,id)=>paySplitPayment({db,user,body:{requestKey:key,sessionId:id,allocations:[{index:0,qty:1}],method:'cash',received:50}});
  await pay('legacy-session-first-paid',first.session.id);await pay('legacy-session-second-paid',second.session.id);
  assert.deepEqual((await state(db)).sales.map(x=>x.costTotal),[6,9]);
});

test('a purchase reserved by a pending payment cannot be cancelled out from under that payment',async t=>{
  const db=await setup(t),now=Date.now()-2000;
  await buy(db,'reserved-cancel-first',3,6,now);await buy(db,'reserved-cancel-second',10,30,now+1);
  const first=(await db.execute('SELECT * FROM field_purchase_records ORDER BY created_at')).rows[0];
  const session=await startSplitPayment({db,user,body:{requestKey:'reserved-cancel-start',cart:[{id:'latte',variant:'S',qty:1}],date:bangkokDate()}});
  const cancelled=await post(db,['stock','purchases',String(first.id),'cancel'],{requestKey:'reserved-cancel-request',confirm:'CANCEL PURCHASE',reason:'wrong receipt'});
  assert.equal(cancelled.status,409);assert.equal(cancelled.body.error,'purchase_has_fifo_consumption');
  const paid=await paySplitPayment({db,user,body:{requestKey:'reserved-cancel-pay',sessionId:session.session.id,allocations:[{index:0,qty:1}],method:'cash',received:50}});
  assert.equal(paid.completed,true);assert.equal((await state(db)).sales[0].costTotal,6);
});
