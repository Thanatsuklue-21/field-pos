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
  await db.execute({sql:"INSERT INTO field_users(id,username,password_hash,role,permissions,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",args:['owner2','owner2','x','admin','{}',0,0]});
  await db.execute({sql:"INSERT INTO field_users(id,username,password_hash,role,permissions,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",args:['staff','staff','x','staff',JSON.stringify({stock:true}),0,0]});
  const now=Date.now();
  await db.execute({sql:'INSERT INTO field_sessions(token_hash,user_id,csrf_token,expires_at) VALUES(?,?,?,?)',args:[digest('owner-token'),'owner','owner-csrf',now+600000]});
  await db.execute({sql:'INSERT INTO field_sessions(token_hash,user_id,csrf_token,expires_at) VALUES(?,?,?,?)',args:[digest('owner2-token'),'owner2','owner2-csrf',now+600000]});
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
  const approved=await call(api,{token:'owner-token',csrf:'owner-csrf',route:'stock/cycle-count/proposals/'+encodeURIComponent(id)+'/approve',body:{requestKey:'count-review-stale-0001',proposalId:id,confirm:true}});
  assert.equal(approved.status,409);assert.equal(approved.body.error,'cycle_count_proposal_stale');
  const after=await doc(db);assert.equal(after.ingredients.matcha.qty,95);
  assert.equal(after.cycleCountProposals.find(x=>x.id===id).status,'stale');
  assert.equal((await db.execute('SELECT COUNT(*) AS n FROM field_stock_transactions')).rows[0].n,0);
});

test('fresh owner approval atomically commits adjustment and audit evidence',async t=>{
  const db=await setup(t),api=handler(db);
  const proposed=await call(api,{token:'staff-token',csrf:'staff-csrf',route:'stock/cycle-count/proposals',body:{requestKey:'count-proposal-0003',counts:[{ingredientId:'matcha',countedQty:90}]}});
  const id=proposed.body.proposal.id;
  const approved=await call(api,{token:'owner-token',csrf:'owner-csrf',route:'stock/cycle-count/proposals/'+encodeURIComponent(id)+'/approve',body:{requestKey:'count-review-approve-0001',proposalId:id,confirm:true,note:'checked physically'}});
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
  const rejected=await call(api,{token:'owner-token',csrf:'owner-csrf',route:'stock/cycle-count/proposals/'+encodeURIComponent(id)+'/reject',body:{requestKey:'count-review-reject-0001',proposalId:id,reason:'please recount'}});
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
  assert.match(ui,/cycleCountProposalApprove/);
  assert.match(ui,/cycleCountProposalReject/);
  assert.match(ui,/prepareStockWriteIntent\(session\.user\.id,operation,p\.date\|\|today\(\),body\)/);
  assert.doesNotMatch(ui,/try\{await api\("\/api\/stock\/cycle-count\/proposals\/"\+encodeURIComponent\(p\.id\)\+"\/approve"/);
});


test('close-day review blocks while a same-day stock count proposal is pending',async t=>{
  const db=await setup(t),api=handler(db);
  const opened=await call(api,{token:'owner-token',csrf:'owner-csrf',route:'cash-shift/open',body:{openingCash:100}});
  assert.equal(opened.status,201);
  const proposed=await call(api,{token:'staff-token',csrf:'staff-csrf',route:'stock/cycle-count/proposals',body:{requestKey:'count-proposal-close-gate',counts:[{ingredientId:'matcha',countedQty:95}]}});
  assert.equal(proposed.status,201);
  const review=await call(api,{token:'owner-token',csrf:'owner-csrf',route:'close-day/review',body:{firstCount:100,secondCount:100}});
  assert.equal(review.status,409);
  assert.equal(review.body.error,'close_day_pending_stock_count_approval');
  assert.equal(review.body.count,1);
});

test('stock count approval and direct count cannot mutate stock after day is closed',async t=>{
  const db=await setup(t),api=handler(db);
  const proposed=await call(api,{token:'staff-token',csrf:'staff-csrf',route:'stock/cycle-count/proposals',body:{requestKey:'count-proposal-closed-day',counts:[{ingredientId:'matcha',countedQty:90}]}});
  const id=proposed.body.proposal.id;
  const state=await doc(db);
  const date=proposed.body.proposal.date;
  state.closes=[{id:'close-1',date}];
  await db.execute({sql:'UPDATE field_state SET revision=revision+1,document=? WHERE singleton=1',args:[JSON.stringify(state)]});
  const approval=await call(api,{token:'owner-token',csrf:'owner-csrf',route:'stock/cycle-count/proposals/'+encodeURIComponent(id)+'/approve',body:{requestKey:'count-review-closed-0001',proposalId:id,confirm:true}});
  assert.equal(approval.status,409);assert.equal(approval.body.error,'cycle_count_proposal_day_closed');
  const direct=await call(api,{token:'owner-token',csrf:'owner-csrf',route:'stock/cycle-count',body:{requestKey:'direct-count-closed',confirm:true,counts:[{ingredientId:'matcha',countedQty:80}]}});
  assert.equal(direct.status,409);assert.equal(direct.body.error,'day_closed');
  assert.equal((await doc(db)).ingredients.matcha.qty,100);
  assert.equal((await db.execute('SELECT COUNT(*) AS n FROM field_stock_transactions')).rows[0].n,0);
});


test('cycle count approval replay is actor and payload bound and never double-adjusts stock',async t=>{
  const db=await setup(t),api=handler(db);
  const proposed=await call(api,{token:'staff-token',csrf:'staff-csrf',route:'stock/cycle-count/proposals',body:{requestKey:'count-proposal-review-01',counts:[{ingredientId:'matcha',countedQty:90}]}});
  const id=proposed.body.proposal.id,body={requestKey:'count-review-approve-01',proposalId:id,confirm:true,note:'owner checked'};
  const first=await call(api,{token:'owner-token',csrf:'owner-csrf',route:'stock/cycle-count/proposals/'+encodeURIComponent(id)+'/approve',body});
  const replay=await call(api,{token:'owner-token',csrf:'owner-csrf',route:'stock/cycle-count/proposals/'+encodeURIComponent(id)+'/approve',body});
  const otherActor=await call(api,{token:'owner2-token',csrf:'owner2-csrf',route:'stock/cycle-count/proposals/'+encodeURIComponent(id)+'/approve',body});
  const changedPayload=await call(api,{token:'owner-token',csrf:'owner-csrf',route:'stock/cycle-count/proposals/'+encodeURIComponent(id)+'/approve',body:{...body,note:'changed note'}});
  assert.equal(first.status,200);assert.equal(first.body.outcome,'approved');assert.equal(first.body.requestKey,body.requestKey);assert.equal(first.body.performedBy,'owner');
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.outcome,'approved');
  assert.equal(otherActor.status,409);assert.equal(otherActor.body.error,'request_key_conflict');
  assert.equal(changedPayload.status,409);assert.equal(changedPayload.body.error,'request_key_conflict');
  assert.equal((await doc(db)).ingredients.matcha.qty,90);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM field_stock_transactions WHERE reference_type='CYCLE_COUNT_APPROVAL' AND reference_id=?",[id])).rows[0].n,1);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM field_audit WHERE action='cycle_count_proposal_approved'")).rows[0].n,1);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM field_pos_requests WHERE request_key=?",[body.requestKey])).rows[0].n,1);
});

test('stale cycle count approval commits terminal outcome once and exact replay recovers ACK',async t=>{
  const db=await setup(t),api=handler(db);
  const proposed=await call(api,{token:'staff-token',csrf:'staff-csrf',route:'stock/cycle-count/proposals',body:{requestKey:'count-proposal-stale-02',counts:[{ingredientId:'matcha',countedQty:90}]}});
  const id=proposed.body.proposal.id,state=await doc(db);state.ingredients.matcha.qty=95;
  await db.execute({sql:'UPDATE field_state SET revision=revision+1,document=? WHERE singleton=1',args:[JSON.stringify(state)]});
  const body={requestKey:'count-review-stale-02',proposalId:id,confirm:true,note:'owner checked'};
  const first=await call(api,{token:'owner-token',csrf:'owner-csrf',route:'stock/cycle-count/proposals/'+encodeURIComponent(id)+'/approve',body});
  const replay=await call(api,{token:'owner-token',csrf:'owner-csrf',route:'stock/cycle-count/proposals/'+encodeURIComponent(id)+'/approve',body});
  const changedPayload=await call(api,{token:'owner-token',csrf:'owner-csrf',route:'stock/cycle-count/proposals/'+encodeURIComponent(id)+'/approve',body:{...body,note:'changed'}});
  assert.equal(first.status,409);assert.equal(first.body.error,'cycle_count_proposal_stale');assert.equal(first.body.outcome,'stale');
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.outcome,'stale');assert.equal(replay.body.requestKey,body.requestKey);
  assert.equal(changedPayload.status,409);assert.equal(changedPayload.body.error,'request_key_conflict');
  const after=await doc(db);assert.equal(after.ingredients.matcha.qty,95);assert.equal(after.cycleCountProposals.find(x=>x.id===id).status,'stale');
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM field_audit WHERE action='cycle_count_proposal_stale'")).rows[0].n,1);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM field_pos_requests WHERE request_key=?",[body.requestKey])).rows[0].n,1);
});

test('cycle count rejection replay is actor and payload bound',async t=>{
  const db=await setup(t),api=handler(db);
  const proposed=await call(api,{token:'staff-token',csrf:'staff-csrf',route:'stock/cycle-count/proposals',body:{requestKey:'count-proposal-reject-02',counts:[{ingredientId:'matcha',countedQty:88}]}});
  const id=proposed.body.proposal.id,body={requestKey:'count-review-reject-02',proposalId:id,reason:'please recount'};
  const first=await call(api,{token:'owner-token',csrf:'owner-csrf',route:'stock/cycle-count/proposals/'+encodeURIComponent(id)+'/reject',body});
  const replay=await call(api,{token:'owner-token',csrf:'owner-csrf',route:'stock/cycle-count/proposals/'+encodeURIComponent(id)+'/reject',body});
  const otherActor=await call(api,{token:'owner2-token',csrf:'owner2-csrf',route:'stock/cycle-count/proposals/'+encodeURIComponent(id)+'/reject',body});
  const changedPayload=await call(api,{token:'owner-token',csrf:'owner-csrf',route:'stock/cycle-count/proposals/'+encodeURIComponent(id)+'/reject',body:{...body,reason:'different reason'}});
  assert.equal(first.status,200);assert.equal(first.body.outcome,'rejected');assert.equal(first.body.performedBy,'owner');
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.outcome,'rejected');
  assert.equal(otherActor.status,409);assert.equal(otherActor.body.error,'request_key_conflict');
  assert.equal(changedPayload.status,409);assert.equal(changedPayload.body.error,'request_key_conflict');
  assert.equal((await doc(db)).ingredients.matcha.qty,100);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM field_audit WHERE action='cycle_count_proposal_rejected'")).rows[0].n,1);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM field_pos_requests WHERE request_key=?",[body.requestKey])).rows[0].n,1);
});

test('cycle count proposal exact replay is actor and payload bound',async t=>{
  const db=await setup(t),api=handler(db);
  const body={requestKey:'count-proposal-replay-01',counts:[{ingredientId:'matcha',countedQty:91}]};
  const first=await call(api,{token:'staff-token',csrf:'staff-csrf',route:'stock/cycle-count/proposals',body});
  const replay=await call(api,{token:'staff-token',csrf:'staff-csrf',route:'stock/cycle-count/proposals',body});
  const otherActor=await call(api,{token:'owner-token',csrf:'owner-csrf',route:'stock/cycle-count/proposals',body});
  const changedPayload=await call(api,{token:'staff-token',csrf:'staff-csrf',route:'stock/cycle-count/proposals',body:{...body,counts:[{ingredientId:'matcha',countedQty:92}]}});
  assert.equal(first.status,201);
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.proposal.id,first.body.proposal.id);
  assert.equal(otherActor.status,409);assert.equal(otherActor.body.error,'request_key_conflict');
  assert.equal(changedPayload.status,409);assert.equal(changedPayload.body.error,'request_key_conflict');
  const state=await doc(db);assert.equal(state.cycleCountProposals.length,1);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM field_audit WHERE action='cycle_count_proposal'")).rows[0].n,1);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM field_pos_requests WHERE request_key=?",[body.requestKey])).rows[0].n,1);
});

test('direct owner cycle count exact replay adjusts stock and audit only once',async t=>{
  const db=await setup(t),api=handler(db);
  const body={requestKey:'direct-count-replay-01',confirm:true,counts:[{ingredientId:'matcha',countedQty:90}]};
  const first=await call(api,{token:'owner-token',csrf:'owner-csrf',route:'stock/cycle-count',body});
  const replay=await call(api,{token:'owner-token',csrf:'owner-csrf',route:'stock/cycle-count',body});
  const otherActor=await call(api,{token:'owner2-token',csrf:'owner2-csrf',route:'stock/cycle-count',body});
  const changedPayload=await call(api,{token:'owner-token',csrf:'owner-csrf',route:'stock/cycle-count',body:{...body,counts:[{ingredientId:'matcha',countedQty:89}]}});
  assert.equal(first.status,201);assert.equal(first.body.requestKey,body.requestKey);
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.cycleCount.id,first.body.cycleCount.id);
  assert.equal(otherActor.status,409);assert.equal(otherActor.body.error,'request_key_conflict');
  assert.equal(changedPayload.status,409);assert.equal(changedPayload.body.error,'request_key_conflict');
  const state=await doc(db);assert.equal(state.ingredients.matcha.qty,90);assert.equal(state.cycleCounts.length,1);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM field_stock_transactions WHERE reference_type='CYCLE_COUNT'")).rows[0].n,1);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM field_audit WHERE action='cycle_count_commit'")).rows[0].n,1);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM field_pos_requests WHERE request_key=?",[body.requestKey])).rows[0].n,1);
});
