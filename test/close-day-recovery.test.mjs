import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createClient} from "@libsql/client";
import {SCHEMA} from "../lib/schema.mjs";
import {createApi} from "../lib/api.mjs";
import {digest} from "../lib/security.mjs";
import {validateCloseDayAck,validatePendingCloseDay} from "../lib/close-day-recovery.mjs";

const origin="https://field.test";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

async function setup(t){
  const dir=await mkdtemp(join(tmpdir(),"field-close-day-recovery-"));
  const db=createClient({url:"file:"+join(dir,"test.db")});
  t.after(async()=>{
    db.close();
    try{await rm(dir,{recursive:true,force:true})}
    catch(error){if(process.platform!=="win32"||error.code!=="EBUSY")throw error}
  });
  await db.batch(SCHEMA,"write");
  await db.execute({sql:"INSERT INTO field_users(id,username,password_hash,role,created_at,updated_at) VALUES('owner','owner','unused','admin',0,0)",args:[]});
  await db.execute({sql:"UPDATE field_state SET document=? WHERE singleton=1",args:[JSON.stringify({menu:[],ingredients:{},sales:[],orders:[],expenses:[],paymentSessions:[],cashShifts:[],cashMovements:[],closes:[]})]});
  const token="close-day-recovery-token";
  await db.execute({sql:"INSERT INTO field_sessions VALUES(?,?,?,?)",args:[digest(token),"owner","csrf",Date.now()+60000]});
  return {db,token,handler:createApi({db,origin})};
}
async function send(handler,token,route,body){
  const res={writeHead(status,headers){this.status=status;this.headers=headers},end(payload){this.body=JSON.parse(payload)}};
  await handler({method:"POST",query:{route},headers:{origin,cookie:"field_session="+token,"x-csrf-token":"csrf"},body},res);
  return res;
}

test("Close Day requestKey replays the committed close after a lost response",async t=>{
  const {db,token,handler}=await setup(t);
  const opened=await send(handler,token,"cash-shift/open",{openingCash:500});
  assert.equal(opened.status,201);
  const body={requestKey:"close-day-0001",countedCash:500};
  const first=await send(handler,token,"close-day",body);
  assert.equal(first.status,201);
  assert.equal(first.body.replayed,false);
  assert.equal(first.body.close.requestKey,body.requestKey);

  const replay=await send(handler,token,"close-day",body);
  assert.equal(replay.status,200);
  assert.equal(replay.body.replayed,true);
  assert.equal(replay.body.close.id,first.body.close.id);

  const state=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  assert.equal(state.closes.length,1);
  assert.equal(state.closes[0].requestKey,body.requestKey);
});

test("Close Day requestKey conflict fails closed when counted cash changes",async t=>{
  const {token,handler}=await setup(t);
  await send(handler,token,"cash-shift/open",{openingCash:500});
  await send(handler,token,"close-day",{requestKey:"close-day-0002",countedCash:500});
  const conflict=await send(handler,token,"close-day",{requestKey:"close-day-0002",countedCash:499});
  assert.equal(conflict.status,409);
  assert.equal(conflict.body.error,"request_key_conflict");
});

test("legacy Close Day clients without requestKey remain compatible",async t=>{
  const {token,handler}=await setup(t);
  await send(handler,token,"cash-shift/open",{openingCash:500});
  const first=await send(handler,token,"close-day",{countedCash:500});
  assert.equal(first.status,201);
  assert.equal(first.body.close.requestKey,null);
  const second=await send(handler,token,"close-day",{countedCash:500});
  assert.equal(second.status,409);
  assert.equal(second.body.error,"day_already_closed");
});

test("Close Day local recovery validates exact mutation identity and server ack",()=>{
  const body={requestKey:"close-day-0003",date:"2026-10-12",countedCash:1234.5};
  const pending={body,createdAt:1};
  assert.equal(validatePendingCloseDay(pending),pending);
  const ack={ok:true,close:{id:"close_1",...body}};
  assert.equal(validateCloseDayAck(ack,body),ack);
  for(const bad of [
    {ok:true,close:{...ack.close,requestKey:"other-key"}},
    {ok:true,close:{...ack.close,date:"2026-10-11"}},
    {ok:true,close:{...ack.close,countedCash:1234.6}},
    {ok:false,close:ack.close}
  ]) assert.throws(()=>validateCloseDayAck(bad,body),/close_day_unconfirmed/);
  assert.throws(()=>validatePendingCloseDay({body:{...body,countedCash:1.001},createdAt:1}),/close_day_recovery_corrupt/);
});

test("Close Day UI persists request before POST and clears only after exact ack",async()=>{
  const ui=await read("app/close/page.tsx");
  const start=ui.indexOf("async function sendCloseDay");
  const end=ui.indexOf("useEffect(()=>",start);
  const block=ui.slice(start,end);
  assert.match(block,/closeDayPendingWrite\(body\)/);
  assert.match(block,/JSON\.stringify\(pending\.body\)/);
  assert.match(block,/validateCloseDayAck\(r,pending\.body\)/);
  assert.ok(block.indexOf("closeDayPendingWrite(body)")<block.indexOf('api<any>("/api/close-day"'));
  assert.ok(block.indexOf("validateCloseDayAck(r,pending.body)")<block.indexOf("closeDayPendingClear()"));
  assert.match(ui,/กู้คืนการปิดวันเดิมสำเร็จ/);
  assert.match(ui,/window\.addEventListener\("online",onOnline\)/);
});

test("Close Day gets recoverable write timeout protection",async()=>{
  const client=await read("lib/api-client.ts");
  assert.match(client,/RECOVERABLE_WRITE_PATHS[\s\S]*"\/api\/close-day"/);
});
