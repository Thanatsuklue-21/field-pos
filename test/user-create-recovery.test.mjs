import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import ts from "typescript";

async function mod(t){
  const source=await readFile(new URL("../lib/user-create-recovery.ts",import.meta.url),"utf8");
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  return import("data:text/javascript;base64,"+Buffer.from(code+"\n// "+t.name).toString("base64"));
}
function storage(){
  const m=new Map();
  return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m};
}
const body=(extra={})=>({requestKey:"user-create-0001",username:"staff.one",role:"staff",permissions:{order:true,queue:true,stock:false,report:false},...extra});

test("user-create recovery persists no plaintext password",async t=>{
  const x=await mod(t),store=storage(),intent=x.prepareUserCreateIntent("owner",body(),store);
  const raw=[...store.m.values()][0];
  assert.ok(raw);
  assert.equal(raw.includes("password"),false);
  assert.equal(Object.prototype.hasOwnProperty.call(intent.body,"password"),false);
  assert.equal(x.readUserCreateIntent("owner",store)?.body.username,"staff.one");
});

test("user-create recovery blocks changed account while pending",async t=>{
  const x=await mod(t),store=storage();
  x.prepareUserCreateIntent("owner",body(),store);
  assert.throws(()=>x.prepareUserCreateIntent("owner",body({requestKey:"user-create-0002",username:"staff.two"}),store),/pending_user_create_exists/);
});

test("lost user-create response keeps sanitized intent and exact replay clears it",async t=>{
  const x=await mod(t),store=storage(),intent=x.prepareUserCreateIntent("owner",body(),store);
  await assert.rejects(
    x.sendUserCreateIntent(intent,"SecurePass123",async()=>{throw Object.assign(new Error("network_unavailable"),{status:0})},store),
    /network_unavailable/
  );
  const pending=x.readUserCreateIntent("owner",store);
  assert.equal(pending?.body.requestKey,intent.body.requestKey);
  assert.equal(Object.prototype.hasOwnProperty.call(pending.body,"password"),false);
  const sent=[];
  const result=await x.sendUserCreateIntent(intent,"SecurePass123",async payload=>{
    sent.push(payload);
    return {ok:true,requestKey:payload.requestKey,performedBy:"owner",user:{id:"user-1",username:payload.username,role:payload.role,permissions:payload.permissions,active:true}};
  },store);
  assert.equal(result.user.id,"user-1");
  assert.equal(sent[0].password,"SecurePass123");
  assert.equal(x.readUserCreateIntent("owner",store),null);
});

test("recovery requires password at send time but never stores it",async t=>{
  const x=await mod(t),store=storage(),intent=x.prepareUserCreateIntent("owner",body(),store);
  await assert.rejects(x.sendUserCreateIntent(intent,"",async()=>({}),store),/user_create_password_required/);
  assert.ok(x.readUserCreateIntent("owner",store));
  assert.equal([...store.m.values()][0].includes("SecurePass"),false);
});

test("authoritative username conflict clears intent while request-key conflict stays pending",async t=>{
  const x=await mod(t),clearStore=storage(),clearIntent=x.prepareUserCreateIntent("owner",body(),clearStore);
  await assert.rejects(
    x.sendUserCreateIntent(clearIntent,"SecurePass123",async()=>{throw Object.assign(new Error("username_exists"),{status:409})},clearStore),
    /username_exists/
  );
  assert.equal(x.readUserCreateIntent("owner",clearStore),null);

  const keepStore=storage(),keepIntent=x.prepareUserCreateIntent("owner",body(),keepStore);
  await assert.rejects(
    x.sendUserCreateIntent(keepIntent,"DifferentPass123",async()=>{throw Object.assign(new Error("request_key_conflict"),{status:409})},keepStore),
    /request_key_conflict/
  );
  assert.ok(x.readUserCreateIntent("owner",keepStore));
});

test("user UI persists sanitized intent before send and prompts for password after reload",async()=>{
  const ui=await readFile(new URL("../app/users/page.tsx",import.meta.url),"utf8");
  assert.match(ui,/prepareUserCreateIntent/);
  assert.match(ui,/sendUserCreateIntent/);
  assert.match(ui,/readUserCreateIntent/);
  assert.match(ui,/ระบบไม่เก็บรหัสผ่านไว้/);
  assert.match(ui,/กรอกรหัสผ่านเดิมเพื่อยืนยัน/);
  assert.match(ui,/window\.addEventListener\("online",recover\)/);
  const create=ui.slice(ui.indexOf("async function create()"),ui.indexOf("async function patch",ui.indexOf("async function create()")));
  const prepared=create.indexOf("prepareUserCreateIntent");
  const persisted=create.indexOf("setPendingCreate(intent)",prepared);
  const sent=create.indexOf("await submitUserIntent(intent,password,false)",persisted);
  assert.ok(prepared>=0&&persisted>prepared&&sent>persisted);
  const prepareCall=create.slice(prepared,sent);
  assert.doesNotMatch(prepareCall,/permissions:[^}]*password/);
});
