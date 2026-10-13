import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClient} from '@libsql/client';
import {SCHEMA} from '../lib/schema.mjs';
import {createApi} from '../lib/api.mjs';
import {digest} from '../lib/security.mjs';

async function setup(t){
  const dir=await mkdtemp(join(tmpdir(),'field-purchase-recovery-'));
  const db=createClient({url:'file:'+join(dir,'test.db')});
  t.after(async()=>{db.close();try{await rm(dir,{recursive:true,force:true})}catch(error){if(process.platform!=='win32'||error.code!=='EBUSY')throw error}});
  await db.batch(SCHEMA,'write');
  for(const [id,token,csrf] of [['owner','owner-token','owner-csrf'],['owner2','owner2-token','owner2-csrf']]){
    await db.execute({sql:"INSERT INTO field_users(id,username,password_hash,role,permissions,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",args:[id,id,'x','admin','{}',0,0]});
    await db.execute({sql:'INSERT INTO field_sessions(token_hash,user_id,csrf_token,expires_at) VALUES(?,?,?,?)',args:[digest(token),id,csrf,Date.now()+600000]});
  }
  const doc={
    ingredients:{matcha:{name:'Matcha',qty:1000,unit:'g',unitCost:.2,costStatus:'CONFIRMED',historyResetAt:0,purchaseProfile:{packageUnit:'bag',packSize:1000,packSizeUnit:'g',quantityPerPackage:1000,usageUnit:'g',conversionApproximate:false,supplier:'Supplier A',sourceUrl:'',imageUrl:'',purchaseCost:200,purchaseDate:'2026-01-01',note:'seed',paymentMethod:'bank',updatedAt:100}}},
    expenses:[{id:'exp-p1',date:'2026-01-01',time:100,category:'PURCHASE',description:'Purchase Matcha',amount:200,paymentMethod:'bank',sourceType:'STOCK_PURCHASE',purchaseRecordId:'pur-1',stockTransactionId:'stx-p1',ingredientId:'matcha',qty:1000}],
    sales:[],orders:[],closes:[],cancelledPurchases:{}
  };
  await db.execute({sql:'UPDATE field_state SET document=? WHERE singleton=1',args:[JSON.stringify(doc)]});
  await db.execute({sql:'INSERT INTO field_stock_transactions(id,ingredient_id,tx_type,qty_delta,unit,reference_type,reference_id,request_key,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',args:['stx-p1','matcha','PURCHASE',1000,'g','purchase','pur-1','seed-purchase-0001','seed','owner',100]});
  await db.execute({sql:'INSERT INTO field_purchase_records(id,stock_transaction_id,ingredient_id,supplier,purchased_at,package_qty,package_unit,quantity_received,usage_unit,total_cost,unit_cost,source_url,image_url,note,created_by,created_at,pack_size,pack_size_unit,conversion_approximate,payment_method) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',args:['pur-1','stx-p1','matcha','Supplier A','2026-01-01',1,'bag',1000,'g',200,.2,'','','seed','owner',100,1000,'g',0,'bank']});
  await db.execute({sql:'INSERT INTO field_cost_history(id,ingredient_id,purchase_record_id,unit_cost,cost_status,effective_date,source_type,supplier,package_qty,package_unit,confirmed_by,confirmed_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',args:['cost-p1','matcha','pur-1',.2,'CONFIRMED','2026-01-01','PURCHASE','Supplier A',1,'bag','owner',100,100]});
  return db;
}
function handler(db){return createApi({db,origin:'https://field.test'})}
async function call(api,{token='owner-token',csrf='owner-csrf',route,method='POST',body={}}){
  const res={writeHead(status){this.status=status},end(raw){this.body=JSON.parse(raw)}};
  await api({method,query:{route},headers:{origin:'https://field.test',cookie:'field_session='+token,'x-csrf-token':csrf},body},res);
  return res;
}
async function state(db){return JSON.parse((await db.execute('SELECT document FROM field_state WHERE singleton=1')).rows[0].document)}
async function count(db,sql,args=[]){return Number((await db.execute({sql,args})).rows[0].n)}

test('purchase edit exact replay is actor and payload bound with one accounting effect',async t=>{
  const db=await setup(t),api=handler(db);
  const body={requestKey:'purchase-edit-replay-0001',purchaseId:'pur-1',totalCost:250,purchaseDate:'2026-01-01',supplier:'Supplier B',sourceUrl:'',imageUrl:'',note:'corrected',packageQty:1,packageUnit:'bag',packSize:1000,packSizeUnit:'g',paymentMethod:'bank'};
  const first=await call(api,{route:'stock/purchases/pur-1',method:'PATCH',body});
  const replay=await call(api,{route:'stock/purchases/pur-1',method:'PATCH',body});
  const other=await call(api,{token:'owner2-token',csrf:'owner2-csrf',route:'stock/purchases/pur-1',method:'PATCH',body});
  const changed=await call(api,{route:'stock/purchases/pur-1',method:'PATCH',body:{...body,totalCost:260}});
  assert.equal(first.status,200);assert.equal(first.body.replayed,undefined);assert.equal(first.body.requestKey,body.requestKey);assert.equal(first.body.performedBy,'owner');
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.totalCost,250);
  assert.equal(other.status,409);assert.equal(other.body.error,'request_key_conflict');
  assert.equal(changed.status,409);assert.equal(changed.body.error,'request_key_conflict');
  const purchase=(await db.execute({sql:'SELECT * FROM field_purchase_records WHERE id=?',args:['pur-1']})).rows[0];
  const doc=await state(db);
  assert.equal(Number(purchase.total_cost),250);assert.equal(Number(purchase.quantity_received),1000);
  assert.equal(doc.ingredients.matcha.qty,1000);assert.equal(doc.ingredients.matcha.unitCost,.25);
  assert.equal(doc.expenses[0].amount,250);assert.equal(doc.expenses[0].paymentMethod,'bank');
  assert.equal(await count(db,"SELECT COUNT(*) AS n FROM field_audit WHERE action='stock_purchase_update'"),1);
  assert.equal(await count(db,'SELECT COUNT(*) AS n FROM field_pos_requests WHERE request_key=?',[body.requestKey]),1);
});

test('purchase cancel exact replay reverses stock and purchase spend only once',async t=>{
  const db=await setup(t),api=handler(db);
  const body={requestKey:'purchase-cancel-replay-0001',purchaseId:'pur-1',confirm:'CANCEL PURCHASE',reason:'duplicate receive'};
  const first=await call(api,{route:'stock/purchases/pur-1/cancel',body});
  const replay=await call(api,{route:'stock/purchases/pur-1/cancel',body});
  const other=await call(api,{token:'owner2-token',csrf:'owner2-csrf',route:'stock/purchases/pur-1/cancel',body});
  const changed=await call(api,{route:'stock/purchases/pur-1/cancel',body:{...body,reason:'different reason'}});
  assert.equal(first.status,200);assert.equal(first.body.requestKey,body.requestKey);assert.equal(first.body.performedBy,'owner');
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.reversalId,first.body.reversalId);
  assert.equal(other.status,409);assert.equal(other.body.error,'request_key_conflict');
  assert.equal(changed.status,409);assert.equal(changed.body.error,'request_key_conflict');
  const doc=await state(db);
  assert.equal(doc.ingredients.matcha.qty,0);assert.equal(doc.expenses.length,0);
  assert.equal(doc.cancelledPurchases['pur-1'].requestKey,body.requestKey);
  assert.equal(await count(db,"SELECT COUNT(*) AS n FROM field_stock_transactions WHERE tx_type='PURCHASE_REVERSAL'"),1);
  assert.equal(await count(db,"SELECT COUNT(*) AS n FROM field_audit WHERE action='stock_purchase_cancel'"),1);
  assert.equal(await count(db,'SELECT COUNT(*) AS n FROM field_cost_history WHERE purchase_record_id=?',['pur-1']),0);
  assert.equal(await count(db,'SELECT COUNT(*) AS n FROM field_pos_requests WHERE request_key=?',[body.requestKey]),1);
});

test('purchase edit invalid dates roll back before a later valid write',async t=>{
  const db=await setup(t),api=handler(db);
  const invalid=await call(api,{route:'stock/purchases/pur-1',method:'PATCH',body:{requestKey:'purchase-date-invalid-01',purchaseId:'pur-1',purchaseDate:'bad-date'}});
  assert.equal(invalid.status,400);assert.equal(invalid.body.error,'invalid_purchase_date');
  const valid=await call(api,{route:'stock/purchases/pur-1',method:'PATCH',body:{requestKey:'purchase-date-valid-0001',purchaseId:'pur-1',purchaseDate:'2026-01-02',totalCost:210}});
  assert.equal(valid.status,200);assert.equal(valid.body.requestKey,'purchase-date-valid-0001');
  assert.equal(await count(db,'SELECT COUNT(*) AS n FROM field_pos_requests WHERE request_key=?',['purchase-date-invalid-01']),0);
});
