import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createClient} from "@libsql/client";
import {SCHEMA} from "../lib/schema.mjs";
import {createApi} from "../lib/api.mjs";
import {digest} from "../lib/security.mjs";
import {validateCycleCountAck,validatePendingCycleCount} from "../lib/cycle-count-recovery.mjs";

const origin="https://field.test";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

async function setup(t){
  const dir=await mkdtemp(join(tmpdir(),"field-cycle-count-"));
  const db=createClient({url:"file:"+join(dir,"test.db")});
  t.after(async()=>{
    db.close();
    try{await rm(dir,{recursive:true,force:true})}
    catch(error){if(process.platform!=="win32"||error.code!=="EBUSY")throw error}
  });
  await db.batch(SCHEMA,"write");
  await db.execute({sql:"INSERT INTO field_users(id,username,password_hash,role,created_at,updated_at) VALUES('owner','owner','unused','admin',0,0)",args:[]});
  await db.execute({sql:"UPDATE field_state SET document=? WHERE singleton=1",args:[JSON.stringify({menu:[],ingredients:{matcha:{name:"Matcha",qty:100,unit:"g",unitCost:2},milk:{name:"Milk",qty:1000,unit:"ml",unitCost:.06}},sales:[],orders:[],expenses:[],closes:[]})]});
  const token="cycle-count-token";
  await db.execute({sql:"INSERT INTO field_sessions VALUES(?,?,?,?)",args:[digest(token),"owner","csrf",Date.now()+60000]});
  return {db,token,handler:createApi({db,origin})};
}
async function send(handler,token,body){
  const res={writeHead(status,headers){this.status=status;this.headers=headers},end(payload){this.body=JSON.parse(payload)}};
  await handler({method:"POST",query:{route:"stock/cycle-count"},headers:{origin,cookie:"field_session="+token,"x-csrf-token":"csrf"},body},res);
  return res;
}

test("cycle count exact request replays without duplicate count or stock adjustment",async t=>{
  const {db,token,handler}=await setup(t);
  const body={requestKey:"cycle-count-0001",confirm:true,counts:[{ingredientId:"matcha",countedQty:90},{ingredientId:"milk",countedQty:950}]};
  const first=await send(handler,token,body);
  assert.equal(first.status,201);assert.equal(first.body.requestKey,body.requestKey);
  const replay=await send(handler,token,body);
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);
  assert.equal(replay.body.cycleCount.id,first.body.cycleCount.id);
  const doc=JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document);
  assert.equal(doc.cycleCounts.length,1);
  assert.equal(doc.ingredients.matcha.qty,90);assert.equal(doc.ingredients.milk.qty,950);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_stock_transactions WHERE reference_type='CYCLE_COUNT'")).rows[0].n),2);
});

test("cycle count recovery validates exact counted quantities",()=>{
  const body={requestKey:"cycle-count-0002",confirm:true,counts:[{ingredientId:"matcha",countedQty:90},{ingredientId:"milk",countedQty:950}]};
  const pending={body,createdAt:1};
  assert.equal(validatePendingCycleCount(pending),pending);
  const ack={ok:true,requestKey:body.requestKey,cycleCount:{adjustments:[{ingredientId:"milk",countedQty:950},{ingredientId:"matcha",countedQty:90}]}};
  assert.equal(validateCycleCountAck(ack,body),ack);
  assert.throws(()=>validateCycleCountAck({...ack,requestKey:"other"},body),/cycle_count_unconfirmed/);
  assert.throws(()=>validateCycleCountAck({...ack,cycleCount:{adjustments:[{ingredientId:"matcha",countedQty:91},{ingredientId:"milk",countedQty:950}]}},body),/cycle_count_unconfirmed/);
});

test("Stock UI persists exact cycle count before send and replays it on reconnect",async()=>{
  const ui=await read("app/stock/page.tsx");
  const start=ui.indexOf("async function sendCycleCount");
  const end=ui.indexOf("useEffect(()=>",start);
  const block=ui.slice(start,end);
  assert.match(block,/cycleCountPendingWrite\(body\)/);
  assert.match(block,/JSON\.stringify\(pending\.body\)/);
  assert.match(block,/validateCycleCountAck\(r,pending\.body\)/);
  assert.ok(block.indexOf("cycleCountPendingWrite(body)")<block.indexOf('api<any>("/api/stock/cycle-count"'));
  assert.ok(block.indexOf("validateCycleCountAck(r,pending.body)")<block.indexOf("cycleCountPendingClear()"));
  assert.match(ui,/window\.addEventListener\("online",onOnline\)/);
  assert.match(ui,/cycleCountRecoveryRef/);
});

test("cycle count and stock transaction recovery are mutually exclusive",async()=>{
  const ui=await read("app/stock/page.tsx");
  const stockStart=ui.indexOf("async function sendStockTransaction");
  const stockEnd=ui.indexOf("useEffect(()=>",stockStart);
  assert.match(ui.slice(stockStart,stockEnd),/cycleCountPendingRead\(\)/);
  const cycleStart=ui.indexOf("async function sendCycleCount");
  const cycleEnd=ui.indexOf("useEffect(()=>",cycleStart);
  assert.match(ui.slice(cycleStart,cycleEnd),/stockPendingRead\(\)/);
  assert.match(ui,/cycle_count_pending/);
  assert.match(ui,/stock_transaction_pending/);
});

test("cycle count gets bounded client timeout only after durable recovery",async()=>{
  const client=await read("lib/api-client.ts");
  assert.match(client,/RECOVERABLE_WRITE_PATHS[\s\S]*"\/api\/stock\/cycle-count"/);
});
