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
    rows:[],audits:[],revision:0,
    document:JSON.stringify({ingredients:{matcha:{name:'Matcha',qty:1000,unit:'g',unitCost:2}}})
  };

  function executeOn(target,{sql,args=[]}){
    if(sql.startsWith('SELECT * FROM field_stock_transactions')){
      return {rows:target.rows.filter(row=>row.request_key===args[0])};
    }
    if(sql.includes('INSERT INTO field_stock_transactions')){
      target.rows.push({
        id:args[0],ingredient_id:args[1],tx_type:args[2],qty_delta:args[3],unit:args[4],
        reference_type:args[5],reference_id:args[6],request_key:args[7],reason:args[8],
        actor_id:args[9],created_at:args[10],
      });
      return {rows:[]};
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
        async execute(query){return executeOn(draft,typeof query==='string'?{sql:query,args:[]}:query)},
        async commit(){storage.rows=draft.rows;storage.audits=draft.audits;storage.revision=draft.revision;storage.document=draft.document},
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
