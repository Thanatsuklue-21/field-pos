import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createApi} from "../lib/api.mjs";
import {digest} from "../lib/security.mjs";
import {bangkokDate} from "../lib/time.mjs";

const origin="https://field.example";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

function request(route){
  return {method:"GET",query:{route},headers:{origin,cookie:"field_session=known-token"},body:{}};
}
async function bootstrap(doc,permissions){
  const document=JSON.stringify(doc);
  const db={execute:async q=>{
    const {sql}=typeof q==="string"?{sql:q}:q;
    if(sql.includes("FROM field_sessions s"))return {rows:[{
      token_hash:digest("known-token"),csrf_token:"known-csrf",id:"staff-1",username:"staff",
      role:"staff",permissions:JSON.stringify(permissions),active:1
    }]};
    if(sql.startsWith("SELECT revision,document FROM field_state"))return {rows:[{revision:7,document}]};
    throw new Error("Unexpected SQL: "+sql);
  }};
  const res={writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=JSON.parse(body)}};
  await createApi({db,origin})(request("pos/bootstrap"),res);
  return res;
}
function doc(){
  const date=bangkokDate();
  return {
    menu:[
      {id:"coffee",name:"Coffee",category:"Coffee",enabled:true,price:50,variants:[{label:"100%",recipe:{items:{coffee:10}}}]},
      {id:"matcha",name:"Matcha",category:"Matcha",enabled:true,price:60,variants:[{label:"100%",recipe:{items:{matcha:5}}}]}
    ],
    ingredients:{
      coffee:{name:"Coffee",qty:20,unit:"g"},
      matcha:{name:"Matcha",qty:0,unit:"g"}
    },
    settings:{availabilityLowServings:5,pagerCount:10},
    cashShifts:[{id:"shift-1",date,status:"open",openingCash:500}],
    orders:[
      {id:"o2",queueNo:"Q002",status:"assigned",time:200,items:[]},
      {id:"o1",queueNo:"Q001",status:"making",time:100,items:[]},
      {id:"done",queueNo:"Q000",status:"returned",time:50,items:[]}
    ]
  };
}

test("POS bootstrap gives the operator one safe summary from the same state revision",async()=>{
  const res=await bootstrap(doc(),{order:true,queue:true,stock:true});
  assert.equal(res.status,200);
  assert.equal(res.body.revision,7);
  assert.equal(res.body.operatorGuide.businessDate,bangkokDate());
  assert.equal(res.body.operatorGuide.shiftStatus,"open");
  assert.equal(res.body.operatorGuide.queueCount,2);
  assert.equal(res.body.operatorGuide.firstQueue,"Q001");
  assert.equal(res.body.operatorGuide.unavailableMenuCount,1);
  assert.equal(res.body.operatorGuide.lowStockMenuCount,1);
});

test("POS bootstrap keeps FIFO queue summary without allocating and sorting active history",async()=>{
  const state=doc();
  state.orders=[
    {id:"later",queueNo:"Q099",status:"making",time:900,items:[]},
    {id:"closed",queueNo:"Q000",status:"cancelled",time:1,items:[]},
    {id:"first",queueNo:"Q010",status:"assigned",time:100,items:[]},
    {id:"middle",queueNo:"Q020",status:"making",time:300,items:[]}
  ];
  const res=await bootstrap(state,{order:true,queue:true});
  assert.equal(res.body.operatorGuide.queueCount,3);
  assert.equal(res.body.operatorGuide.firstQueue,"Q010");
  const api=await read("lib/api.mjs");
  const start=api.indexOf("const canQueue=mayView");
  const block=api.slice(start,start+1200);
  assert.match(block,/for\(const order of Array\.isArray\(doc\.orders\)\?doc\.orders:\[\]\)/);
  assert.doesNotMatch(block,/activeQueue/);
  assert.doesNotMatch(block,/\.sort\(/);
});

test("bootstrap never leaks queue workload to an order-only operator",async()=>{
  const res=await bootstrap(doc(),{order:true});
  assert.equal(res.status,200);
  assert.equal(res.body.operatorGuide.queueCount,0);
  assert.equal(res.body.operatorGuide.firstQueue,"");
  assert.equal(res.body.operatorGuide.unavailableMenuCount,1);
});

test("missing shift is normalized to an explicit not-open state",async()=>{
  const state=doc();state.cashShifts=[];
  const res=await bootstrap(state,{order:true,queue:true});
  assert.equal(res.body.operatorGuide.shiftStatus,"not_open");
});

test("POS replaces the generic cashier hint with the highest-priority store action only while idle",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/chooseWorkspaceNextAction/);
  assert.match(pos,/readExpenseIntent/);
  assert.match(pos,/readCashShiftOpenIntent/);
  assert.match(pos,/workspaceActionVisible=!payOpen&&cartQty===0&&workspaceNextAction\.tone!=="ready"/);
  assert.match(pos,/ทำต่อก่อน/);
  assert.match(pos,/onClick=\{runWorkspaceNextAction\}/);
  assert.match(pos,/workspaceNextAction\.tab==="queue"\?"ทำคิวตรงนี้"/);
  assert.match(pos,/workspaceNextAction\.action==="start_day"\?"เริ่มตรงนี้"/);
});

test("POS rechecks local recovery signals after returning from the workspace",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/if\(workspaceOpen\)return/);
  assert.match(pos,/\[workspaceOpen,session\.user\.id,session\.user\.role,session\.user\.permissions\?\.report\]/);
  assert.match(pos,/window\.addEventListener\("focus",onFocus\)/);
  assert.match(pos,/window\.addEventListener\("storage",onStorage\)/);
});

test("operator guidance is part of cached bootstrap rather than a second polling API",async()=>{
  const api=await read("lib/api.mjs");
  const client=await read("lib/api-client.ts");
  assert.match(api,/operatorGuide/);
  assert.match(client,/type OperatorGuide=/);
  assert.doesNotMatch(api,/\/api\/pos\/operator-guide/);
});


test("queue recommendation opens Today Workspace in-place instead of switching pages",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/const openWorkspace=\(requestedTab:null\|"queue"\|"orders"\|"stock"\|"expense"\|"status"=null\)=>\{/);
  assert.match(pos,/setWorkspaceRequestedTab\(requestedTab\)/);
  assert.match(pos,/setWorkspaceMounted\(true\);/);
  assert.match(pos,/setWorkspaceOpen\(true\);/);
  assert.match(pos,/const runWorkspaceNextAction=\(\)=>openWorkspace\(null\)/);
  assert.match(pos,/onClick=\{runWorkspaceNextAction\}/);
  assert.match(pos,/workspaceNextAction\.tab==="queue"\?"ทำคิวตรงนี้"/);
  const start=pos.indexOf("const runWorkspaceNextAction");
  const block=pos.slice(start,start+180);
  assert.doesNotMatch(block,/router\.push\("\/queue"\)/);
  assert.doesNotMatch(pos,/method:"POST"[\s\S]{0,180}\/api\/pos\/queue/);
});

test("all store recommendations keep the operator on POS through Today Workspace",async()=>{
  const pos=await read("app/pos/page.tsx");
  const start=pos.indexOf("const runWorkspaceNextAction");
  const block=pos.slice(start,start+180);
  assert.match(block,/openWorkspace\(null\)/);
  assert.doesNotMatch(block,/router\.push/);
});


test("primary workspace action keeps high contrast text",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/bg-\[#d4af37\]/);
  assert.match(pos,/text-black/);
});
