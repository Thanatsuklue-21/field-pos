import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createApi} from "../lib/api.mjs";
import {digest} from "../lib/security.mjs";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

function response(){
  return {
    status:0,headers:{},body:null,
    writeHead(status,headers={}){this.status=status;this.headers=headers},
    end(body=""){this.body=body?JSON.parse(body):null}
  };
}

test("POS web-vitals reporter tracks only the critical field metrics and only on POS",async()=>{
  const ui=await read("components/pos-web-vitals.tsx");
  assert.match(ui,/useReportWebVitals/);
  assert.match(ui,/new Set\(\["LCP","INP","CLS","TTFB"\]\)/);
  assert.match(ui,/if\(path!=="\/pos"\|\|!session\|\|!TRACKED\.has\(metric\.name\)\)return/);
  assert.match(ui,/X-CSRF-Token/);
  assert.match(ui,/keepalive:true/);
  assert.match(ui,/effectiveType/);
  assert.match(ui,/saveData/);
});

test("AppShell reuses its authenticated session for telemetry without a second auth owner",async()=>{
  const shell=await read("components/app-shell.tsx");
  assert.match(shell,/import PosWebVitals from "@\/components\/pos-web-vitals"/);
  assert.match(shell,/<PosWebVitals session=\{session\}\/>/);
});

test("authenticated web-vitals endpoint logs validated metrics without writing business storage",async()=>{
  const queries=[];
  const db={execute:async q=>{
    const sql=typeof q==="string"?q:q.sql;
    queries.push(sql);
    if(sql.includes("FROM field_sessions s JOIN field_users"))return {rows:[{
      token_hash:digest("telemetry-token"),csrf_token:"telemetry-csrf",id:"owner",username:"owner",role:"admin",permissions:"{}",active:1
    }]};
    throw new Error("Unexpected SQL: "+sql);
  }};
  const api=createApi({db,origin:"https://field.test"});
  const res=response(),logs=[],original=console.info;
  console.info=(...args)=>logs.push(args.join(" "));
  try{
    await api({
      method:"POST",query:{route:"telemetry/web-vitals"},
      headers:{origin:"https://field.test",cookie:"field_session=telemetry-token","x-csrf-token":"telemetry-csrf"},
      body:{name:"LCP",value:1725.4,path:"/pos",effectiveType:"4g",saveData:false}
    },res);
  }finally{console.info=original}
  assert.equal(res.status,202);
  assert.deepEqual(res.body,{ok:true});
  assert.ok(logs.some(x=>x.includes("FIELD_WEB_VITAL name=LCP")&&x.includes("rating=good")));
  assert.equal(queries.some(sql=>/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)),false);
});

test("web-vitals endpoint rejects non-POS or unknown metrics",async()=>{
  const db={execute:async q=>{
    const sql=typeof q==="string"?q:q.sql;
    if(sql.includes("FROM field_sessions s JOIN field_users"))return {rows:[{
      token_hash:digest("telemetry-token"),csrf_token:"telemetry-csrf",id:"owner",username:"owner",role:"admin",permissions:"{}",active:1
    }]};
    throw new Error("Unexpected SQL: "+sql);
  }};
  const api=createApi({db,origin:"https://field.test"});
  for(const body of [
    {name:"FCP",value:100,path:"/pos"},
    {name:"LCP",value:100,path:"/orders"},
    {name:"INP",value:-1,path:"/pos"}
  ]){
    const res=response();
    await api({method:"POST",query:{route:"telemetry/web-vitals"},headers:{origin:"https://field.test",cookie:"field_session=telemetry-token","x-csrf-token":"telemetry-csrf"},body},res);
    assert.equal(res.status,400);
    assert.equal(res.body.error,"invalid_web_vital");
  }
});


test("browser QA excludes only the log-only telemetry endpoint from business-write assertions",async()=>{
  for(const path of ["scripts/qa-pos-touch.py","scripts/qa-offline-outbox.py","scripts/qa-cashier-flow.py","scripts/qa-promptpay-nonblocking.py"]){
    const qa=await read(path);
    assert.match(qa,/telemetry\/web-vitals/);
    assert.match(qa,/method|route\.request\.method/);
  }
});
