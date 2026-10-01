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
    rows:[],audits:[],revision:0,
    document:JSON.stringify({ingredients:{matcha:{name:'Matcha',qty:1000,unit:'g',unitCost:2}}})
  };
  function executeOn(target,query){
    const {sql,args=[]}=typeof query==='string'?{sql:query,args:[]}:query;
    if(sql.startsWith('SELECT * FROM field_stock_transactions')){
      return {rows:target.rows.filter(row=>row.request_key===args[0])};
    }
    if(sql.includes('INSERT INTO field_stock_transactions')){
      target.rows.push({
        id:args[0],ingredient_id:args[1],tx_type:args[2],qty_delta:args[3],unit:args[4],
        reference_type:args[5],reference_id:args[6],request_key:args[7],reason:args[8],
        actor_id:args[9],created_at:args[10],
      });return {rows:[]};
    }
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
      const draft={rows:storage.rows.map(x=>({...x})),audits:storage.audits.map(x=>[...x]),revision:storage.revision,document:storage.document};
      return {
        async execute(query){return executeOn(draft,query)},
        async commit(){storage.rows=draft.rows;storage.audits=draft.audits;storage.revision=draft.revision;storage.document=draft.document},
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
