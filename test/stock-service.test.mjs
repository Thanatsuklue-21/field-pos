import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeStockWrite, recordStockTransaction} from '../lib/stock-service.mjs';

test('stock write validates transaction direction', () => {
  const base={requestKey:'req-00001',ingredientId:'matcha',unit:'g'};
  assert.throws(()=>normalizeStockWrite({...base,type:'PURCHASE',qtyDelta:-1}),/purchase_must_increase_stock/);
  assert.throws(()=>normalizeStockWrite({...base,type:'SALE',qtyDelta:1}),/sale_must_decrease_stock/);
  assert.throws(()=>normalizeStockWrite({...base,type:'WASTE',qtyDelta:1}),/waste_must_decrease_stock/);
  assert.throws(()=>normalizeStockWrite({...base,type:'VOID_REVERSAL',qtyDelta:-1}),/void_reversal_must_increase_stock/);
});

test('stock write uses server actor and timestamp', () => {
  const out=normalizeStockWrite({
    requestKey:'req-00002',
    ingredientId:'matcha',
    type:'PURCHASE',
    qtyDelta:250,
    unit:'g',
    createdAt:1,
    createdBy:'spoofed',
  },{actorId:'user-1',now:123});

  assert.equal(out.createdBy,'user-1');
  assert.equal(out.createdAt,123);
  assert.equal(out.requestKey,'req-00002');
  assert.match(out.id,/^stx_/);
});

function fakeDb() {
  const storage={
    rows:[],purchases:[],costHistory:[],audits:[],revision:0,
    document:JSON.stringify({ingredients:{matcha:{name:'Matcha',qty:1000,unit:'g',unitCost:2}}})
  };

  function executeOn(target,{sql,args=[]}){
    if(sql.includes('FROM field_stock_transactions t')){
      return {rows:target.rows.filter(row=>row.request_key===args[0]).map(row=>{const p=target.purchases.find(x=>x.stock_transaction_id===row.id),h=target.costHistory.find(x=>x.purchase_record_id===p?.id);return {...row,purchase_total_cost:p?.total_cost??null,purchased_at:p?.purchased_at??null,package_qty:p?.package_qty??null,package_unit:p?.package_unit??'',pack_size:p?.pack_size??null,pack_size_unit:p?.pack_size_unit??'',conversion_approximate:p?.conversion_approximate??0,supplier:p?.supplier??'',source_url:p?.source_url??'',image_url:p?.image_url??'',purchase_note:p?.note??'',cost_status:h?.cost_status??null}})};
    }
    if(sql.includes('INSERT INTO field_stock_transactions')){
      target.rows.push({
        id:args[0],ingredient_id:args[1],tx_type:args[2],qty_delta:args[3],unit:args[4],
        reference_type:args[5],reference_id:args[6],request_key:args[7],reason:args[8],
        actor_id:args[9],created_at:args[10],
      });
      return {rows:[]};
    }
    if(sql.startsWith('INSERT INTO field_purchase_records')){target.purchases.push({id:args[0],stock_transaction_id:args[1],supplier:args[3],purchased_at:args[4],package_qty:args[5],package_unit:args[6],total_cost:args[9],source_url:args[11],image_url:args[12],note:args[13],pack_size:args[16],pack_size_unit:args[17],conversion_approximate:args[18]});return {rows:[]}}
    if(sql.startsWith('INSERT INTO field_cost_history')){target.costHistory.push({id:args[0],purchase_record_id:args[2],unit_cost:args[3],cost_status:args[4]});return {rows:[]}}
    if(sql.startsWith('SELECT revision,document FROM field_state')){
      return {rows:[{revision:target.revision,document:target.document}]};
    }
    if(sql.startsWith('UPDATE field_state SET revision=revision+1')){
      target.revision+=1;target.document=String(args[0]);return {rowsAffected:1,rows:[]};
    }
    if(sql.startsWith('INSERT INTO field_audit')){
      target.audits.push(args);return {rows:[]};
    }
    throw new Error('Unexpected SQL: '+sql);
  }

  return {
    storage,
    get rows(){return storage.rows},
    get audits(){return storage.audits},
    async transaction(){
      const draft={rows:storage.rows.map(x=>({...x})),purchases:storage.purchases.map(x=>({...x})),costHistory:storage.costHistory.map(x=>({...x})),audits:storage.audits.map(x=>[...x]),revision:storage.revision,document:storage.document};
      return {
        async execute(query){return executeOn(draft,typeof query==='string'?{sql:query,args:[]}:query)},
        async commit(){storage.rows=draft.rows;storage.purchases=draft.purchases;storage.costHistory=draft.costHistory;storage.audits=draft.audits;storage.revision=draft.revision;storage.document=draft.document},
        async rollback(){}
      };
    },
  };
}

test('stock write is idempotent and audits only the first commit', async () => {
  const db=fakeDb();
  const input={
    requestKey:'purchase-0001',
    ingredientId:'matcha',
    type:'PURCHASE',
    qtyDelta:250,
    unit:'g',
    referenceType:'purchase',
    referenceId:'po-1',
  };

  const first=await recordStockTransaction({db,actorId:'admin-1',input,now:100});
  const second=await recordStockTransaction({db,actorId:'admin-1',input,now:200});

  assert.equal(first.status,'created');
  assert.equal(second.status,'replayed');
  assert.equal(db.rows.length,1);
  assert.equal(db.audits.length,1);
  assert.equal(JSON.parse(db.storage.document).ingredients.matcha.qty,1250);
});

test('reusing a request key with different payload is rejected', async () => {
  const db=fakeDb();
  const first={
    requestKey:'purchase-0002',
    ingredientId:'matcha',
    type:'PURCHASE',
    qtyDelta:250,
    unit:'g'
  };

  assert.equal((await recordStockTransaction({
    db,
    actorId:'admin-1',
    input:first,
    now:100
  })).status,'created');

  const conflict=await recordStockTransaction({
    db,
    actorId:'admin-1',
    now:200,
    input:{...first,qtyDelta:500},
  });

  assert.equal(conflict.status,'conflict');
  assert.equal(db.rows.length,1);
  assert.equal(db.audits.length,1);
});


test('stock waste cannot make ingredient balance negative', async () => {
  const db=fakeDb();
  await assert.rejects(()=>recordStockTransaction({
    db,actorId:'admin-1',now:300,
    input:{requestKey:'waste-0001',ingredientId:'matcha',type:'WASTE',qtyDelta:-1001,unit:'g'}
  }),/stock_shortage/);
  assert.equal(db.rows.length,0);
  assert.equal(JSON.parse(db.storage.document).ingredients.matcha.qty,1000);
});

test('stock ledger and state balance move atomically for waste', async () => {
  const db=fakeDb();
  await recordStockTransaction({
    db,actorId:'admin-1',now:400,
    input:{requestKey:'waste-0002',ingredientId:'matcha',type:'WASTE',qtyDelta:-25,unit:'g',reason:'QC'}
  });
  assert.equal(db.rows.length,1);
  assert.equal(db.rows[0].qty_delta,-25);
  assert.equal(JSON.parse(db.storage.document).ingredients.matcha.qty,975);
  assert.equal(db.storage.revision,1);
});


test('purchase cost updates unit cost and creates one expense only once', async () => {
  const db=fakeDb();
  const input={requestKey:'purchase-cost-0001',ingredientId:'matcha',type:'PURCHASE',qtyDelta:200,unit:'g',purchaseCost:400,referenceType:'purchase',referenceId:'po-cost-1'};
  const first=await recordStockTransaction({db,actorId:'admin-1',input,now:500});
  const replay=await recordStockTransaction({db,actorId:'admin-1',input,now:600});
  assert.equal(first.status,'created');
  assert.equal(replay.status,'replayed');
  const state=JSON.parse(db.storage.document);
  assert.equal(state.ingredients.matcha.qty,1200);
  assert.equal(state.ingredients.matcha.unitCost,2);
  assert.equal(state.expenses.length,1);
  assert.equal(state.expenses[0].amount,400);
  assert.equal(db.storage.costHistory.length,1);
  assert.equal(db.storage.costHistory[0].cost_status,'CONFIRMED');
});

test('purchase idempotency includes supplier package and cost evidence',async()=>{
  const db=fakeDb();
  const input={requestKey:'purchase-evidence-0001',ingredientId:'matcha',type:'PURCHASE',qtyDelta:250,unit:'g',purchaseCost:519,purchaseDate:'2026-10-02',supplier:'Supplier A',packageQty:250,packageUnit:'bag',costStatus:'CONFIRMED'};
  assert.equal((await recordStockTransaction({db,actorId:'admin-1',input,now:Date.parse('2026-10-03T03:00:00Z')})).status,'created');
  assert.equal((await recordStockTransaction({db,actorId:'admin-1',input:{...input,supplier:'Supplier B'},now:Date.parse('2026-10-03T03:01:00Z')})).status,'conflict');
  assert.equal((await recordStockTransaction({db,actorId:'admin-1',input:{...input,purchaseCost:500},now:Date.parse('2026-10-03T03:02:00Z')})).status,'conflict');
  assert.equal(db.storage.costHistory.length,1);
});


test('packaged purchase persists original package evidence and replays exactly once',async()=>{
  const db=fakeDb();
  const input={requestKey:'package-history-0001',ingredientId:'matcha',type:'PURCHASE',unit:'g',purchaseCost:398,purchaseDate:'2026-10-03',supplier:'Makro',packageQty:2,packageUnit:'ขวด',packSize:750,packSizeUnit:'ml'};
  const first=await recordStockTransaction({db,actorId:'admin-1',input,now:Date.parse('2026-10-03T03:00:00Z')});
  const replay=await recordStockTransaction({db,actorId:'admin-1',input,now:Date.parse('2026-10-03T03:01:00Z')});
  assert.equal(first.status,'created');assert.equal(replay.status,'replayed');
  assert.equal(db.storage.purchases.length,1);
  assert.equal(db.storage.purchases[0].package_qty,2);
  assert.equal(db.storage.purchases[0].package_unit,'ขวด');
  assert.equal(db.storage.purchases[0].pack_size,750);
  assert.equal(db.storage.purchases[0].pack_size_unit,'ml');
  assert.equal(db.storage.purchases[0].conversion_approximate,1);
  assert.equal(JSON.parse(db.storage.document).ingredients.matcha.qty,2500);
});


test('purchase cash-out is posted to the selected purchase date',async()=>{
  const db=fakeDb();
  await recordStockTransaction({db,actorId:'admin-1',now:Date.parse('2026-10-03T03:00:00Z'),input:{
    requestKey:'purchase-date-0001',ingredientId:'matcha',type:'PURCHASE',qtyDelta:100,unit:'g',
    purchaseCost:200,purchaseDate:'2026-10-02',supplier:'Supplier A'
  }});
  const state=JSON.parse(db.storage.document);
  assert.equal(state.expenses.length,1);
  assert.equal(state.expenses[0].date,'2026-10-02');
  assert.equal(state.expenses[0].amount,200);
});

test('purchase cannot post into an already closed purchase date and rolls back stock',async()=>{
  const db=fakeDb();
  const state=JSON.parse(db.storage.document);state.closes=[{id:'close-old',date:'2026-10-01'}];db.storage.document=JSON.stringify(state);
  await assert.rejects(()=>recordStockTransaction({db,actorId:'admin-1',now:Date.parse('2026-10-03T03:00:00Z'),input:{
    requestKey:'purchase-date-closed',ingredientId:'matcha',type:'PURCHASE',qtyDelta:100,unit:'g',
    purchaseCost:200,purchaseDate:'2026-10-01',supplier:'Supplier A'
  }}),/purchase_date_closed/);
  assert.equal(db.rows.length,0);
  assert.equal(JSON.parse(db.storage.document).ingredients.matcha.qty,1000);
  assert.equal(JSON.parse(db.storage.document).expenses?.length||0,0);
});


test('purchase rejects future business dates and impossible calendar dates',async()=>{
  const db=fakeDb(),now=Date.parse('2026-10-03T03:00:00Z');
  await assert.rejects(()=>recordStockTransaction({db,actorId:'admin-1',now,input:{requestKey:'purchase-future-0001',ingredientId:'matcha',type:'PURCHASE',qtyDelta:100,unit:'g',purchaseCost:200,purchaseDate:'2026-10-04'}}),/future_purchase_date/);
  await assert.rejects(()=>recordStockTransaction({db,actorId:'admin-1',now,input:{requestKey:'purchase-invalid-date',ingredientId:'matcha',type:'PURCHASE',qtyDelta:100,unit:'g',purchaseCost:200,purchaseDate:'2026-02-30'}}),/invalid_purchase_date/);
  assert.equal(db.rows.length,0);
  assert.equal(JSON.parse(db.storage.document).ingredients.matcha.qty,1000);
});
