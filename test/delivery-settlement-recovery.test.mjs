import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createClient} from "@libsql/client";
import {SCHEMA} from "../lib/schema.mjs";
import {createApi} from "../lib/api.mjs";
import {digest} from "../lib/security.mjs";
import {validatePendingSettlement,validateSettlementAck} from "../lib/settlement-recovery.mjs";

const origin="https://field.test";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

async function setup(t){
  const dir=await mkdtemp(join(tmpdir(),"field-settlement-"));
  const db=createClient({url:"file:"+join(dir,"test.db")});
  t.after(async()=>{
    db.close();
    try{await rm(dir,{recursive:true,force:true})}
    catch(error){if(process.platform!=="win32"||error.code!=="EBUSY")throw error}
  });
  await db.batch(SCHEMA,"write");
  await db.execute({sql:"INSERT INTO field_users(id,username,password_hash,role,created_at,updated_at) VALUES('owner','owner','unused','admin',0,0)",args:[]});
  const doc={
    menu:[],ingredients:{},orders:[],expenses:[],deliveryReconciliations:[],
    sales:[{id:"sale-1",date:"2026-10-12",status:"paid",salesChannel:"grab",deliveryPlatform:"grab",total:100,gpFee:30,netSettlement:70}]
  };
  await db.execute({sql:"UPDATE field_state SET document=? WHERE singleton=1",args:[JSON.stringify(doc)]});
  const token="settlement-token";
  await db.execute({sql:"INSERT INTO field_sessions VALUES(?,?,?,?)",args:[digest(token),"owner","csrf",Date.now()+60000]});
  return {db,token,handler:createApi({db,origin})};
}

async function send(handler,token,body){
  const res={writeHead(status,headers){this.status=status;this.headers=headers},end(payload){this.body=JSON.parse(payload)}};
  await handler({method:"POST",query:{route:"accounting/settlements"},headers:{origin,cookie:"field_session="+token,"x-csrf-token":"csrf"},body},res);
  return res;
}

test("delivery settlement requestKey replays the exact committed reconciliation",async t=>{
  const {db,token,handler}=await setup(t);
  const body={requestKey:"settlement-0001",saleDate:"2026-10-12",platform:"grab",receivedAmount:70,receivedDate:"2026-10-12",note:"bank ref 1"};
  const first=await send(handler,token,body);
  assert.equal(first.status,201);assert.equal(first.body.replayed,false);
  const replay=await send(handler,token,body);
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);
  assert.equal(replay.body.reconciliation.id,first.body.reconciliation.id);
  const doc=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  assert.equal(doc.deliveryReconciliations.length,1);
  assert.equal(doc.deliveryReconciliations[0].requestKey,body.requestKey);
});

test("delivery settlement requestKey conflict fails closed",async t=>{
  const {token,handler}=await setup(t);
  const base={requestKey:"settlement-0002",saleDate:"2026-10-12",platform:"grab",receivedAmount:70,receivedDate:"2026-10-12",note:"bank ref 2"};
  assert.equal((await send(handler,token,base)).status,201);
  const conflict=await send(handler,token,{...base,receivedAmount:69});
  assert.equal(conflict.status,409);assert.equal(conflict.body.error,"request_key_conflict");
});

test("settlement recovery record and ack require exact financial identity",()=>{
  const body={requestKey:"settlement-0003",saleDate:"2026-10-12",platform:"grab",receivedAmount:70,receivedDate:"2026-10-12",note:"ref"};
  const pending={body,createdAt:1};
  assert.equal(validatePendingSettlement(pending),pending);
  const ack={ok:true,reconciliation:{...body,id:"drec_1"}};
  assert.equal(validateSettlementAck(ack,body),ack);
  for(const bad of [
    {ok:true,reconciliation:{...body,requestKey:"other-key"}},
    {ok:true,reconciliation:{...body,receivedAmount:71}},
    {ok:true,reconciliation:{...body,receivedDate:"2026-10-13"}},
    {ok:false,reconciliation:{...body}}
  ]) assert.throws(()=>validateSettlementAck(bad,body),/settlement_unconfirmed/);
});

test("settlement UI persists exact request before send and replays on reconnect",async()=>{
  const ui=await read("app/settlements/page.tsx");
  const start=ui.indexOf("async function sendSettlement");
  const end=ui.indexOf("useEffect(()=>",start);
  const block=ui.slice(start,end);
  assert.match(block,/settlementPendingWrite\(body\)/);
  assert.match(block,/JSON\.stringify\(pending\.body\)/);
  assert.match(block,/validateSettlementAck\(r,pending\.body\)/);
  assert.ok(block.indexOf("settlementPendingWrite(body)")<block.indexOf('api<any>("/api/accounting/settlements"'));
  assert.ok(block.indexOf("validateSettlementAck(r,pending.body)")<block.indexOf("settlementPendingClear()"));
  assert.match(ui,/window\.addEventListener\("online",onOnline\)/);
  assert.match(ui,/window\.addEventListener\("focus",onFocus\)/);
  assert.match(ui,/visibilitychange/);
});

test("settlement write timeout is enabled only with durable recovery",async()=>{
  const client=await read("lib/api-client.ts");
  const recovery=await read("lib/settlement-recovery.mjs");
  assert.match(client,/RECOVERABLE_WRITE_PATHS[\s\S]*"\/api\/accounting\/settlements"/);
  assert.match(recovery,/SETTLEMENT_PENDING_KEY/);
  assert.match(recovery,/shouldRetainSettlementPending/);
});
