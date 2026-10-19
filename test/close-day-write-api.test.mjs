import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createClient} from "@libsql/client";
import {SCHEMA} from "../lib/schema.mjs";
import {createApi} from "../lib/api.mjs";
import {digest} from "../lib/security.mjs";
import {bangkokDate} from "../lib/time.mjs";

const origin="https://field.test";
test("drawer cash-out accepts exact remaining satang and rejects a true shortage",async t=>{
  const {db,handler,date}=await setup(t);
  const doc=JSON.parse((await db.execute('SELECT document FROM field_state WHERE singleton=1')).rows[0].document);
  doc.cashShifts[0].openingCash=0.3;
  doc.expenses=[{id:'satang-expense',date,amount:0.1,category:'OTHER',paymentMethod:'cash'}];
  await db.execute({sql:'UPDATE field_state SET document=? WHERE singleton=1',args:[JSON.stringify(doc)]});
  const body={requestKey:'satang-out-01',date,type:'CASH_OUT',amount:0.2,reason:'drawer transfer',riskConfirmed:true};
  const first=await send(handler,req('cash-shift/movements','token-1','csrf-1',body));
  assert.equal(first.status,201,JSON.stringify(first.body));assert.equal(first.body.availableCash,0);
  const replay=await send(handler,req('cash-shift/movements','token-1','csrf-1',body));
  assert.equal(replay.status,200);assert.equal(replay.body.movement.id,first.body.movement.id);
  const short=await send(handler,req('cash-shift/movements','token-1','csrf-1',{...body,requestKey:'satang-out-02',amount:0.01}));
  assert.equal(short.status,409);assert.equal(short.body.error,'drawer_cash_shortage');
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_audit WHERE action='cash_drawer_movement'")).rows[0].n),1);
});
test("drawer mutation ACK returns an exact satang balance",async t=>{
  const {db,handler,date}=await setup(t);
  const doc=JSON.parse((await db.execute('SELECT document FROM field_state WHERE singleton=1')).rows[0].document);
  doc.cashShifts[0].openingCash=0.1;
  await db.execute({sql:'UPDATE field_state SET document=? WHERE singleton=1',args:[JSON.stringify(doc)]});
  const response=await send(handler,req('cash-shift/movements','token-1','csrf-1',{requestKey:'satang-in-01',date,type:'CASH_IN',amount:0.2,reason:'drawer float'}));
  assert.equal(response.status,201);assert.equal(response.body.availableCash,0.3);
});
test("satang close commits without a phantom variance reason and replays once",async t=>{
  const {db,handler,date}=await setup(t);
  const doc=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  doc.cashShifts[0].openingCash=0.1;
  doc.cashMovements=[{id:'satang-in',date,type:'CASH_IN',amount:0.2,reason:'opening correction'}];
  await db.execute({sql:'UPDATE field_state SET document=? WHERE singleton=1',args:[JSON.stringify(doc)]});
  const reviewed=await send(handler,req('close-day/review','token-1','csrf-1',{requestKey:'satang-review-01',date,firstCount:0.3,secondCount:0.3}));
  assert.equal(reviewed.status,200);
  assert.equal(reviewed.body.review.variance,0);
  const body={requestKey:'satang-close-01',date,openingCash:0.1,countedCash:0.3,reviewId:reviewed.body.review.id,varianceReason:'',confirmVariance:false};
  const closed=await send(handler,req('close-day','token-1','csrf-1',body));
  assert.equal(closed.status,201,JSON.stringify(closed.body));
  assert.equal(closed.body.close.expectedCash,0.3);
  assert.equal(closed.body.close.cashVariance,0);
  const replay=await send(handler,req('close-day','token-1','csrf-1',body));
  assert.equal(replay.status,200);assert.equal(replay.body.close.id,closed.body.close.id);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_audit WHERE action='close_day'")).rows[0].n),1);
});
async function setup(t){
  const dir=await mkdtemp(join(tmpdir(),"field-close-day-durable-")),db=createClient({url:"file:"+join(dir,"test.db")});
  t.after(async()=>{db.close();try{await rm(dir,{recursive:true,force:true})}catch(error){if(process.platform!=="win32"||error.code!=="EBUSY")throw error}});
  await db.batch(SCHEMA,"write");
  for(const id of ["owner","owner2"])await db.execute({sql:"INSERT INTO field_users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,0,0)",args:[id,id,"unused","admin"]});
  const date=bangkokDate(),doc={
    menu:[],ingredients:{},sales:[],orders:[],expenses:[],closes:[],paymentSessions:[],cycleCountProposals:[],cashMovements:[],cashCloseReviews:[],
    cashShifts:[{id:"shift-1",date,status:"open",openingCash:100,openedAt:Date.now()-1000,openedBy:"owner"}],settings:{},posRequestKeys:{}
  };
  await db.execute({sql:"UPDATE field_state SET document=? WHERE singleton=1",args:[JSON.stringify(doc)]});
  for(const [token,userId,csrf] of [["token-1","owner","csrf-1"],["token-2","owner2","csrf-2"]])await db.execute({sql:"INSERT INTO field_sessions VALUES(?,?,?,?)",args:[digest(token),userId,csrf,Date.now()+60000]});
  return {db,handler:createApi({db,origin}),date};
}
function req(route,token,csrf,body){return {method:"POST",query:{route},headers:{origin,cookie:"field_session="+token,"x-csrf-token":csrf},body}}
async function send(handler,request){const res={writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=JSON.parse(body)}};await handler(request,res);return res}

test("close-day review exact replay returns one review and one audit",async t=>{
  const {db,handler,date}=await setup(t),body={requestKey:"close-api-review-01",operation:"review",date,firstCount:100,secondCount:100};
  const first=await send(handler,req("close-day/review","token-1","csrf-1",body));
  assert.equal(first.status,200);assert.equal(first.body.ok,true);assert.equal(first.body.operation,"review");assert.equal(first.body.performedBy,"owner");
  const id=first.body.review.id;
  const replay=await send(handler,req("close-day/review","token-1","csrf-1",body));
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.review.id,id);

  const state=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  assert.equal(state.cashCloseReviews.filter(x=>x.id===id).length,1);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_audit WHERE action='close_day_review'")).rows[0].n),1);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_pos_requests WHERE request_key='close-api-review-01'")).rows[0].n),1);
});

test("close-day recount mismatch is durably replayed without duplicate audit",async t=>{
  const {db,handler,date}=await setup(t),body={requestKey:"close-api-mismatch-01",operation:"review",date,firstCount:100,secondCount:90};
  const first=await send(handler,req("close-day/review","token-1","csrf-1",body));
  assert.equal(first.status,409);assert.equal(first.body.error,"cash_recount_mismatch");
  const replay=await send(handler,req("close-day/review","token-1","csrf-1",body));
  assert.equal(replay.status,409);assert.equal(replay.body.error,"cash_recount_mismatch");assert.equal(replay.body.replayed,true);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_audit WHERE action='close_day_recount_mismatch'")).rows[0].n),1);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_pos_requests WHERE request_key='close-api-mismatch-01'")).rows[0].n),1);
});

test("close-day commit exact replay returns original close after day is already closed",async t=>{
  const {db,handler,date}=await setup(t);
  const reviewBody={requestKey:"close-api-review-02",operation:"review",date,firstCount:100,secondCount:100};
  const reviewed=await send(handler,req("close-day/review","token-1","csrf-1",reviewBody));
  assert.equal(reviewed.status,200);
  const body={requestKey:"close-api-commit-01",operation:"close",date,openingCash:100,countedCash:100,reviewId:reviewed.body.review.id,varianceReason:"",confirmVariance:false};
  const first=await send(handler,req("close-day","token-1","csrf-1",body));
  assert.equal(first.status,201);assert.equal(first.body.operation,"close");const id=first.body.close.id;
  const replay=await send(handler,req("close-day","token-1","csrf-1",body));
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.close.id,id);

  const state=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  assert.equal(state.closes.length,1);assert.equal(state.closes[0].id,id);
  assert.equal(state.cashShifts[0].status,"closed");assert.equal(state.cashCloseReviews[0].status,"consumed");
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_audit WHERE action='close_day'")).rows[0].n),1);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_pos_requests WHERE request_key='close-api-commit-01'")).rows[0].n),1);
});

test("close-day durable keys reject changed payload and actor",async t=>{
  const {db,handler,date}=await setup(t),body={requestKey:"close-api-review-03",operation:"review",date,firstCount:100,secondCount:100};
  assert.equal((await send(handler,req("close-day/review","token-1","csrf-1",body))).status,200);
  const changed=await send(handler,req("close-day/review","token-1","csrf-1",{...body,firstCount:101,secondCount:101}));
  assert.equal(changed.status,409);assert.equal(changed.body.error,"request_key_conflict");
  const actor=await send(handler,req("close-day/review","token-2","csrf-2",body));
  assert.equal(actor.status,409);assert.equal(actor.body.error,"request_key_conflict");
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_audit WHERE action='close_day_review'")).rows[0].n),1);
});

test("close-day review and commit require request identity and explicit business date",async t=>{
  const {handler,date}=await setup(t);
  const noKey=await send(handler,req("close-day/review","token-1","csrf-1",{date,firstCount:100,secondCount:100}));
  assert.equal(noKey.status,400);assert.equal(noKey.body.error,"invalid_request_key");
  const noDate=await send(handler,req("close-day/review","token-1","csrf-1",{requestKey:"close-api-missing-date",firstCount:100,secondCount:100}));
  assert.equal(noDate.status,400);assert.equal(noDate.body.error,"invalid_date");
  const closeNoKey=await send(handler,req("close-day","token-1","csrf-1",{date,openingCash:100,countedCash:100,reviewId:"r1"}));
  assert.equal(closeNoKey.status,400);assert.equal(closeNoKey.body.error,"invalid_request_key");
});
