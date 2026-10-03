import test from 'node:test';
import assert from 'node:assert/strict';
import {handleStockApi, canWriteStock} from '../lib/stock-api.mjs';

test('stock write permissions are explicit', () => {
  assert.equal(canWriteStock({role:'admin',permissions:{}}), true);
  assert.equal(canWriteStock({role:'staff',permissions:{stock:true}}), true);
  assert.equal(canWriteStock({role:'staff',permissions:{stock:false}}), false);
  assert.equal(canWriteStock(null), false);
});

function fakeDb() {
  const storage={
    rows:[],purchases:[],costHistory:[],audits:[],revision:0,
    document:JSON.stringify({ingredients:{matcha:{name:'Matcha',qty:1000,unit:'g',unitCost:2}}})
  };
  function executeOn(target,query){
    const {sql,args=[]}=typeof query==='string'?{sql:query,args:[]}:query;
    if(sql.includes('FROM field_stock_transactions t')){
      return {rows:target.rows.filter(row=>row.request_key===args[0]).map(row=>{const p=target.purchases.find(x=>x.stock_transaction_id===row.id),h=target.costHistory.find(x=>x.purchase_record_id===p?.id);return {...row,purchase_total_cost:p?.total_cost??null,purchased_at:p?.purchased_at??null,package_qty:p?.package_qty??null,package_unit:p?.package_unit??'',supplier:p?.supplier??'',source_url:p?.source_url??'',image_url:p?.image_url??'',purchase_note:p?.note??'',cost_status:h?.cost_status??null}})};
    }
    if(sql.includes('INSERT INTO field_stock_transactions')){
      target.rows.push({
        id:args[0],ingredient_id:args[1],tx_type:args[2],qty_delta:args[3],unit:args[4],
        reference_type:args[5],reference_id:args[6],request_key:args[7],reason:args[8],
        actor_id:args[9],created_at:args[10],
      });return {rows:[]};
    }
    if(sql.startsWith('INSERT INTO field_purchase_records')){target.purchases.push({id:args[0],stock_transaction_id:args[1],supplier:args[3],purchased_at:args[4],package_qty:args[5],package_unit:args[6],total_cost:args[9],source_url:args[11],image_url:args[12],note:args[13]});return {rows:[]}}
    if(sql.startsWith('INSERT INTO field_cost_history')){target.costHistory.push({id:args[0],purchase_record_id:args[2],cost_status:args[4]});return {rows:[]}}
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
        async execute(query){return executeOn(draft,query)},
        async commit(){storage.rows=draft.rows;storage.purchases=draft.purchases;storage.costHistory=draft.costHistory;storage.audits=draft.audits;storage.revision=draft.revision;storage.document=draft.document},
        async rollback(){}
      };
    },
  };
}

test('stock API creates and safely replays an idempotent write', async () => {
  const db=fakeDb();
  const user={id:'staff-1',role:'staff',permissions:{stock:true}};
  const body={
    requestKey:'purchase-1001',
    ingredientId:'matcha',
    type:'PURCHASE',
    qtyDelta:250,
    unit:'g',
  };

  const first=await handleStockApi({
    path:'/api/stock/transactions',method:'POST',user,db,body,now:100
  });
  const replay=await handleStockApi({
    path:'/api/stock/transactions',method:'POST',user,db,body,now:200
  });

  assert.equal(first.status,201);
  assert.equal(replay.status,200);
  assert.equal(replay.body.replayed,true);
  assert.equal(db.rows.length,1);
  assert.equal(db.audits.length,1);
  assert.equal(JSON.parse(db.storage.document).ingredients.matcha.qty,1250);
});

test('stock API rejects request-key reuse with a different payload', async () => {
  const db=fakeDb();
  const user={id:'admin-1',role:'admin',permissions:{}};
  const base={
    requestKey:'purchase-1002',
    ingredientId:'matcha',
    type:'PURCHASE',
    qtyDelta:250,
    unit:'g',
  };

  assert.equal((await handleStockApi({
    path:'/api/stock/transactions',method:'POST',user,db,body:base,now:100
  })).status,201);

  const conflict=await handleStockApi({
    path:'/api/stock/transactions',method:'POST',user,db,
    body:{...base,qtyDelta:500},now:200
  });

  assert.equal(conflict.status,409);
  assert.equal(conflict.body.error,'idempotency_conflict');
  assert.equal(db.rows.length,1);
});

test('stock API maps domain validation failures to HTTP 400', async () => {
  const db=fakeDb();
  const user={id:'admin-1',role:'admin',permissions:{}};

  const res=await handleStockApi({
    path:'/api/stock/transactions',
    method:'POST',
    user,
    db,
    body:{
      requestKey:'sale-10001',
      ingredientId:'matcha',
      type:'SALE',
      qtyDelta:5,
      unit:'g',
    },
    now:100,
  });

  assert.equal(res.status,400);
  assert.equal(res.body.error,'sale_must_decrease_stock');
  assert.equal(db.rows.length,0);
});

test('non-stock route is ignored by stock handler', async () => {
  const res=await handleStockApi({
    path:'/api/health',
    method:'GET',
    user:{id:'admin-1',role:'admin',permissions:{}},
    db:fakeDb(),
    body:{},
  });
  assert.equal(res,null);
});


test('stock API returns 409 when purchase date is already closed',async()=>{
  const db=fakeDb();
  const state=JSON.parse(db.storage.document);state.closes=[{id:'closed-1',date:'2026-10-01'}];db.storage.document=JSON.stringify(state);
  const res=await handleStockApi({
    path:'/api/stock/transactions',method:'POST',
    user:{id:'admin-1',role:'admin',permissions:{}},db,now:Date.parse('2026-10-03T03:00:00Z'),
    body:{requestKey:'purchase-closed-api',ingredientId:'matcha',type:'PURCHASE',qtyDelta:100,unit:'g',purchaseCost:200,purchaseDate:'2026-10-01',supplier:'Supplier A'}
  });
  assert.equal(res.status,409);
  assert.equal(res.body.error,'purchase_date_closed');
  assert.equal(db.rows.length,0);
});


test('stock API returns 409 for future purchase date',async()=>{
  const db=fakeDb();
  const res=await handleStockApi({path:'/api/stock/transactions',method:'POST',user:{id:'admin-1',role:'admin',permissions:{}},db,now:Date.parse('2026-10-03T03:00:00Z'),body:{requestKey:'purchase-future-api',ingredientId:'matcha',type:'PURCHASE',qtyDelta:100,unit:'g',purchaseCost:200,purchaseDate:'2026-10-04'}});
  assert.equal(res.status,409);assert.equal(res.body.error,'future_purchase_date');assert.equal(db.rows.length,0);
});
