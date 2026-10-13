import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createClient} from "@libsql/client";
import {SCHEMA} from "../lib/schema.mjs";
import {createApi} from "../lib/api.mjs";
import {digest} from "../lib/security.mjs";
import {bangkokDate} from "../lib/time.mjs";
import {buildAccountingReconciliation} from "../lib/domain/accounting-reconciliation.mjs";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");
const origin="https://field.test";
const user={id:"owner",username:"owner",role:"admin"};

async function setup(t,doc){
  const dir=await mkdtemp(join(tmpdir(),"field-accounting-"));
  const db=createClient({url:"file:"+join(dir,"test.db")});
  t.after(async()=>{
    db.close();
    try{await rm(dir,{recursive:true,force:true})}
    catch(error){if(process.platform!=="win32"||error.code!=="EBUSY")throw error}
  });
  await db.batch(SCHEMA,"write");
  await db.execute({sql:"INSERT INTO field_users(id,username,password_hash,role,permissions,active,failed_count,locked_until,created_at,updated_at) VALUES(?,?,?,?,?,1,0,0,0,0)",args:[user.id,user.username,"unused",user.role,"{}"]});
  await db.execute({sql:"UPDATE field_state SET document=? WHERE singleton=1",args:[JSON.stringify(doc)]});
  const token="accounting-integration-token";
  await db.execute({sql:"INSERT INTO field_sessions(token_hash,user_id,csrf_token,expires_at) VALUES(?,?,?,?)",args:[digest(token),user.id,"csrf",Date.now()+60000]});
  return {db,token};
}
async function send(handler,method,route,token,body){
  const res={writeHead(status,headers){this.status=status;this.headers=headers},end(raw){this.body=JSON.parse(raw)}};
  await handler({method,query:{route},headers:{origin,cookie:"field_session="+token,"x-csrf-token":"csrf"},body},res);
  return res;
}
async function docState(db){return JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document)}

test("accounting engine accepts balanced mixed payments and rejects critical mismatch",()=>{
  const date="2026-10-13";
  const balanced=buildAccountingReconciliation({doc:{sales:[
    {id:"s1",date,status:"paid",total:80,payments:[{method:"cash",amount:80}]},
    {id:"s2",date,status:"paid",total:120,payments:[{method:"cash",amount:50},{method:"promptpay",amount:70}]}
  ],expenses:[],cashMovements:[]},date});
  assert.equal(balanced.ok,true);
  assert.equal(balanced.totals.revenue,200);
  assert.equal(balanced.totals.paymentSum,200);

  const broken=buildAccountingReconciliation({doc:{sales:[
    {id:"s1",date,status:"paid",total:100,payments:[{method:"cash",amount:80}]}
  ],expenses:[],cashMovements:[]},date});
  assert.equal(broken.ok,false);
  assert.equal(broken.level,"CRITICAL");
  assert.ok(broken.blocking.some(x=>x.code==="SALE_PAYMENT_TOTAL_MISMATCH"));
  assert.ok(broken.blocking.some(x=>x.code==="DAY_SALES_PAYMENT_MISMATCH"));
});

test("real libSQL Close Day fails closed before mutating state when accounting does not reconcile",async t=>{
  const date=bangkokDate();
  const state={
    menu:[],ingredients:{},paymentSessions:[],orders:[],expenses:[],cashMovements:[],closes:[],
    cashShifts:[{id:"shift-1",date,status:"open",openingCash:100,openedAt:Date.now(),openedBy:user.id}],
    sales:[{id:"sale-1",date,status:"paid",total:100,payments:[{method:"cash",amount:80}],items:[]}]
  };
  const {db,token}=await setup(t,state);
  const handler=createApi({db,origin});
  const res=await send(handler,"POST","close-day",token,{requestKey:"close-accounting-0001",date,countedCash:180,openingCash:100});
  assert.equal(res.status,409);
  assert.equal(res.body.error,"accounting_reconciliation_failed");
  assert.equal(res.body.level,"CRITICAL");
  assert.ok(res.body.findings.some(x=>x.code==="SALE_PAYMENT_TOTAL_MISMATCH"));
  const after=await docState(db);
  assert.equal(after.closes.length,0);
  assert.equal(after.cashShifts[0].status,"open");
});

test("real libSQL admin readiness exposes accounting evidence and cannot report full readiness on critical mismatch",async t=>{
  const date=bangkokDate();
  const state={
    menu:[],ingredients:{},paymentSessions:[],orders:[],expenses:[],cashMovements:[],closes:[],
    sales:[{id:"sale-1",date,status:"paid",total:100,payments:[{method:"cash",amount:80}],items:[]}]
  };
  const {db,token}=await setup(t,state);
  const handler=createApi({db,origin});
  const res=await send(handler,"GET","admin/readiness",token,undefined);
  assert.equal(res.status,200);
  assert.equal(res.body.accounting.ok,false);
  assert.equal(res.body.accounting.level,"CRITICAL");
  assert.equal(res.body.readyForFullOperations,false);
  assert.ok(res.body.warnings.some(x=>x.code==="accounting_reconciliation_failed"));
});

test("PWA Today workspace surfaces admin accounting readiness without creating a new mutation path",async()=>{
  const hub=await read("components/pos-operations-hub.tsx");
  assert.match(hub,/\/api\/admin\/readiness/);
  assert.match(hub,/canReadiness=session\.user\.role==="admin"/);
  assert.match(hub,/ความพร้อมระบบ/);
  assert.match(hub,/บัญชีมี Critical mismatch/);
  assert.match(hub,/ระบบบล็อก Close Day อัตโนมัติ/);
  assert.match(hub,/readiness\.accounting\?\.ok===false/);
  assert.doesNotMatch(hub,/method:"POST"[\s\S]{0,160}\/api\/admin\/readiness/);
});
