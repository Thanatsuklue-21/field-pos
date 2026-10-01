import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkoutPos,queuePosAction,startSplitPayment,paySplitPayment,getSplitPaymentStatus,voidSale
} from '../lib/pos-api.mjs';

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
  const storage={revision:0,document:JSON.stringify(seed),audits:[],stockTx:[],costSnapshots:[]};

  function executeOn(target,query){
    const {sql,args=[]}=typeof query==='string'?{sql:query,args:[]}:query;
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
        costSnapshots:storage.costSnapshots.slice()
      };
      return {
        async execute(query){return executeOn(draft,query)},
        async commit(){
          storage.revision=draft.revision;
          storage.document=draft.document;
          storage.audits=draft.audits;
          storage.stockTx=draft.stockTx;
          storage.costSnapshots=draft.costSnapshots;
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
    const checkout=await checkoutPos({
      db,user,now:1_000_000+i*10,
      body:{
        requestKey:'checkout-soak-'+String(i).padStart(3,'0'),
        cart,date,payment:'cash',received:100
      }
    });

    assert.ok(checkout.orderId);
    assert.match(checkout.queueNo,/^A\d{3}$/);

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
  assert.equal(new Set(state.sales.map(s=>s.id)).size,30);
  assert.equal(new Set(state.sales.map(s=>s.billNo)).size,30);
  assert.equal(state.orders.length,30);
  assert.ok(state.orders.every(o=>o.status==='returned'));

  assert.equal(state.ingredients.matcha.qty,1000-(30*5));
  assert.equal(state.ingredients.milk.qty,30000-(30*110));
  assert.equal(state.ingredients.cup16.qty,500-30);

  assert.equal(state.billSeq[date],30);
  assert.equal(db.storage.stockTx.length,90);
  assert.equal(db.storage.costSnapshots.length,30);
  assert.ok(db.storage.stockTx.every(args=>args[2]==='SALE'&&Number(args[3])<0));
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
  assert.equal(db.storage.stockTx.length,6);
  assert.equal(db.storage.costSnapshots.length,1);
  assert.equal(db.storage.stockTx.filter(args=>args[2]==='VOID_REVERSAL').length,3);
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
