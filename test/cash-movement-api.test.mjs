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
async function setup(t){
  const dir=await mkdtemp(join(tmpdir(),"field-cashmove-")),db=createClient({url:"file:"+join(dir,"test.db")});
  t.after(async()=>{db.close();try{await rm(dir,{recursive:true,force:true})}catch(error){if(process.platform!=="win32"||error.code!=="EBUSY")throw error}});
  await db.batch(SCHEMA,"write");
  for(const id of ["owner","owner2"])await db.execute({sql:"INSERT INTO field_users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,0,0)",args:[id,id,"unused","admin"]});
  const date=bangkokDate(),doc={menu:[],ingredients:{},sales:[],orders:[],expenses:[],closes:[],cashMovements:[],cashShifts:[{id:"shift-1",date,status:"open",openingCash:1000,openedAt:1,openedBy:"owner"}],settings:{},posRequestKeys:{}};
  await db.execute({sql:"UPDATE field_state SET document=? WHERE singleton=1",args:[JSON.stringify(doc)]});
  for(const [token,userId,csrf] of [["token-1","owner","csrf-1"],["token-2","owner2","csrf-2"]])await db.execute({sql:"INSERT INTO field_sessions VALUES(?,?,?,?)",args:[digest(token),userId,csrf,Date.now()+60000]});
  return {db,date,handler:createApi({db,origin})};
}
function req(token,csrf,body){return {method:"POST",query:{route:"cash-shift/movements"},headers:{origin,cookie:"field_session="+token,"x-csrf-token":csrf},body}}
async function send(handler,request){const res={writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=JSON.parse(body)}};await handler(request,res);return res}

test("real libSQL cash movement replay creates one drawer effect and one audit row",async t=>{
  const {db,date,handler}=await setup(t),body={requestKey:"cashmove-api-0001",date,type:"CASH_OUT",amount:120,reason:"เก็บเงินส่วนเกิน",riskConfirmed:false};
  const first=await send(handler,req("token-1","csrf-1",body));
  assert.equal(first.status,201);assert.equal(first.body.ok,true);assert.equal(first.body.movement.requestKey,body.requestKey);assert.equal(first.body.availableCash,880);

  const replay=await send(handler,req("token-1","csrf-1",body));
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.movement.id,first.body.movement.id);

  const state=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  assert.equal(state.cashMovements.length,1);assert.equal(state.cashMovements[0].amount,120);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_audit WHERE action='cash_drawer_movement'")).rows[0].n),1);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_pos_requests WHERE request_key='cashmove-api-0001'")).rows[0].n),1);
});

test("cash movement durable key rejects changed payload and another actor",async t=>{
  const {db,date,handler}=await setup(t),body={requestKey:"cashmove-api-0002",date,type:"CASH_IN",amount:50,reason:"เติมเงินทอน",riskConfirmed:false};
  assert.equal((await send(handler,req("token-1","csrf-1",body))).status,201);
  const changed=await send(handler,req("token-1","csrf-1",{...body,amount:60}));
  assert.equal(changed.status,409);assert.equal(changed.body.error,"request_key_conflict");
  const actor=await send(handler,req("token-2","csrf-2",body));
  assert.equal(actor.status,409);assert.equal(actor.body.error,"request_key_conflict");
  const state=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  assert.equal(state.cashMovements.length,1);
});

test("committed cash movement can replay after the business day is later closed",async t=>{
  const {db,date,handler}=await setup(t),body={requestKey:"cashmove-api-0003",date,type:"CASH_IN",amount:40,reason:"เติมเงินทอน",riskConfirmed:false};
  const first=await send(handler,req("token-1","csrf-1",body));assert.equal(first.status,201);
  const row=(await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0],doc=JSON.parse(row.document);doc.closes=[{id:"close-1",date}];
  await db.execute({sql:"UPDATE field_state SET document=? WHERE singleton=1",args:[JSON.stringify(doc)]});
  const replay=await send(handler,req("token-1","csrf-1",body));
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.movement.id,first.body.movement.id);
});
