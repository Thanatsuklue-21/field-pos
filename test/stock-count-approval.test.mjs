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
  const dir=await mkdtemp(join(tmpdir(),'field-count-approval-'));
  const db=createClient({url:'file:'+join(dir,'test.db')});
  t.after(async()=>{db.close();try{await rm(dir,{recursive:true,force:true})}catch(error){if(process.platform!=='win32'||error.code!=='EBUSY')throw error}});
  await db.batch(SCHEMA,'write');
  await db.execute({sql:"INSERT INTO field_users(id,username,password_hash,role,permissions,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",args:['owner','owner','x','admin','{}',0,0]});
  await db.execute({sql:"INSERT INTO field_users(id,username,password_hash,role,permissions,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",args:['staff','staff','x','staff',JSON.stringify({stock:true}),0,0]});
  const now=Date.now();
  await db.execute({sql:'INSERT INTO field_sessions(token_hash,user_id,csrf_token,expires_at) VALUES(?,?,?,?)',args:[digest('owner-token'),'owner','owner-csrf',now+600000]});
  await db.execute({sql:'INSERT INTO field_sessions(token_hash,user_id,csrf_token,expires_at) VALUES(?,?,?,?)',args:[digest('staff-token'),'staff','staff-csrf',now+600000]});
  await db.execute({sql:'UPDATE field_state SET document=? WHERE singleton=1',args:[JSON.stringify({ingredients:{matcha:{name:'Matcha',qty:100,unit:'g'}},sales:[],orders:[],closes:[]})]});
  return db;
}
function handler(db){return createApi({db,origin:'https://field.test'})}
async function call(api,{token,csrf,route,method='POST',body={}}){
  const res={writeHead(status){this.status=status},end(raw){this.body=JSON.parse(raw)}};
  await api({method,query:{route},headers:{origin:'https://field.test',cookie:'field_session='+token,'x-csrf-token':csrf},body},res);
  return res;
}
async function doc(db){return JSON.parse((await db.execute('SELECT document FROM field_state WHERE singleton=1')).rows[0].document)}

test('staff count proposal never mutates stock before owner approval',async t=>{
  const db=await setup(t),api=handler(db);
  const res=await call(api,{token:'staff-token',csrf:'staff-csrf',route:'stock/cycle-count/proposals',body:{requestKey:'count-proposal-0001',counts:[{ingredientId:'matcha',countedQty:90}]}});
  assert.equal(res.status,201);
  assert.equal(res.body.proposal.status,'pending');
  assert.equal((await doc(db)).ingredients.matcha.qty,100);
  assert.equal((await db.execute('SELECT COUNT(*) AS n FROM field_stock_transactions')).rows[0].n,0);
});

test('owner approval rejects stale count when stock changed after employee counted',async t=>{
  const db=await setup(t),api=handler(db);
  const proposed=await call(api,{token:'staff-token',csrf:'staff-csrf',route:'stock/cycle-count/proposals',body:{requestKey:'count-proposal-0002',counts:[{ingredientId:'matcha',countedQty:90}]}});
  const id=proposed.body.proposal.id;
  const state=await doc(db);state.ingredients.matcha.qty=95;
  await db.execute({sql:'UPDATE field_state SET revision=revision+1,document=? WHERE singleton=1',args:[JSON.stringify(state)]});
  const approved=await call(api,{token:'owner-token',csrf:'owner-csrf',route:'stock/cycle-count/proposals/'+encodeURIComponent(id)+'/approve',body:{confirm:true}});
  assert.equal(approved.status,409);assert.equal(approved.body.error,'cycle_count_proposal_stale');
  const after=await doc(db);assert.equal(after.ingredients.matcha.qty,95);
  assert.equal(after.cycleCountProposals.find(x=>x.id===id).status,'stale');
  assert.equal((await db.execute('SELECT COUNT(*) AS n FROM field_stock_transactions')).rows[0].n,0);
});

test('fresh owner approval atomically commits adjustment and audit evidence',async t=>{
  const db=await setup(t),api=handler(db);
  const proposed=await call(api,{token:'staff-token',csrf:'staff-csrf',route:'stock/cycle-count/proposals',body:{requestKey:'count-proposal-0003',counts:[{ingredientId:'matcha',countedQty:90}]}});
  const id=proposed.body.proposal.id;
  const approved=await call(api,{token:'owner-token',csrf:'owner-csrf',route:'stock/cycle-count/proposals/'+encodeURIComponent(id)+'/approve',body:{confirm:true,note:'checked physically'}});
  assert.equal(approved.status,200);
  const after=await doc(db);assert.equal(after.ingredients.matcha.qty,90);
  const p=after.cycleCountProposals.find(x=>x.id===id);assert.equal(p.status,'approved');assert.equal(p.reviewedBy,'owner');
  const ledger=(await db.execute("SELECT * FROM field_stock_transactions WHERE reference_type='CYCLE_COUNT_APPROVAL'")).rows;
  assert.equal(ledger.length,1);assert.equal(Number(ledger[0].qty_delta),-10);assert.equal(ledger[0].actor_id,'owner');
  const audit=(await db.execute("SELECT action FROM field_audit WHERE action='cycle_count_proposal_approved'")).rows;
  assert.equal(audit.length,1);
});

test('staff cannot approve a proposal and owner rejection preserves stock',async t=>{
  const db=await setup(t),api=handler(db);
  const proposed=await call(api,{token:'staff-token',csrf:'staff-csrf',route:'stock/cycle-count/proposals',body:{requestKey:'count-proposal-0004',counts:[{ingredientId:'matcha',countedQty:80}]}});
  const id=proposed.body.proposal.id;
  const denied=await call(api,{token:'staff-token',csrf:'staff-csrf',route:'stock/cycle-count/proposals/'+encodeURIComponent(id)+'/approve',body:{confirm:true}});
  assert.equal(denied.status,403);assert.equal(denied.body.error,'admin_required');
  const rejected=await call(api,{token:'owner-token',csrf:'owner-csrf',route:'stock/cycle-count/proposals/'+encodeURIComponent(id)+'/reject',body:{reason:'please recount'}});
  assert.equal(rejected.status,200);
  const after=await doc(db);assert.equal(after.ingredients.matcha.qty,100);assert.equal(after.cycleCountProposals.find(x=>x.id===id).status,'rejected');
});

test('stock UI explains employee count proposal versus owner commit',async()=>{
  const {readFile}=await import('node:fs/promises');
  const ui=await readFile(new URL('../app/stock/page.tsx',import.meta.url),'utf8');
  assert.match(ui,/ส่งผลนับให้ Owner ตรวจ/);
  assert.match(ui,/Stock ยังไม่เปลี่ยนจนกว่า Owner อนุมัติ/);
  assert.match(ui,/cycle-count\/proposals/);
  assert.match(ui,/cycle_count_proposal_stale/);
});
