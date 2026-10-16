import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createClient} from "@libsql/client";
import {SCHEMA} from "../lib/schema.mjs";
import {checkoutPos,startSplitPayment,paySplitPayment} from "../lib/pos-api.mjs";
import {bangkokDate} from "../lib/time.mjs";

const user={id:"owner",role:"admin",permissions:{}};
const menu=[{
  id:"latte",name:"Latte",category:"Coffee",enabled:true,price:55,
  variants:[{label:"100%",recipe:{items:{coffee:10,milk:100}}}]
}];
function seed({shift=false}={}){
  const date=bangkokDate();
  return {
    menu,
    ingredients:{
      coffee:{name:"Coffee",qty:1000,unit:"g",unitCost:1},
      milk:{name:"Milk",qty:10000,unit:"g",unitCost:.05}
    },
    settings:{pagerCount:10},
    sales:[],orders:[],expenses:[],paymentSessions:[],cashMovements:[],
    cashShifts:shift?[{id:"shift-1",date,status:"open",openingCash:500,openedAt:1,openedBy:"owner"}]:[],
    closes:[],billSeq:{},customers:[],posRequestKeys:{}
  };
}
async function setup(t,doc){
  const dir=await mkdtemp(join(tmpdir(),"field-shift-guard-"));
  const db=createClient({url:"file:"+join(dir,"test.db")});
  t.after(async()=>{db.close();try{await rm(dir,{recursive:true,force:true})}catch(error){if(process.platform!=="win32"||error.code!=="EBUSY")throw error}});
  await db.batch(SCHEMA,"write");
  await db.execute({sql:"INSERT INTO field_users(id,username,password_hash,role,created_at,updated_at) VALUES('owner','owner','unused','admin',0,0)",args:[]});
  await db.execute({sql:"UPDATE field_state SET document=? WHERE singleton=1",args:[JSON.stringify(doc)]});
  return db;
}
async function state(db){return JSON.parse((await db.execute("SELECT document FROM field_state WHERE singleton=1")).rows[0].document)}
const cart=[{id:"latte",variant:"100%",qty:1}];

test("online cash checkout requires an open cash shift and rolls back all sale/stock effects",async t=>{
  const db=await setup(t,seed());
  const before=await state(db);
  await assert.rejects(
    checkoutPos({db,user,now:1000,body:{requestKey:"cash-no-shift-0001",date:bangkokDate(),cart,payment:"cash",received:100}}),
    /cash_shift_not_open/
  );
  const after=await state(db);
  assert.equal(after.sales.length,0);
  assert.equal(after.orders.length,0);
  assert.equal(after.ingredients.coffee.qty,before.ingredients.coffee.qty);
  assert.equal(after.ingredients.milk.qty,before.ingredients.milk.qty);
});

test("non-cash checkout remains available without a cash shift",async t=>{
  const db=await setup(t,seed());
  const result=await checkoutPos({
    db,user,now:1000,
    body:{requestKey:"bank-no-shift-0001",date:bangkokDate(),cart,payment:"bank",paymentReference:"bank-ref-1"}
  });
  assert.equal(result.ok,true);
  assert.equal(result.total,55);
  assert.equal((await state(db)).sales.length,1);
});

test("offline fulfilled cash keeps its existing emergency path even if a shift could not be opened while offline",async t=>{
  const db=await setup(t,seed());
  const now=10_000;
  const result=await checkoutPos({
    db,user,now,
    body:{
      requestKey:"offline-no-shift-0001",date:bangkokDate(),cart,payment:"cash",received:100,
      offlineFulfilled:true,offlineCreatedAt:now-1000,checkoutMode:"full"
    }
  });
  assert.equal(result.ok,true);
  assert.equal(result.offlineFulfilled,true);
  assert.equal((await state(db)).orders[0].status,"returned");
});

test("cash checkout succeeds once the shift is open and committed replay remains valid after the shift later closes",async t=>{
  const db=await setup(t,seed({shift:true}));
  const body={requestKey:"cash-open-shift-0001",date:bangkokDate(),cart,payment:"cash",received:100};
  const first=await checkoutPos({db,user,now:1000,body});
  assert.equal(first.ok,true);
  const doc=await state(db);
  doc.cashShifts[0].status="closed";
  await db.execute({sql:"UPDATE field_state SET document=? WHERE singleton=1",args:[JSON.stringify(doc)]});
  const replay=await checkoutPos({db,user,now:2000,body});
  assert.equal(replay.ok,true);
  assert.equal(replay.replayed,true);
  assert.equal((await state(db)).sales.length,1);
});

test("split cash payment requires an open shift before mutating allocations or payment state",async t=>{
  const db=await setup(t,seed());
  const started=await startSplitPayment({
    db,user,now:1000,
    body:{requestKey:"split-start-no-shift-0001",date:bangkokDate(),cart,mode:"split"}
  });
  const sessionId=started.session.id;
  await assert.rejects(
    paySplitPayment({
      db,user,now:1100,
      body:{requestKey:"split-cash-no-shift-0001",sessionId,method:"cash",received:100,allocations:[{index:0,qty:1}],label:"คนที่ 1"}
    }),
    /cash_shift_not_open/
  );
  let doc=await state(db),session=doc.paymentSessions.find(x=>x.id===sessionId);
  assert.deepEqual(session.remainingQty,[1]);
  assert.equal(session.payments.length,0);

  const paid=await paySplitPayment({
    db,user,now:1200,
    body:{requestKey:"split-bank-no-shift-0001",sessionId,method:"bank",paymentReference:"bank-ref-2",allocations:[{index:0,qty:1}],label:"คนที่ 1"}
  });
  assert.equal(paid.completed,true);
  doc=await state(db);session=doc.paymentSessions.find(x=>x.id===sessionId);
  assert.equal(session.status,"completed");
});

test("POS explains and routes cash-shift preflight without leaving the sales route",async()=>{
  const {readFile}=await import("node:fs/promises");
  const pos=await readFile(new URL("../app/pos/page.tsx",import.meta.url),"utf8");
  assert.match(pos,/cash_shift_not_open/);
  assert.match(pos,/currentShiftStatus==="not_open"/);
  assert.match(pos,/setPayOpen\(false\)/);
  assert.match(pos,/setWorkspaceMounted\(true\)/);
  assert.match(pos,/setWorkspaceOpen\(true\)/);
  assert.match(pos,/ก่อนรับเงินสด ต้องเปิดกะเงินสดวันนี้ก่อน/);
  assert.match(pos,/ให้เจ้าของร้านเปิดกะก่อน หรือเลือก PromptPay\/ช่องทางอื่น/);
});
