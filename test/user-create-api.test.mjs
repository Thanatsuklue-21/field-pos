import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createClient} from "@libsql/client";
import {SCHEMA} from "../lib/schema.mjs";
import {createApi} from "../lib/api.mjs";
import {digest,verifyPassword} from "../lib/security.mjs";

const origin="https://field.test";
async function setup(t){
  const dir=await mkdtemp(join(tmpdir(),"field-user-create-")),db=createClient({url:"file:"+join(dir,"test.db")});
  t.after(async()=>{db.close();try{await rm(dir,{recursive:true,force:true})}catch(error){if(process.platform!=="win32"||error.code!=="EBUSY")throw error}});
  await db.batch(SCHEMA,"write");
  for(const id of ["owner","owner2"])await db.execute({sql:"INSERT INTO field_users(id,username,password_hash,role,permissions,created_at,updated_at) VALUES(?,?,?,?,?,?,0)",args:[id,id,"unused","admin","{}",0]});
  await db.execute({sql:"UPDATE field_state SET document=? WHERE singleton=1",args:[JSON.stringify({menu:[],ingredients:{},sales:[],orders:[],settings:{},posRequestKeys:{}})]});
  for(const [token,userId,csrf] of [["token-1","owner","csrf-1"],["token-2","owner2","csrf-2"]])await db.execute({sql:"INSERT INTO field_sessions VALUES(?,?,?,?)",args:[digest(token),userId,csrf,Date.now()+60000]});
  return {db,handler:createApi({db,origin})};
}
function req(token,csrf,body){return {method:"POST",query:{route:"admin/users"},headers:{origin,cookie:"field_session="+token,"x-csrf-token":csrf},body}}
async function send(handler,request){const res={writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=JSON.parse(body)}};await handler(request,res);return res}
const body=(extra={})=>({requestKey:"user-api-0001",username:"staff.one",password:"SecurePass123",role:"staff",permissions:{order:true,queue:true,stock:false,report:false},...extra});

test("real libSQL user-create replay returns one account and one audit",async t=>{
  const {db,handler}=await setup(t),input=body();
  const first=await send(handler,req("token-1","csrf-1",input));
  assert.equal(first.status,201);assert.equal(first.body.ok,true);assert.equal(first.body.performedBy,"owner");
  assert.equal(first.body.user.username,"staff.one");assert.equal(first.body.user.active,true);
  const id=first.body.user.id;

  const replay=await send(handler,req("token-1","csrf-1",input));
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.user.id,id);

  const users=await db.execute({sql:"SELECT id,password_hash,permissions FROM field_users WHERE username=?",args:["staff.one"]});
  assert.equal(users.rows.length,1);assert.equal(users.rows[0].id,id);
  assert.equal(await verifyPassword("SecurePass123",users.rows[0].password_hash),true);
  assert.deepEqual(JSON.parse(users.rows[0].permissions),{order:true,queue:true,stock:false,report:false});
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_audit WHERE action='user_create'")).rows[0].n),1);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_pos_requests WHERE request_key='user-api-0001'")).rows[0].n),1);
});

test("user-create durable identity binds password digest, role, permissions and actor",async t=>{
  const {db,handler}=await setup(t),input=body({requestKey:"user-api-0002"});
  assert.equal((await send(handler,req("token-1","csrf-1",input))).status,201);

  for(const changed of [
    {...input,password:"DifferentPass123"},
    {...input,role:"admin",permissions:{}},
    {...input,permissions:{order:true,queue:false,stock:false,report:false}}
  ]){
    const res=await send(handler,req("token-1","csrf-1",changed));
    assert.equal(res.status,409);assert.equal(res.body.error,"request_key_conflict");
  }
  const actor=await send(handler,req("token-2","csrf-2",input));
  assert.equal(actor.status,409);assert.equal(actor.body.error,"request_key_conflict");
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_users WHERE username='staff.one'")).rows[0].n),1);
});

test("new request for existing username stays an authoritative rejection",async t=>{
  const {db,handler}=await setup(t);
  assert.equal((await send(handler,req("token-1","csrf-1",body({requestKey:"user-api-0003"})))).status,201);
  const duplicate=await send(handler,req("token-1","csrf-1",body({requestKey:"user-api-0004"})));
  assert.equal(duplicate.status,409);assert.equal(duplicate.body.error,"username_exists");
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_pos_requests")).rows[0].n),1);
});

test("user-create requires request identity and never persists plaintext password",async t=>{
  const {db,handler}=await setup(t);
  const missing=await send(handler,req("token-1","csrf-1",{username:"staff.one",password:"SecurePass123",role:"staff",permissions:{order:true,queue:true}}));
  assert.equal(missing.status,400);assert.equal(missing.body.error,"invalid_request_key");

  const secret="NeverStoreThis123";
  const created=await send(handler,req("token-1","csrf-1",body({requestKey:"user-api-0005",password:secret})));
  assert.equal(created.status,201);
  const requestRow=(await db.execute({sql:"SELECT response,request_hash FROM field_pos_requests WHERE request_key=?",args:["user-api-0005"]})).rows[0];
  const audit=(await db.execute("SELECT details FROM field_audit WHERE action='user_create' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(String(requestRow.response).includes(secret),false);
  assert.equal(String(requestRow.request_hash).includes(secret),false);
  assert.equal(String(audit.details).includes(secret),false);
});
