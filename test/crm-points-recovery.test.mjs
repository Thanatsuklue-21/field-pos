import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createClient} from "@libsql/client";
import {SCHEMA} from "../lib/schema.mjs";
import {createApi} from "../lib/api.mjs";
import {digest} from "../lib/security.mjs";
import {validateCrmPointsAck,validatePendingCrmPoints} from "../lib/crm-points-recovery.mjs";

const origin="https://field.test";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

async function setup(t){
  const dir=await mkdtemp(join(tmpdir(),"field-crm-points-"));
  const db=createClient({url:"file:"+join(dir,"test.db")});
  t.after(async()=>{db.close();try{await rm(dir,{recursive:true,force:true})}catch(error){if(process.platform!=="win32"||error.code!=="EBUSY")throw error}});
  await db.batch(SCHEMA,"write");
  await db.execute({sql:"INSERT INTO field_users(id,username,password_hash,role,created_at,updated_at) VALUES('owner','owner','unused','admin',0,0)",args:[]});
  await db.execute({sql:"UPDATE field_state SET document=? WHERE singleton=1",args:[JSON.stringify({menu:[],ingredients:{},sales:[],orders:[],customers:[{id:"c1",name:"Test",phone:"",lineId:"",points:5,visits:0,totalSpend:0,lastVisit:0}]})]});
  const token="crm-points-token";
  await db.execute({sql:"INSERT INTO field_sessions VALUES(?,?,?,?)",args:[digest(token),"owner","csrf",Date.now()+60000]});
  return {db,token,handler:createApi({db,origin})};
}
async function send(handler,token,body){
  const res={writeHead(status,headers){this.status=status;this.headers=headers},end(payload){this.body=JSON.parse(payload)}};
  await handler({method:"PATCH",query:{route:"customers/c1"},headers:{origin,cookie:"field_session="+token,"x-csrf-token":"csrf"},body},res);
  return res;
}

test("manual loyalty points exact request replays without double apply",async t=>{
  const {db,token,handler}=await setup(t);
  const body={requestKey:"crm-points-0001",expectedPoints:5,pointsSet:6};
  const first=await send(handler,token,body);
  assert.equal(first.status,200);assert.equal(first.body.replayed,false);assert.equal(first.body.customer.points,6);
  const replay=await send(handler,token,body);
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.customer.points,6);
  const doc=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  assert.equal(doc.customers[0].points,6);
});

test("manual loyalty points fail closed on stale expected balance",async t=>{
  const {token,handler}=await setup(t);
  const stale=await send(handler,token,{requestKey:"crm-points-0002",expectedPoints:4,pointsSet:5});
  assert.equal(stale.status,409);assert.equal(stale.body.error,"points_conflict");assert.equal(stale.body.currentPoints,5);
});

test("manual loyalty points reject conflicting request key reuse",async t=>{
  const {token,handler}=await setup(t);
  assert.equal((await send(handler,token,{requestKey:"crm-points-0003",expectedPoints:5,pointsSet:6})).status,200);
  const conflict=await send(handler,token,{requestKey:"crm-points-0003",expectedPoints:5,pointsSet:7});
  assert.equal(conflict.status,409);assert.equal(conflict.body.error,"request_key_conflict");
});

test("legacy pointsDelta mutation is fail-closed",async t=>{
  const {token,handler}=await setup(t);
  const legacy=await send(handler,token,{pointsDelta:1});
  assert.equal(legacy.status,409);assert.equal(legacy.body.error,"points_update_requires_cas");
});

test("CRM points recovery validates exact point identity",()=>{
  const pending={customerId:"c1",body:{requestKey:"crm-points-0004",expectedPoints:5,pointsSet:6},createdAt:1};
  assert.equal(validatePendingCrmPoints(pending),pending);
  const ack={ok:true,requestKey:"crm-points-0004",previousPoints:5,pointsSet:6,customer:{id:"c1",points:6}};
  assert.equal(validateCrmPointsAck(ack,pending),ack);
  assert.throws(()=>validateCrmPointsAck({...ack,pointsSet:7},pending),/crm_points_unconfirmed/);
});

test("Customers UI persists exact point request before send and recovers on reconnect",async()=>{
  const ui=await read("app/customers/page.tsx");
  const start=ui.indexOf("async function sendPoints");
  const end=ui.indexOf("useEffect(()=>",start);
  const block=ui.slice(start,end);
  assert.match(block,/pendingWrite\(pending\)/);
  assert.match(block,/JSON\.stringify\(exact\.body\)/);
  assert.match(block,/validateCrmPointsAck\(r,exact\)/);
  assert.ok(block.indexOf("pendingWrite(pending)")<block.indexOf('api<any>("/api/customers/"'));
  assert.ok(block.indexOf("validateCrmPointsAck(r,exact)")<block.indexOf("pendingClear()"));
  assert.match(ui,/window\.addEventListener\("online",onOnline\)/);
  assert.match(ui,/window\.addEventListener\("focus",onFocus\)/);
  assert.match(ui,/expectedPoints:expected,pointsSet:target/);
});
