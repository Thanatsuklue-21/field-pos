import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createClient} from "@libsql/client";
import {SCHEMA} from "../lib/schema.mjs";
import {createApi} from "../lib/api.mjs";
import {digest} from "../lib/security.mjs";

const origin="https://field.test";
async function setup(t){
  const dir=await mkdtemp(join(tmpdir(),"field-settlement-durable-")),db=createClient({url:"file:"+join(dir,"test.db")});
  t.after(async()=>{db.close();try{await rm(dir,{recursive:true,force:true})}catch(error){if(process.platform!=="win32"||error.code!=="EBUSY")throw error}});
  await db.batch(SCHEMA,"write");
  for(const id of ["owner","owner2"])await db.execute({sql:"INSERT INTO field_users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,0,0)",args:[id,id,"unused","admin"]});
  const doc={
    menu:[],ingredients:{},orders:[],expenses:[],closes:[],settings:{},posRequestKeys:{},deliveryReconciliations:[],
    sales:[{id:"sale-1",date:"2026-10-14",status:"paid",salesChannel:"grab",deliveryPlatform:"grab",total:100,gpFee:30,netSettlement:70,payments:[{method:"other",amount:100}]}]
  };
  await db.execute({sql:"UPDATE field_state SET document=? WHERE singleton=1",args:[JSON.stringify(doc)]});
  for(const [token,userId,csrf] of [["token-1","owner","csrf-1"],["token-2","owner2","csrf-2"]])await db.execute({sql:"INSERT INTO field_sessions VALUES(?,?,?,?)",args:[digest(token),userId,csrf,Date.now()+60000]});
  return {db,handler:createApi({db,origin})};
}
function req(route,token,csrf,body){return {method:"POST",query:{route},headers:{origin,cookie:"field_session="+token,"x-csrf-token":csrf},body}}
async function send(handler,request){const res={writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=JSON.parse(body)}};await handler(request,res);return res}
const reconcileBody=(extra={})=>({requestKey:"settlement-api-rec-01",operation:"reconcile",saleDate:"2026-10-14",platform:"grab",receivedAmount:70,receivedDate:"2026-10-15",note:"bank ref",...extra});

test("delivery reconcile exact replay creates one financial record",async t=>{
  const {db,handler}=await setup(t),body=reconcileBody();
  const first=await send(handler,req("accounting/settlements","token-1","csrf-1",body));
  assert.equal(first.status,201);assert.equal(first.body.ok,true);assert.equal(first.body.operation,"reconcile");assert.equal(first.body.performedBy,"owner");
  const replay=await send(handler,req("accounting/settlements","token-1","csrf-1",body));
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.reconciliation.id,first.body.reconciliation.id);

  const state=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  assert.equal(state.deliveryReconciliations.length,1);assert.equal(state.deliveryReconciliations[0].id,first.body.reconciliation.id);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_audit WHERE action='delivery_settlement_reconcile'")).rows[0].n),1);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_pos_requests WHERE request_key='settlement-api-rec-01'")).rows[0].n),1);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_state_versions WHERE action='before_delivery_reconciliation'")).rows[0].n),1);
});

test("delivery reconcile durable key rejects changed payload and another actor",async t=>{
  const {db,handler}=await setup(t),body=reconcileBody({requestKey:"settlement-api-rec-02"});
  assert.equal((await send(handler,req("accounting/settlements","token-1","csrf-1",body))).status,201);
  const changed=await send(handler,req("accounting/settlements","token-1","csrf-1",{...body,receivedAmount:69}));
  assert.equal(changed.status,409);assert.equal(changed.body.error,"request_key_conflict");
  const actor=await send(handler,req("accounting/settlements","token-2","csrf-2",body));
  assert.equal(actor.status,409);assert.equal(actor.body.error,"request_key_conflict");
  const state=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  assert.equal(state.deliveryReconciliations.length,1);
});

test("delivery settlement cancel exact replay cancels once",async t=>{
  const {db,handler}=await setup(t),createBody=reconcileBody({requestKey:"settlement-api-rec-03"});
  const created=await send(handler,req("accounting/settlements","token-1","csrf-1",createBody));
  assert.equal(created.status,201);const id=created.body.reconciliation.id;
  const body={requestKey:"settlement-api-cancel-01",operation:"cancel",settlementId:id,reason:"wrong amount"};
  const first=await send(handler,req("accounting/settlements/"+encodeURIComponent(id)+"/cancel","token-1","csrf-1",body));
  assert.equal(first.status,200);assert.equal(first.body.operation,"cancel");assert.equal(first.body.id,id);
  const replay=await send(handler,req("accounting/settlements/"+encodeURIComponent(id)+"/cancel","token-1","csrf-1",body));
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.cancelledAt,first.body.cancelledAt);

  const state=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document),rec=state.deliveryReconciliations[0];
  assert.equal(rec.cancelledAt,first.body.cancelledAt);assert.equal(rec.cancelReason,"wrong amount");
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_audit WHERE action='delivery_settlement_cancel'")).rows[0].n),1);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_pos_requests WHERE request_key='settlement-api-cancel-01'")).rows[0].n),1);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_state_versions WHERE action='before_delivery_reconciliation_cancel'")).rows[0].n),1);
});

test("settlement writes require request identity",async t=>{
  const {handler}=await setup(t);
  const create=await send(handler,req("accounting/settlements","token-1","csrf-1",{saleDate:"2026-10-14",platform:"grab",receivedAmount:70,receivedDate:"2026-10-15",note:""}));
  assert.equal(create.status,400);assert.equal(create.body.error,"invalid_request_key");
  const prepared=await send(handler,req("accounting/settlements","token-1","csrf-1",reconcileBody({requestKey:"settlement-api-rec-04"})));
  const id=prepared.body.reconciliation.id;
  const cancel=await send(handler,req("accounting/settlements/"+encodeURIComponent(id)+"/cancel","token-1","csrf-1",{reason:"wrong amount"}));
  assert.equal(cancel.status,400);assert.equal(cancel.body.error,"invalid_request_key");
});
