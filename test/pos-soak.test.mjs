import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkoutPos,queuePosAction,startSplitPayment,paySplitPayment,getSplitPaymentStatus,getSplitPaymentProviderContext,beginSplitPaymentProviderCharge,attachSplitPaymentProviderCharge,listSplitPaymentSessions,resolveSplitPayment,voidSale,refundSale
} from '../lib/pos-api.mjs';
import {buildPosAvailability} from '../lib/domain/availability.mjs';
import {reconcileCash} from '../lib/domain/cash-reconciliation.mjs';

function initialState(){
  return {
    menu:[{
      id:'matcha-latte',name:'Matcha Latte',category:'MATCHA',enabled:true,price:55,
      variants:[{label:'100%',recipe:{items:{matcha:5,milk:110,cup16:1}}}]
    }],
    ingredients:{
      matcha:{qty:1000,unitCost:2},
      milk:{qty:30000,unitCost:0.06},
      cup16:{qty:500,unitCost:2}
    },
    settings:{pagerCount:10,pointsSpend:50},
    customers:[{id:'cus-1',name:'Customer One',points:0,visits:0,totalSpend:0,lastVisit:0}],
    sales:[],orders:[],billSeq:{},paymentSessions:[]
  };
}

function fakeDb(seed=initialState()){
  const storage={revision:0,document:JSON.stringify(seed),audits:[],stockTx:[],costSnapshots:[],requests:[]};

  function executeOn(target,query){
    const {sql,args=[]}=typeof query==='string'?{sql:query,args:[]}:query;
    if(sql.startsWith('SELECT response,request_hash FROM field_pos_requests'))return {rows:target.requests.filter(r=>r.key===args[0]).map(r=>({response:r.response,request_hash:r.hash}))};
    if(sql.startsWith('INSERT INTO field_pos_requests')){target.requests.push({key:args[0],response:args[1],hash:args[3]});return {rows:[]}}
    if(sql.startsWith('SELECT revision,document FROM field_state')){
      return {rows:[{revision:target.revision,document:target.document}]};
    }
    if(sql.startsWith('UPDATE field_state SET revision=')){
      target.revision=Number(args[0]);
      target.document=String(args[1]);
      return {rows:[],rowsAffected:1};
    }
    if(sql.startsWith('INSERT INTO field_audit')){
      target.audits.push(args);
      return {rows:[]};
    }
    if(sql.startsWith('INSERT INTO field_stock_transactions')){
      target.stockTx.push(args);
      return {rows:[]};
    }
    if(sql.startsWith('INSERT INTO field_cost_snapshots')){
      target.costSnapshots.push(args);
      return {rows:[]};
    }
    throw new Error('Unexpected SQL: '+sql);
  }

  return {
    storage,
    async execute(query){return executeOn(storage,query)},
    async transaction(){
      const draft={
        revision:storage.revision,
        document:storage.document,
        audits:storage.audits.slice(),
        stockTx:storage.stockTx.slice(),
        requests:storage.requests.slice(),
        costSnapshots:storage.costSnapshots.slice()
      };
      return {
        async execute(query){return executeOn(draft,query)},
        async commit(){
          storage.revision=draft.revision;
          storage.document=draft.document;
          storage.audits=draft.audits;
          storage.stockTx=draft.stockTx;
          storage.costSnapshots=draft.costSnapshots;storage.requests=draft.requests;
        },
        async rollback(){}
      };
    }
  };
}

const user={id:'admin-1',role:'admin',permissions:{}};
const date='2026-10-01';
const cart=[{id:'matcha-latte',variant:'100%',qty:1}];

test('30-order POS soak keeps bills unique, stock exact and queues returnable',async()=>{
  const db=fakeDb();

  for(let i=1;i<=30;i++){
    const checkoutBody={
      requestKey:'checkout-soak-'+String(i).padStart(3,'0'),
      cart,date,payment:'cash',received:100
    };
    const checkout=await checkoutPos({
      db,user,now:1_000_000+i*10,
      body:checkoutBody
    });
    const replay=await checkoutPos({
      db,user,now:1_000_000+i*10+1,
      body:checkoutBody
    });

    assert.ok(checkout.orderId);
    assert.match(checkout.queueNo,/^A\d{3}$/);
    assert.equal(replay.replayed,true);
    assert.equal(replay.orderId,checkout.orderId);
    assert.deepEqual(replay.saleIds,checkout.saleIds);

    const stateAfterPay=JSON.parse(db.storage.document);
    const order=stateAfterPay.orders.find(o=>o.id===checkout.orderId);
    assert.ok(order);

    await queuePosAction({
      db,user,now:1_000_001+i*10,
      body:{requestKey:'start-soak-'+i,action:'start',orderId:order.id,itemIndex:0,unit:1}
    });
    await queuePosAction({
      db,user,now:1_000_002+i*10,
      body:{requestKey:'finish-soak-'+i,action:'finish',orderId:order.id,itemIndex:0,unit:1}
    });
    await queuePosAction({
      db,user,now:1_000_003+i*10,
      body:{requestKey:'return-soak-'+i,action:'return',orderId:order.id}
    });
  }

  const state=JSON.parse(db.storage.document);
  assert.equal(state.sales.length,30);
  assert.ok(state.sales.every(s=>s.costStatus==='CONFIRMED'));
  assert.equal(new Set(state.sales.map(s=>s.id)).size,30);
  assert.equal(new Set(state.sales.map(s=>s.billNo)).size,30);
  assert.equal(state.orders.length,30);
  assert.ok(state.orders.every(o=>o.status==='returned'));

  assert.equal(state.ingredients.matcha.qty,1000-(30*5));
  assert.equal(state.ingredients.milk.qty,30000-(30*110));
  assert.equal(state.ingredients.cup16.qty,500-30);
  assert.ok(Object.values(state.ingredients).every(ingredient=>Number(ingredient.qty)>=0));

  assert.equal(state.billSeq[date],30);
  assert.deepEqual(state.orders.map(o=>o.queueNo),Array.from({length:30},(_,i)=>'A'+String(i+1).padStart(3,'0')));
  assert.equal(db.storage.stockTx.length,90);
  assert.equal(db.storage.costSnapshots.length,30);
  assert.ok(db.storage.stockTx.every(args=>args[2]==='SALE'&&Number(args[3])<0));

  const cashSales=state.sales.reduce((sum,s)=>sum+Number(s.total||0),0);
  const tendered=state.sales.reduce((sum,s)=>sum+Number(s.received||0),0);
  const change=state.sales.reduce((sum,s)=>sum+Number(s.change||0),0);
  assert.equal(cashSales,30*55);
  assert.equal(tendered-change,cashSales);
  assert.deepEqual(
    reconcileCash({openingCash:0,cashSales,countedCash:cashSales}),
    {openingCash:0,cashSales,cashIn:0,cashPaidOut:0,cashOut:0,expectedCash:cashSales,countedCash:cashSales,cashVariance:0}
  );
});

test('checkout request replay never duplicates sale, bill or stock deduction',async()=>{
  const db=fakeDb();
  const body={requestKey:'checkout-idempotent-001',cart,date,payment:'cash',received:100};

  const first=await checkoutPos({db,user,body,now:100});
  const afterFirst=JSON.parse(db.storage.document);
  const replay=await checkoutPos({db,user,body,now:200});
  const afterReplay=JSON.parse(db.storage.document);

  assert.equal(replay.replayed,true);
  assert.equal(first.orderId,replay.orderId);
  assert.equal(afterReplay.sales.length,1);
  assert.equal(afterReplay.orders.length,1);
  assert.equal(afterReplay.ingredients.matcha.qty,afterFirst.ingredients.matcha.qty);
  assert.equal(afterReplay.ingredients.milk.qty,afterFirst.ingredients.milk.qty);
  assert.equal(afterReplay.ingredients.cup16.qty,afterFirst.ingredients.cup16.qty);
});

test('normal checkout rejects payments array and requires a split session',async()=>{
  const db=fakeDb();
  await assert.rejects(()=>checkoutPos({
    db,user,now:300,
    body:{
      requestKey:'checkout-multi-payment-001',cart,date,payment:'cash',received:100,
      payments:[{method:'cash',received:55,allocations:[{index:0,qty:1}]}]
    }
  }),error=>error?.status===409&&error?.message==='multi_payment_requires_split_session');
  const state=JSON.parse(db.storage.document);
  assert.equal(state.sales.length,0);
  assert.equal(state.ingredients.matcha.qty,1000);
});

test('split payment survives intermediate reloads and creates one sale + one queue only at completion',async()=>{
  const db=fakeDb();
  const splitCart=[{id:'matcha-latte',variant:'100%',qty:3}];

  const started=await startSplitPayment({
    db,user,now:1000,
    body:{requestKey:'split-start-001',cart:splitCart,date}
  });

  assert.equal(started.session.status,'collecting');
  assert.equal(started.session.remainingAmount,165);

  let state=JSON.parse(db.storage.document);
  assert.equal(state.sales.length,0);
  assert.equal(state.orders.length,0);
  assert.equal(state.ingredients.matcha.qty,1000-15);
  assert.equal(state.ingredients.milk.qty,30000-330);
  assert.equal(state.ingredients.cup16.qty,500-3);

  const p1=await paySplitPayment({
    db,user,now:1100,
    body:{
      requestKey:'split-pay-001',sessionId:started.session.id,
      method:'cash',received:60,allocations:[{index:0,qty:1}],label:'คนที่ 1'
    }
  });
  assert.equal(p1.completed,false);
  assert.equal(p1.session.remainingAmount,110);

  const reload1=await getSplitPaymentStatus({db,body:{sessionId:started.session.id},now:1150});
  assert.equal(reload1.session.payments.length,1);
  assert.equal(reload1.session.remainingQty[0],2);

  const p2=await paySplitPayment({
    db,user,now:1200,
    body:{
      requestKey:'split-pay-002',sessionId:started.session.id,
      method:'cash',received:60,allocations:[{index:0,qty:1}],label:'คนที่ 2'
    }
  });
  assert.equal(p2.completed,false);

  const reload2=await getSplitPaymentStatus({db,body:{sessionId:started.session.id},now:1250});
  assert.equal(reload2.session.payments.length,2);
  assert.equal(reload2.session.remainingQty[0],1);

  const p3=await paySplitPayment({
    db,user,now:1300,
    body:{
      requestKey:'split-pay-003',sessionId:started.session.id,
      method:'cash',received:60,allocations:[{index:0,qty:1}],label:'คนที่ 3'
    }
  });

  assert.equal(p3.completed,true);
  assert.ok(p3.orderId);
  assert.ok(p3.saleId);
  assert.match(p3.queueNo,/^A\d{3}$/);

  state=JSON.parse(db.storage.document);
  assert.equal(state.sales.length,1);
  assert.equal(state.orders.length,1);
  assert.equal(state.sales[0].payments.length,3);
  assert.equal(state.sales[0].total,165);
  assert.equal(state.orders[0].items[0].qty,3);

  // Reservation happened once at split start; completion must not deduct again.
  assert.equal(state.ingredients.matcha.qty,1000-15);
  assert.equal(state.ingredients.milk.qty,30000-330);
  assert.equal(state.ingredients.cup16.qty,500-3);
  assert.equal(db.storage.stockTx.length,3);
  assert.equal(db.storage.costSnapshots.length,1);
});

test('expired partial split requires admin resolution without restoring stock or releasing pager',async()=>{
  const db=fakeDb();
  const started=await startSplitPayment({db,user,now:1000,body:{requestKey:'split-expiry-start-001',cart:[{...cart[0],qty:2}],date}});
  await paySplitPayment({db,user,now:1100,body:{requestKey:'split-expiry-pay-001',sessionId:started.session.id,method:'cash',received:55,allocations:[{index:0,qty:1}]}});
  const before=JSON.parse(db.storage.document).ingredients.matcha.qty;
  const listed=await listSplitPaymentSessions({db,now:1000+(4*60*60*1000)+1});
  assert.equal(listed.sessions[0].status,'requires_resolution');
  assert.equal(JSON.parse(db.storage.document).ingredients.matcha.qty,before);
  const resumed=await resolveSplitPayment({db,user,now:20_000_000,body:{requestKey:'split-expiry-resolve-001',sessionId:started.session.id}});
  assert.equal(resumed.session.status,'collecting');
  assert.ok(resumed.session.expiresAt>20_000_000);
});


test('checkout updates CRM visits spend and loyalty points exactly once',async()=>{
  const db=fakeDb();
  const body={requestKey:'checkout-crm-001',cart,date,payment:'cash',received:100,customerId:'cus-1'};
  await checkoutPos({db,user,body,now:700});
  await checkoutPos({db,user,body,now:800});
  const state=JSON.parse(db.storage.document);
  const customer=state.customers.find(x=>x.id==='cus-1');
  assert.equal(customer.visits,1);
  assert.equal(customer.totalSpend,55);
  assert.equal(customer.points,1);
  assert.equal(customer.lastVisit,700);
});


test('cash sale void before production restores stock exactly once and preserves cost snapshot',async()=>{
  const db=fakeDb();
  await checkoutPos({db,user,now:2000,body:{requestKey:'void-sale-checkout-001',cart,date,payment:'cash',received:100}});
  let state=JSON.parse(db.storage.document),sale=state.sales[0];
  assert.equal(state.ingredients.matcha.qty,995);
  assert.equal(buildPosAvailability({menu:state.menu,ingredients:{...state.ingredients,matcha:{...state.ingredients.matcha,qty:0}}}).menu[0].available,false);
  assert.equal(db.storage.stockTx.length,3);
  assert.equal(db.storage.costSnapshots.length,1);
  const first=await voidSale({db,user,now:2100,body:{requestKey:'void-sale-0001',saleId:sale.id,reason:'mistake'}});
  const replay=await voidSale({db,user,now:2200,body:{requestKey:'void-sale-0001',saleId:sale.id,reason:'mistake'}});
  state=JSON.parse(db.storage.document);sale=state.sales[0];
  assert.equal(first.replayed,false);
  assert.equal(replay.replayed,true);
  assert.equal(sale.status,'void');
  assert.equal(state.orders[0].status,'void');
  assert.equal(state.ingredients.matcha.qty,1000);
  assert.equal(state.ingredients.milk.qty,30000);
  assert.equal(state.ingredients.cup16.qty,500);
  assert.equal(buildPosAvailability({menu:state.menu,ingredients:state.ingredients}).menu[0].available,true);
  assert.equal(db.storage.stockTx.length,6);
  assert.equal(db.storage.costSnapshots.length,1);
  assert.equal(db.storage.stockTx.filter(args=>args[2]==='VOID_REVERSAL').length,3);
});

test('void reverses CRM once and restores previous last visit',async()=>{
  const db=fakeDb();
  const first=await checkoutPos({db,user,now:1000,body:{requestKey:'crm-void-first-001',cart,date,payment:'cash',received:100,customerId:'cus-1'}});
  await queuePosAction({db,user,now:1010,body:{requestKey:'crm-first-start',action:'start',orderId:first.orderId,itemIndex:0,unit:1}});
  await queuePosAction({db,user,now:1020,body:{requestKey:'crm-first-call',action:'call',orderId:first.orderId}});
  await queuePosAction({db,user,now:1030,body:{requestKey:'crm-first-return',action:'return',orderId:first.orderId}});
  const second=await checkoutPos({db,user,now:2000,body:{requestKey:'crm-void-second-001',cart,date,payment:'cash',received:100,customerId:'cus-1'}});
  let state=JSON.parse(db.storage.document),sale=state.sales.find(x=>x.id===second.saleIds[0]),customer=state.customers[0];
  assert.equal(customer.visits,2);assert.equal(customer.totalSpend,110);assert.equal(customer.points,2);assert.equal(customer.lastVisit,2000);
  const body={requestKey:'crm-void-action-001',saleId:sale.id,reason:'wrong order'};
  const firstVoid=await voidSale({db,user,now:2100,body});
  const replay=await voidSale({db,user,now:2200,body});
  state=JSON.parse(db.storage.document);sale=state.sales.find(x=>x.id===second.saleIds[0]);customer=state.customers[0];
  assert.equal(firstVoid.replayed,false);assert.equal(replay.replayed,true);
  assert.equal(customer.visits,1);assert.equal(customer.totalSpend,55);assert.equal(customer.points,1);assert.equal(customer.lastVisit,1000);
  assert.equal(sale.customerEffectsReversed,true);
});

test('multi-sale cash order voids atomically before production and restores all stock once',async()=>{
  const db=fakeDb();
  const first=await checkoutPos({db,user,now:2800,body:{requestKey:'multi-void-first-001',cart,date,payment:'cash',received:100,customerId:'cus-1'}});
  await checkoutPos({db,user,now:2810,body:{requestKey:'multi-void-addon-001',cart,date,payment:'cash',received:100,customerId:'cus-1',targetOrderId:first.orderId}});
  let state=JSON.parse(db.storage.document);
  assert.equal(state.sales.length,2);
  assert.equal(state.orders.length,1);
  assert.equal(state.ingredients.matcha.qty,990);
  assert.equal(state.customers[0].visits,2);
  assert.equal(state.customers[0].totalSpend,110);

  const body={requestKey:'multi-void-order-001',saleId:first.saleIds[0],reason:'edit whole order'};
  const result=await voidSale({db,user,now:2820,body});
  assert.equal(result.voidAmount,110);
  assert.equal(result.saleIds.length,2);

  state=JSON.parse(db.storage.document);
  assert.ok(state.sales.every(s=>s.status==='void'));
  assert.ok(state.sales.every(s=>s.voidGroupAmount===110&&s.voidGroupSaleIds.length===2));
  assert.equal(state.orders[0].status,'void');
  assert.equal(state.orders[0].voidAmount,110);
  assert.equal(state.ingredients.matcha.qty,1000);
  assert.equal(state.ingredients.milk.qty,30000);
  assert.equal(state.ingredients.cup16.qty,500);
  assert.equal(state.customers[0].visits,0);
  assert.equal(state.customers[0].totalSpend,0);
  assert.equal(state.customers[0].points,0);
  assert.equal(db.storage.stockTx.filter(args=>args[2]==='VOID_REVERSAL').length,6);

  const replay=await voidSale({db,user,now:2830,body});
  assert.equal(replay.replayed,true);
  assert.equal(replay.voidAmount,110);
  assert.equal(db.storage.stockTx.filter(args=>args[2]==='VOID_REVERSAL').length,6);
});

test('multi-sale cash void fails closed when any add-on used a non-cash payment',async()=>{
  const db=fakeDb();
  const first=await checkoutPos({db,user,now:2840,body:{requestKey:'multi-void-mixed-first',cart,date,payment:'cash',received:100}});
  await checkoutPos({db,user,now:2850,body:{requestKey:'multi-void-mixed-addon',cart,date,payment:'bank',paymentReference:'bank-void-test',targetOrderId:first.orderId}});
  await assert.rejects(()=>voidSale({db,user,now:2860,body:{requestKey:'multi-void-mixed-action',saleId:first.saleIds[0],reason:'should fail'}}),/non_cash_void_requires_refund/);
  const state=JSON.parse(db.storage.document);
  assert.ok(state.sales.every(s=>s.status==='paid'));
  assert.equal(state.orders[0].status,'assigned');
  assert.equal(state.ingredients.matcha.qty,990);
  assert.equal(db.storage.stockTx.filter(args=>args[2]==='VOID_REVERSAL').length,0);
});

test('cash sale cannot auto-void after production starts',async()=>{
  const db=fakeDb();
  const checkout=await checkoutPos({db,user,now:3000,body:{requestKey:'void-start-checkout-001',cart,date,payment:'cash',received:100}});
  await queuePosAction({db,user,now:3010,body:{requestKey:'void-start-work-001',action:'start',orderId:checkout.orderId,itemIndex:0,unit:1}});
  const sale=JSON.parse(db.storage.document).sales[0];
  await assert.rejects(()=>voidSale({db,user,now:3020,body:{requestKey:'void-after-start-001',saleId:sale.id,reason:'too late'}}),/void_after_production_started/);
  const state=JSON.parse(db.storage.document);
  assert.equal(state.sales[0].status,'paid');
  assert.equal(state.ingredients.matcha.qty,995);
  assert.equal(db.storage.stockTx.length,3);
});


test('closed business day rejects new checkout without stock mutation',async()=>{
  const seed=initialState();seed.closes=[{id:'close-1',date}];
  const db=fakeDb(seed);
  await assert.rejects(()=>checkoutPos({db,user,now:4000,body:{requestKey:'closed-day-checkout-001',cart,date,payment:'cash',received:100}}),/day_closed/);
  const state=JSON.parse(db.storage.document);
  assert.equal(state.sales.length,0);
  assert.equal(state.ingredients.matcha.qty,1000);
  assert.equal(db.storage.stockTx.length,0);
});

test('closed business day rejects a new split payment reservation',async()=>{
  const seed=initialState();seed.closes=[{id:'close-1',date}];
  const db=fakeDb(seed);
  await assert.rejects(()=>startSplitPayment({db,user,now:4100,body:{requestKey:'closed-day-split-001',cart,date}}),/day_closed/);
  const state=JSON.parse(db.storage.document);
  assert.equal(state.paymentSessions.length,0);
  assert.equal(state.ingredients.matcha.qty,1000);
});


test('full cash refund reverses revenue state and CRM but never restores consumed stock',async()=>{
  const db=fakeDb();
  await checkoutPos({db,user,now:5000,body:{requestKey:'refund-cash-checkout-001',cart,date,payment:'cash',received:100,customerId:'cus-1'}});
  let state=JSON.parse(db.storage.document),sale=state.sales[0],order=state.orders[0];
  await queuePosAction({db,user,now:5050,body:{requestKey:'refund-cash-start-001',action:'start',orderId:order.id,itemIndex:0,unit:1}});
  state=JSON.parse(db.storage.document);sale=state.sales[0];
  assert.equal(state.ingredients.matcha.qty,995);
  assert.equal(state.customers[0].totalSpend,55);
  const result=await refundSale({db,user,now:5100,body:{requestKey:'refund-cash-0001',saleId:sale.id,reason:'customer complaint'}});
  state=JSON.parse(db.storage.document);sale=state.sales[0];
  assert.equal(result.refundAmount,55);
  assert.equal(sale.status,'refunded');
  assert.equal(sale.refundMethod,'cash');
  assert.equal(state.ingredients.matcha.qty,995);
  assert.equal(state.ingredients.milk.qty,29890);
  assert.equal(state.ingredients.cup16.qty,499);
  assert.equal(state.customers[0].totalSpend,0);
  assert.equal(state.customers[0].points,0);
  assert.equal(state.customers[0].visits,0);
  assert.equal(state.customers[0].lastVisit,0);
  assert.equal(sale.customerEffectsReversed,true);
  assert.equal(state.expenses.length,1);
  assert.equal(state.expenses[0].category,'WASTE');
  assert.equal(state.expenses[0].sourceType,'STOCK_REFUND_LOSS');
  assert.equal(state.expenses[0].paymentMethod,'noncash');
  assert.equal(state.expenses[0].amount,18.6);
  assert.equal(sale.refundLossExpenseId,state.expenses[0].id);
  assert.equal(db.storage.stockTx.length,3);
});

test('refund replay is idempotent',async()=>{
  const db=fakeDb();
  await checkoutPos({db,user,now:5200,body:{requestKey:'refund-replay-checkout-001',cart,date,payment:'cash',received:100}});
  let state=JSON.parse(db.storage.document),sale=state.sales[0],order=state.orders[0];
  await queuePosAction({db,user,now:5205,body:{requestKey:'refund-replay-start-001',action:'start',orderId:order.id,itemIndex:0,unit:1}});
  const body={requestKey:'refund-replay-0001',saleId:sale.id,reason:'duplicate'};
  const first=await refundSale({db,user,now:5210,body});
  const replay=await refundSale({db,user,now:5220,body});
  assert.equal(first.replayed,false);
  assert.equal(replay.replayed,true);
  assert.equal(JSON.parse(db.storage.document).sales[0].status,'refunded');
});

test('all-cash split payment can refund before production and restores reserved stock once',async()=>{
  const db=fakeDb();
  const started=await startSplitPayment({db,user,now:6000,body:{requestKey:'split-refund-cash-start',cart:[{...cart[0],qty:2}],date}});
  await paySplitPayment({db,user,now:6010,body:{requestKey:'split-refund-cash-pay1',sessionId:started.session.id,method:'cash',received:55,allocations:[{index:0,qty:1}]}});
  const completed=await paySplitPayment({db,user,now:6020,body:{requestKey:'split-refund-cash-pay2',sessionId:started.session.id,method:'cash',received:55,allocations:[{index:0,qty:1}]}});
  let state=JSON.parse(db.storage.document);
  assert.equal(state.sales[0].payment,'split');
  assert.equal(state.ingredients.matcha.qty,990);
  const refunded=await refundSale({db,user,now:6030,body:{requestKey:'split-refund-cash-full',saleId:completed.saleId,reason:'cancelled'}});
  assert.equal(refunded.refundMethod,'split_cash');
  assert.equal(refunded.stockRestored,true);
  state=JSON.parse(db.storage.document);
  assert.equal(state.sales[0].status,'refunded');
  assert.equal(state.orders[0].status,'void');
  assert.equal(state.ingredients.matcha.qty,1000);
  assert.equal(state.ingredients.milk.qty,30000);
  assert.equal(state.ingredients.cup16.qty,500);
  assert.equal(state.expenses?.filter(e=>e.sourceType==='STOCK_REFUND_LOSS').length||0,0);
  assert.equal(db.storage.stockTx.filter(args=>args[2]==='REFUND_REVERSAL').length,3);
});

test('mixed cash and PromptPay split refund requires manual PromptPay confirmation',async()=>{
  const db=fakeDb();
  const started=await startSplitPayment({db,user,now:6100,body:{requestKey:'split-refund-mixed-start',cart:[{...cart[0],qty:2}],date}});
  await paySplitPayment({db,user,now:6110,body:{requestKey:'split-refund-mixed-cash',sessionId:started.session.id,method:'cash',received:55,allocations:[{index:0,qty:1}]}});
  const completed=await paySplitPayment({db,user,now:6120,body:{requestKey:'split-refund-mixed-pp',sessionId:started.session.id,method:'promptpay',paymentReference:'pp-split-1',paymentVerified:'charge-paid',paymentProviderAmount:55,allocations:[{index:0,qty:1}]}});
  await assert.rejects(()=>refundSale({db,user,now:6130,body:{requestKey:'split-refund-mixed-no-confirm',saleId:completed.saleId}}),/promptpay_manual_refund_required/);
  const refunded=await refundSale({db,user,now:6140,body:{requestKey:'split-refund-mixed-confirm',saleId:completed.saleId,manualConfirmed:true,manualReference:'refund-bank-001',reason:'full refund'}});
  assert.equal(refunded.refundMethod,'split_manual');
  assert.equal(refunded.stockRestored,true);
  const state=JSON.parse(db.storage.document);
  assert.equal(state.sales[0].refundReference,'refund-bank-001');
  assert.deepEqual(state.sales[0].refundPayments.map(x=>x.method),['cash','promptpay']);
  assert.equal(state.ingredients.matcha.qty,1000);
});

test('multi-sale add-on order refunds atomically before production and restores all stock once',async()=>{
  const db=fakeDb();
  const first=await checkoutPos({db,user,now:6200,body:{requestKey:'multi-refund-first-001',cart,date,payment:'cash',received:100,customerId:'cus-1'}});
  const second=await checkoutPos({db,user,now:6210,body:{requestKey:'multi-refund-addon-001',cart,date,payment:'cash',received:100,customerId:'cus-1',targetOrderId:first.orderId}});
  let state=JSON.parse(db.storage.document);
  assert.equal(state.sales.length,2);
  assert.equal(state.orders.length,1);
  assert.equal(state.orders[0].saleIds.length,2);
  assert.equal(state.ingredients.matcha.qty,990);
  assert.equal(state.customers[0].visits,2);
  assert.equal(state.customers[0].totalSpend,110);

  const body={requestKey:'multi-refund-order-001',saleId:first.saleIds[0],reason:'customer cancelled whole order'};
  const refunded=await refundSale({db,user,now:6220,body});
  assert.equal(refunded.refundAmount,110);
  assert.equal(refunded.refundMethod,'multi_sale');
  assert.equal(refunded.saleIds.length,2);
  assert.equal(refunded.stockRestored,true);

  state=JSON.parse(db.storage.document);
  assert.ok(state.sales.every(s=>s.status==='refunded'));
  assert.ok(state.sales.every(s=>s.refundGroupAmount===110&&s.refundGroupSaleIds.length===2));
  assert.equal(state.orders[0].status,'void');
  assert.equal(state.orders[0].refundAmount,110);
  assert.equal(state.ingredients.matcha.qty,1000);
  assert.equal(state.ingredients.milk.qty,30000);
  assert.equal(state.ingredients.cup16.qty,500);
  assert.equal(state.customers[0].visits,0);
  assert.equal(state.customers[0].totalSpend,0);
  assert.equal(state.customers[0].points,0);
  assert.equal(state.expenses?.filter(e=>e.sourceType==='STOCK_REFUND_LOSS').length||0,0);
  assert.equal(db.storage.stockTx.filter(args=>args[2]==='REFUND_REVERSAL').length,6);

  const replay=await refundSale({db,user,now:6230,body});
  assert.equal(replay.replayed,true);
  assert.equal(replay.refundAmount,110);
  assert.equal(db.storage.stockTx.filter(args=>args[2]==='REFUND_REVERSAL').length,6);
});

test('multi-sale refund requires external confirmation when any add-on used bank transfer',async()=>{
  const db=fakeDb();
  const first=await checkoutPos({db,user,now:6240,body:{requestKey:'multi-ext-first-001',cart,date,payment:'cash',received:100}});
  await checkoutPos({db,user,now:6250,body:{requestKey:'multi-ext-addon-001',cart,date,payment:'bank',paymentReference:'bank-sale-1',targetOrderId:first.orderId}});
  const saleId=JSON.parse(db.storage.document).sales[0].id;
  await assert.rejects(()=>refundSale({db,user,now:6260,body:{requestKey:'multi-ext-refund-no-confirm',saleId,reason:'cancelled'}}),/external_manual_refund_required/);
  const refunded=await refundSale({db,user,now:6270,body:{requestKey:'multi-ext-refund-confirm',saleId,reason:'cancelled',manualConfirmed:true,manualReference:'bank-refund-1'}});
  assert.equal(refunded.refundAmount,110);
  assert.equal(refunded.stockRestored,true);
  const state=JSON.parse(db.storage.document);
  assert.ok(state.sales.every(s=>s.status==='refunded'));
  assert.equal(state.sales.find(s=>s.payment==='bank').refundReference,'bank-refund-1');
  assert.equal(state.ingredients.matcha.qty,1000);
});

test('PromptPay refund requires explicit external manual confirmation and reference',async()=>{
  const db=fakeDb();
  await checkoutPos({db,user,now:5300,body:{requestKey:'refund-pp-checkout-001',cart,date,payment:'promptpay',paymentVerified:'chrg_test_paid',paymentProviderAmount:55,paymentReference:'chrg_test_paid'}});
  const sale=JSON.parse(db.storage.document).sales[0];
  await assert.rejects(()=>refundSale({db,user,now:5310,body:{requestKey:'refund-pp-0001',saleId:sale.id}}),/promptpay_manual_refund_required/);
  const ok=await refundSale({db,user,now:5320,body:{requestKey:'refund-pp-0002',saleId:sale.id,manualConfirmed:true,manualReference:'bank-transfer-123',reason:'manual returned'}});
  assert.equal(ok.refundMethod,'manual_promptpay');
  const state=JSON.parse(db.storage.document);
  assert.equal(state.sales[0].refundReference,'bank-transfer-123');
  assert.equal(state.sales[0].refundStockRestored,true);
  assert.equal(state.ingredients.matcha.qty,1000);
  assert.equal(state.ingredients.milk.qty,30000);
  assert.equal(state.ingredients.cup16.qty,500);
  assert.equal(db.storage.stockTx.filter(args=>args[2]==='REFUND_REVERSAL').length,3);
});

test('refund is blocked after Close Day',async()=>{
  const db=fakeDb();
  await checkoutPos({db,user,now:5400,body:{requestKey:'refund-close-checkout-001',cart,date,payment:'cash',received:100}});
  const state=JSON.parse(db.storage.document),sale=state.sales[0];state.closes=[{id:'close-1',date}];db.storage.document=JSON.stringify(state);
  await assert.rejects(()=>refundSale({db,user,now:5410,body:{requestKey:'refund-close-0001',saleId:sale.id}}),/refund_closed_day/);
});


test('voided order releases its pager immediately',async()=>{
  const seed=initialState();seed.settings.pagerCount=1;const db=fakeDb(seed);
  const first=await checkoutPos({db,user,now:5500,body:{requestKey:'pager-void-checkout-001',cart,date,payment:'cash',received:100}});
  const sale=JSON.parse(db.storage.document).sales[0];
  await voidSale({db,user,now:5510,body:{requestKey:'pager-void-001',saleId:sale.id,reason:'cancel before production'}});
  const second=await checkoutPos({db,user,now:5520,body:{requestKey:'pager-void-checkout-002',cart,date,payment:'cash',received:100}});
  assert.equal(first.pager,1);
  assert.equal(second.pager,1);
});


test('cash pre-production cancellation must use void so stock is restored',async()=>{
  const db=fakeDb();
  await checkoutPos({db,user,now:5600,body:{requestKey:'refund-preprod-checkout-001',cart,date,payment:'cash',received:100}});
  const sale=JSON.parse(db.storage.document).sales[0];
  await assert.rejects(()=>refundSale({db,user,now:5610,body:{requestKey:'refund-preprod-001',saleId:sale.id,reason:'cancel'}}),/use_void_before_production/);
  const state=JSON.parse(db.storage.document);
  assert.equal(state.sales[0].status,'paid');
  assert.equal(state.ingredients.matcha.qty,995);
});

test('void cannot run on an already refunded sale',async()=>{
  const db=fakeDb();
  const checkout=await checkoutPos({db,user,now:5700,body:{requestKey:'void-after-refund-checkout-001',cart,date,payment:'cash',received:100}});
  await queuePosAction({db,user,now:5705,body:{requestKey:'void-after-refund-start-001',action:'start',orderId:checkout.orderId,itemIndex:0,unit:1}});
  const sale=JSON.parse(db.storage.document).sales[0];
  await refundSale({db,user,now:5710,body:{requestKey:'void-after-refund-001',saleId:sale.id,reason:'refund'}});
  await assert.rejects(()=>voidSale({db,user,now:5720,body:{requestKey:'void-after-refund-002',saleId:sale.id,reason:'wrong action'}}),/sale_not_voidable/);
});


test('new checkout with stale client business date is rejected without stock mutation',async()=>{
  const db=fakeDb();
  await assert.rejects(()=>checkoutPos({db,user,now:5800,body:{requestKey:'date-stale-001',cart,date,serverDate:'2026-10-02',payment:'cash',received:100}}),/business_date_changed/);
  const state=JSON.parse(db.storage.document);
  assert.equal(state.sales.length,0);
  assert.equal(state.ingredients.matcha.qty,1000);
  assert.equal(db.storage.stockTx.length,0);
});

test('idempotent replay still succeeds after server business date changes',async()=>{
  const db=fakeDb(),body={requestKey:'date-replay-001',cart,date,serverDate:date,payment:'cash',received:100};
  const first=await checkoutPos({db,user,now:5900,body});
  const replay=await checkoutPos({db,user,now:6000,body:{...body,serverDate:'2026-10-02'}});
  assert.equal(replay.replayed,true);
  assert.equal(replay.orderId,first.orderId);
  assert.equal(JSON.parse(db.storage.document).sales.length,1);
});


test('order-level pager call requires all drinks ready and completes the whole order once',async()=>{
  const db=fakeDb();
  const paid=await checkoutPos({
    db,user,now:3000,
    body:{requestKey:'queue-call-checkout-001',cart:[{...cart[0],qty:2}],date,payment:'cash',received:200}
  });
  let state=JSON.parse(db.storage.document);
  const order=state.orders.find(o=>o.id===paid.orderId);
  assert.ok(order);

  await assert.rejects(
    ()=>queuePosAction({db,user,now:3010,body:{requestKey:'queue-call-too-early-001',action:'call',orderId:order.id}}),
    e=>e?.status===409&&e?.message==='order_not_ready'
  );

  await queuePosAction({db,user,now:3020,body:{requestKey:'queue-made-001',action:'start',orderId:order.id,itemIndex:0,unit:1}});
  await queuePosAction({db,user,now:3030,body:{requestKey:'queue-made-002',action:'start',orderId:order.id,itemIndex:0,unit:2}});

  const called=await queuePosAction({
    db,user,now:3040,
    body:{requestKey:'queue-call-001',action:'call',orderId:order.id}
  });
  assert.equal(called.action,'call');

  state=JSON.parse(db.storage.document);
  const ready=state.orders.find(o=>o.id===order.id);
  assert.equal(ready.status,'ready');
  assert.equal(ready.items[0].readyQty,2);
  assert.equal(ready.items[0].calledQty,2);
  assert.equal(ready.calledAt,3040);

  const replay=await queuePosAction({
    db,user,now:3050,
    body:{requestKey:'queue-call-001',action:'call',orderId:order.id}
  });
  assert.equal(replay.replayed,true);
});

test('production and pager call both remain strict FIFO',async()=>{
  const db=fakeDb();
  const first=await checkoutPos({db,user,now:4000,body:{requestKey:'fifo-call-checkout-001',cart,date,payment:'cash',received:100}});
  const second=await checkoutPos({db,user,now:4010,body:{requestKey:'fifo-call-checkout-002',cart,date,payment:'cash',received:100}});

  await assert.rejects(
    ()=>queuePosAction({db,user,now:4020,body:{requestKey:'fifo-ready-002',action:'start',orderId:second.orderId,itemIndex:0,unit:1}}),
    e=>e?.status===409&&e?.message==='fifo_violation'
  );

  await queuePosAction({db,user,now:4040,body:{requestKey:'fifo-ready-001',action:'start',orderId:first.orderId,itemIndex:0,unit:1}});
  await queuePosAction({db,user,now:4050,body:{requestKey:'fifo-call-001',action:'call',orderId:first.orderId}});
  await queuePosAction({db,user,now:4060,body:{requestKey:'fifo-return-001',action:'return',orderId:first.orderId}});
  await queuePosAction({db,user,now:4065,body:{requestKey:'fifo-ready-002b',action:'start',orderId:second.orderId,itemIndex:0,unit:1}});
  const secondCall=await queuePosAction({db,user,now:4070,body:{requestKey:'fifo-call-002b',action:'call',orderId:second.orderId}});
  assert.equal(secondCall.action,'call');
});


test('selected production item auto-clears when its final cup is completed',async()=>{
  const db=fakeDb();
  const paid=await checkoutPos({
    db,user,now:8000,
    body:{requestKey:'guided-select-checkout-001',cart:[{...cart[0],qty:2}],date,payment:'cash',received:200}
  });
  await queuePosAction({db,user,now:8010,body:{requestKey:'guided-select-001',action:'select',orderId:paid.orderId,itemIndex:0,selected:true}});
  await queuePosAction({db,user,now:8020,body:{requestKey:'guided-done-001',action:'start',orderId:paid.orderId,itemIndex:0,unit:1}});
  let state=JSON.parse(db.storage.document),order=state.orders.find(o=>o.id===paid.orderId);
  assert.equal(order.items[0].prepSelected,true);
  await queuePosAction({db,user,now:8030,body:{requestKey:'guided-done-002',action:'start',orderId:paid.orderId,itemIndex:0,unit:2}});
  state=JSON.parse(db.storage.document);order=state.orders.find(o=>o.id===paid.orderId);
  assert.equal(order.items[0].readyQty,2);
  assert.equal(order.items[0].prepSelected,false);
});

test('first FIFO order may call a completed menu early while keeping remaining menus in production',async()=>{
  const seed=initialState();
  seed.menu.push({
    id:'pure-matcha',name:'Pure Matcha',category:'MATCHA',enabled:true,price:45,
    variants:[{label:'ไม่หวาน',recipe:{items:{matcha:4,cup16:1}}}]
  });
  const db=fakeDb(seed);
  const paid=await checkoutPos({
    db,user,now:8100,
    body:{requestKey:'partial-call-checkout-001',cart:[
      {id:'matcha-latte',variant:'100%',qty:1},
      {id:'pure-matcha',variant:'ไม่หวาน',qty:1}
    ],date,payment:'cash',received:200}
  });
  await queuePosAction({db,user,now:8110,body:{requestKey:'partial-ready-001',action:'start',orderId:paid.orderId,itemIndex:0,unit:1}});
  const early=await queuePosAction({db,user,now:8120,body:{requestKey:'partial-call-001',action:'call_item',orderId:paid.orderId,itemIndex:0}});
  assert.equal(early.action,'call_item');

  let state=JSON.parse(db.storage.document),order=state.orders.find(o=>o.id===paid.orderId);
  assert.equal(order.items[0].calledQty,1);
  assert.equal(order.items[1].calledQty||0,0);
  assert.equal(order.status,'making');

  await queuePosAction({db,user,now:8130,body:{requestKey:'partial-ready-002',action:'start',orderId:paid.orderId,itemIndex:1,unit:1}});
  const finalCall=await queuePosAction({db,user,now:8140,body:{requestKey:'partial-call-final-001',action:'call',orderId:paid.orderId}});
  assert.equal(finalCall.action,'call');
  state=JSON.parse(db.storage.document);order=state.orders.find(o=>o.id===paid.orderId);
  assert.equal(order.items[0].calledQty,1);
  assert.equal(order.items[1].calledQty,1);
  assert.equal(order.status,'ready');
});

test('later FIFO order cannot be prepared ahead for menu-level early pickup',async()=>{
  const db=fakeDb();
  const first=await checkoutPos({db,user,now:8200,body:{requestKey:'partial-fifo-checkout-001',cart,date,payment:'cash',received:100}});
  const second=await checkoutPos({db,user,now:8210,body:{requestKey:'partial-fifo-checkout-002',cart,date,payment:'cash',received:100}});
  await assert.rejects(
    ()=>queuePosAction({db,user,now:8220,body:{requestKey:'partial-fifo-ready-002',action:'start',orderId:second.orderId,itemIndex:0,unit:1}}),
    e=>e?.status===409&&e?.message==='fifo_violation'
  );
  const state=JSON.parse(db.storage.document);
  assert.equal(state.orders.find(o=>o.id===second.orderId).items[0].readyQty||0,0);
  assert.ok(first.orderId);
});


test('full PromptPay reservation deducts stock before QR payment and auto-releases after grace expiry',async()=>{
  const seed=initialState();
  seed.ingredients.matcha.qty=5;
  seed.ingredients.milk.qty=110;
  seed.ingredients.cup16.qty=1;
  const db=fakeDb(seed);
  const now=2_000_000;
  const first=await startSplitPayment({
    db,user,now,
    body:{requestKey:'promptpay-reserve-001',cart,date,mode:'promptpay_full'}
  });
  assert.equal(first.session.status,'collecting');
  assert.equal(first.session.total,55);
  let state=JSON.parse(db.storage.document);
  assert.equal(state.paymentSessions[0].mode,'promptpay_full');
  assert.equal(state.paymentSessions[0].expiresAt,now+20*60*1000);
  assert.equal(state.ingredients.matcha.qty,0);
  assert.equal(state.ingredients.milk.qty,0);
  assert.equal(state.ingredients.cup16.qty,0);

  await assert.rejects(
    ()=>startSplitPayment({db,user,now:now+1,body:{requestKey:'promptpay-reserve-002',cart,date,mode:'promptpay_full'}}),
    /stock_shortage/
  );

  await listSplitPaymentSessions({db,now:now+20*60*1000+1});
  state=JSON.parse(db.storage.document);
  assert.equal(state.ingredients.matcha.qty,5);
  assert.equal(state.ingredients.milk.qty,110);
  assert.equal(state.ingredients.cup16.qty,1);
  assert.equal(state.paymentSessions[0].status,'expired');
});


test('CRM redemption reduces cash due, awards from net spend and void restores redeemed points',async()=>{
  const seed=initialState();seed.settings.pointsRedeemValue=2;seed.customers[0].points=20;
  const db=fakeDb(seed);
  const paid=await checkoutPos({db,user,now:900,body:{requestKey:'crm-redeem-cash-001',cart,date,payment:'cash',received:50,customerId:'cus-1',pointsRedeemed:5}});
  assert.equal(paid.subtotal,55);assert.equal(paid.discountTotal,10);assert.equal(paid.total,45);
  let state=JSON.parse(db.storage.document),sale=state.sales[0],customer=state.customers[0];
  assert.equal(sale.subtotal,55);assert.equal(sale.discountTotal,10);assert.equal(sale.total,45);
  assert.equal(sale.pointsRedeemed,5);assert.equal(sale.pointsAwarded,0);
  assert.equal(customer.points,15);assert.equal(customer.totalSpend,45);assert.equal(customer.visits,1);
  await voidSale({db,user,now:950,body:{requestKey:'crm-redeem-void-001',saleId:sale.id,reason:'test'}});
  state=JSON.parse(db.storage.document);customer=state.customers[0];
  assert.equal(customer.points,20);assert.equal(customer.totalSpend,0);assert.equal(customer.visits,0);
});

test('PromptPay full reservation freezes CRM discount and provider amount at net total',async()=>{
  const seed=initialState();seed.settings.pointsRedeemValue=2;seed.customers[0].points=20;
  const db=fakeDb(seed);
  const started=await startSplitPayment({db,user,now:1000,body:{requestKey:'crm-pp-start-001',cart,date,customerId:'cus-1',pointsRedeemed:5,mode:'promptpay_full'}});
  assert.equal(started.session.subtotal,55);assert.equal(started.session.discountTotal,10);assert.equal(started.session.total,45);
  const paid=await paySplitPayment({db,user,now:1100,body:{requestKey:'crm-pp-pay-001',sessionId:started.session.id,method:'promptpay',allocations:[{index:0,qty:1}],paymentReference:'beam-test',paymentVerified:'beam-test',paymentProviderAmount:45}});
  assert.equal(paid.completed,true);
  const state=JSON.parse(db.storage.document),sale=state.sales[0],customer=state.customers[0];
  assert.equal(sale.total,45);assert.equal(sale.pointsRedeemed,5);assert.equal(customer.points,15);assert.equal(customer.totalSpend,45);
});


test('stale cash request replays before business-date validation without duplicate sale or stock deduction',async()=>{
  const db=fakeDb();
  const requestKey='stale-cash-replay-001';
  const original={requestKey,cart,date,payment:'cash',received:100,serverDate:date};
  const first=await checkoutPos({db,user,now:1000,body:original});
  const stateAfterFirst=JSON.parse(db.storage.document);
  const stockAfterFirst={
    matcha:stateAfterFirst.ingredients.matcha.qty,
    milk:stateAfterFirst.ingredients.milk.qty,
    cup16:stateAfterFirst.ingredients.cup16.qty
  };
  assert.equal(stateAfterFirst.sales.length,1);

  const replay=await checkoutPos({
    db,user,now:1000+48*60*60*1000,
    body:{...original,serverDate:'2026-10-03'}
  });
  assert.equal(replay.replayed,true);
  assert.equal(replay.orderId,first.orderId);
  assert.deepEqual(replay.saleIds,first.saleIds);

  const stateAfterReplay=JSON.parse(db.storage.document);
  assert.equal(stateAfterReplay.sales.length,1);
  assert.equal(stateAfterReplay.orders.length,1);
  assert.equal(stateAfterReplay.ingredients.matcha.qty,stockAfterFirst.matcha);
  assert.equal(stateAfterReplay.ingredients.milk.qty,stockAfterFirst.milk);
  assert.equal(stateAfterReplay.ingredients.cup16.qty,stockAfterFirst.cup16);
  assert.equal(db.storage.stockTx.filter(args=>args[5]==='sale').length,3);
});

test('unseen stale cash request is rejected on changed business date instead of creating a backdated sale',async()=>{
  const db=fakeDb();
  await assert.rejects(
    ()=>checkoutPos({
      db,user,now:1000+48*60*60*1000,
      body:{requestKey:'stale-cash-new-001',cart,date,payment:'cash',received:100,serverDate:'2026-10-03'}
    }),
    e=>e?.status===409&&e?.message==='business_date_changed'
  );
  const state=JSON.parse(db.storage.document);
  assert.equal(state.sales.length,0);
  assert.equal(state.orders.length,0);
  assert.equal(state.ingredients.matcha.qty,1000);
  assert.equal(state.ingredients.milk.qty,30000);
  assert.equal(state.ingredients.cup16.qty,500);
});


test('PromptPay charge identity is persisted on the server payment session and replays safely',async()=>{
  const db=fakeDb();
  const started=await startSplitPayment({db,user,body:{requestKey:'pp-durable-start-001',cart,date,mode:'promptpay_full'},now:7000});
  const sessionId=started.session.id;
  const attached=await attachSplitPaymentProviderCharge({db,user,body:{
    sessionId,chargeId:'ch_durable_001',provider:'beam',amount:55,currency:'THB',status:'pending',expiresAt:'2026-10-01T12:00:00Z',referenceId:sessionId
  },now:7010});
  assert.equal(attached.session.providerCharge.chargeId,'ch_durable_001');
  assert.equal(attached.session.providerCharge.amount,55);
  const ctx=await getSplitPaymentProviderContext({db,sessionId});
  assert.equal(ctx.providerCharge.chargeId,'ch_durable_001');
  const replay=await attachSplitPaymentProviderCharge({db,user,body:{
    sessionId,chargeId:'ch_durable_001',provider:'beam',amount:55,currency:'THB',status:'pending',referenceId:sessionId
  },now:7020});
  assert.equal(replay.replayed,true);
  await assert.rejects(()=>attachSplitPaymentProviderCharge({db,user,body:{
    sessionId,chargeId:'ch_other_002',provider:'beam',amount:55,currency:'THB',status:'pending',referenceId:sessionId
  },now:7030}),/promptpay_charge_already_attached/);
});

test('server charge binding rejects wrong amount or reference before persisting provider identity',async()=>{
  const db=fakeDb();
  const started=await startSplitPayment({db,user,body:{requestKey:'pp-durable-start-002',cart,date,mode:'promptpay_full'},now:7100});
  const sessionId=started.session.id;
  await assert.rejects(()=>attachSplitPaymentProviderCharge({db,user,body:{
    sessionId,chargeId:'ch_bad_amount',provider:'beam',amount:54,currency:'THB',status:'pending',referenceId:sessionId
  },now:7110}),/promptpay_amount_mismatch/);
  await assert.rejects(()=>attachSplitPaymentProviderCharge({db,user,body:{
    sessionId,chargeId:'ch_bad_ref',provider:'beam',amount:55,currency:'THB',status:'pending',referenceId:'split-wrong'
  },now:7120}),/promptpay_reference_mismatch/);
  const ctx=await getSplitPaymentProviderContext({db,sessionId});
  assert.equal(ctx.providerCharge,null);
});


test('expired PromptPay with an attached provider charge keeps stock reserved and can finalize after verified late payment',async()=>{
  const db=fakeDb();
  const now=8000;
  const started=await startSplitPayment({db,user,body:{requestKey:'pp-expiry-start-001',cart,date,mode:'promptpay_full'},now});
  const sessionId=started.session.id;
  await attachSplitPaymentProviderCharge({db,user,body:{
    sessionId,chargeId:'ch_late_paid_001',provider:'beam',amount:55,currency:'THB',status:'pending',referenceId:sessionId
  },now:now+10});
  const stockAfterReserve=JSON.parse(db.storage.document).ingredients.matcha.qty;
  const expiredAt=now+(20*60*1000)+1;
  const listed=await listSplitPaymentSessions({db,now:expiredAt});
  assert.equal(listed.sessions[0].status,'requires_resolution');
  assert.equal(JSON.parse(db.storage.document).ingredients.matcha.qty,stockAfterReserve);
  const paid=await paySplitPayment({db,user,now:expiredAt+100,body:{
    requestKey:'provider:beam:ch_late_paid_001',
    sessionId,
    method:'promptpay',
    allocations:[{index:0,qty:1}],
    paymentReference:'ch_late_paid_001',
    paymentVerified:'ch_late_paid_001',
    paymentProviderAmount:55,
    label:'PromptPay'
  }});
  assert.equal(paid.completed,true);
  const state=JSON.parse(db.storage.document);
  assert.equal(state.sales.length,1);
  assert.equal(state.sales[0].payment,'promptpay');
  assert.equal(state.ingredients.matcha.qty,stockAfterReserve);
});

test('requires-resolution session cannot be paid late with cash or with a different PromptPay charge',async()=>{
  const db=fakeDb();
  const now=9000;
  const started=await startSplitPayment({db,user,body:{requestKey:'pp-expiry-start-002',cart,date,mode:'promptpay_full'},now});
  const sessionId=started.session.id;
  await attachSplitPaymentProviderCharge({db,user,body:{
    sessionId,chargeId:'ch_late_guard_001',provider:'beam',amount:55,currency:'THB',status:'pending',referenceId:sessionId
  },now:now+10});
  await listSplitPaymentSessions({db,now:now+(20*60*1000)+1});
  await assert.rejects(()=>paySplitPayment({db,user,now:now+(20*60*1000)+2,body:{
    requestKey:'late-cash-denied-001',sessionId,method:'cash',received:55,allocations:[{index:0,qty:1}]
  }}),/split_session_unavailable/);
  await assert.rejects(()=>paySplitPayment({db,user,now:now+(20*60*1000)+3,body:{
    requestKey:'late-wrong-qr-denied-001',sessionId,method:'promptpay',allocations:[{index:0,qty:1}],
    paymentReference:'ch_wrong_999',paymentVerified:'ch_wrong_999',paymentProviderAmount:55
  }}),/split_session_unavailable/);
});


test('Beam PromptPay charge creation lock allows only the same idempotent retry for a session',async()=>{
  const db=fakeDb();
  const started=await startSplitPayment({db,user,body:{requestKey:'pp-lock-start-beam-001',cart,date,mode:'promptpay_full'},now:10000});
  const sessionId=started.session.id;
  const first=await beginSplitPaymentProviderCharge({db,user,body:{sessionId,provider:'beam',attemptKey:'promptpay:'+sessionId},now:10010});
  assert.equal(first.retryAllowed,true);
  const retry=await beginSplitPaymentProviderCharge({db,user,body:{sessionId,provider:'beam',attemptKey:'promptpay:'+sessionId},now:10020});
  assert.equal(retry.retryAllowed,true);
  await assert.rejects(()=>beginSplitPaymentProviderCharge({db,user,body:{sessionId,provider:'beam',attemptKey:'other-attempt'},now:10030}),/promptpay_charge_creation_unknown/);
});

test('non-idempotent provider charge creation fails closed after an ambiguous first attempt',async()=>{
  const db=fakeDb();
  const started=await startSplitPayment({db,user,body:{requestKey:'pp-lock-start-opn-001',cart,date,mode:'promptpay_full'},now:10100});
  const sessionId=started.session.id;
  const first=await beginSplitPaymentProviderCharge({db,user,body:{sessionId,provider:'opn',attemptKey:'promptpay:'+sessionId},now:10110});
  assert.equal(first.retryAllowed,false);
  await assert.rejects(()=>beginSplitPaymentProviderCharge({db,user,body:{sessionId,provider:'opn',attemptKey:'promptpay:'+sessionId},now:10120}),/promptpay_charge_creation_unknown/);
});

test('attached PromptPay charge makes subsequent creation attempts return the existing session binding',async()=>{
  const db=fakeDb();
  const started=await startSplitPayment({db,user,body:{requestKey:'pp-lock-start-attached-001',cart,date,mode:'promptpay_full'},now:10200});
  const sessionId=started.session.id;
  await beginSplitPaymentProviderCharge({db,user,body:{sessionId,provider:'beam',attemptKey:'promptpay:'+sessionId},now:10210});
  await attachSplitPaymentProviderCharge({db,user,body:{
    sessionId,chargeId:'ch_lock_attached_001',provider:'beam',amount:55,currency:'THB',status:'pending',referenceId:sessionId
  },now:10220});
  const again=await beginSplitPaymentProviderCharge({db,user,body:{sessionId,provider:'beam',attemptKey:'promptpay:'+sessionId},now:10230});
  assert.equal(again.attached,true);
  assert.equal(again.session.providerCharge.chargeId,'ch_lock_attached_001');
});
