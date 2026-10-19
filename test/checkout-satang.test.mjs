import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClient} from '@libsql/client';
import {SCHEMA} from '../lib/schema.mjs';
import {checkoutPos,startSplitPayment,paySplitPayment} from '../lib/pos-api.mjs';
import {bangkokDate} from '../lib/time.mjs';

const user={id:'owner',role:'admin',permissions:{}};
async function setup(t){
  const dir=await mkdtemp(join(tmpdir(),'field-satang-')),db=createClient({url:'file:'+join(dir,'test.db')});
  t.after(async()=>{db.close();try{await rm(dir,{recursive:true,force:true})}catch(e){if(process.platform!=='win32'||e.code!=='EBUSY')throw e}});
  await db.batch(SCHEMA,'write');
  await db.execute("INSERT INTO field_users(id,username,password_hash,role,created_at,updated_at) VALUES('owner','owner','unused','admin',0,0)");
  const doc={menu:[{id:'tea',name:'Tea',enabled:true,price:0.1,variants:[{label:'standard',recipe:{items:{tea:1}}}]}],ingredients:{tea:{qty:100,unitCost:0.01}},settings:{pagerCount:10},sales:[],orders:[],billSeq:{},cashShifts:[{id:'shift',date:bangkokDate(),status:'open',openingCash:1}]};
  await db.execute({sql:'UPDATE field_state SET document=? WHERE singleton=1',args:[JSON.stringify(doc)]});
  return db;
}
const state=async db=>JSON.parse((await db.execute('SELECT document FROM field_state WHERE singleton=1')).rows[0].document);

test('cash change is exact satang with server prices and one replayed stock deduction',async t=>{
  const db=await setup(t),body={requestKey:'satang-checkout-01',date:bangkokDate(),cart:[{id:'tea',variant:'standard',qty:1,price:999}],payment:'cash',received:0.3};
  const first=await checkoutPos({db,user,body});
  assert.equal(first.total,0.1);assert.equal(first.change,0.2);
  const replay=await checkoutPos({db,user,body});
  assert.equal(replay.orderId,first.orderId);assert.equal(replay.replayed,true);
  const doc=await state(db);assert.equal(doc.sales.length,1);assert.equal(doc.ingredients.tea.qty,99);
});
test('split cash exact tender covers three satang-priced cups without a phantom shortage',async t=>{
  const db=await setup(t);
  const started=await startSplitPayment({db,user,body:{requestKey:'satang-split-start',date:bangkokDate(),cart:[{id:'tea',variant:'standard',qty:3}]}});
  const body={requestKey:'satang-split-pay',sessionId:started.session.id,method:'cash',received:0.3,allocations:[{index:0,qty:3}]};
  assert.equal(started.session.remainingAmount,0.3);
  const result=await paySplitPayment({db,user,body});
  assert.equal(result.session.status,'completed');assert.equal(result.session.payments[0].amount,0.3);assert.equal(result.session.payments[0].change,0);
  const replay=await paySplitPayment({db,user,body});assert.equal(replay.replayed,true);
  const doc=await state(db);assert.equal(doc.sales.length,1);assert.equal(doc.ingredients.tea.qty,97);
});
