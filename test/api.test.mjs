import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi} from '../lib/api.mjs';
function request(method,route,{origin='https://field.example',body,headers={}}={}){return {method,query:{route},headers:{origin,...headers},body}}
async function run(req){const queries=[];const db={execute:async({sql}={})=>{queries.push(sql);return {rows:[{ok:1}]}}};const output={writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=JSON.parse(body)}};await createApi({db,origin:'https://field.example'})(req,output);return {output,queries}}
test('health checks Turso and reports no secret',async()=>{const {output}=await run(request('GET','health'));assert.equal(output.status,200);assert.equal(output.body.ok,true);assert.equal(output.body.storage,'turso');assert.equal(typeof output.body.release,'object');assert.equal(typeof output.body.release.commit,'string');assert.equal(typeof output.body.release.branch,'string');assert.equal(typeof output.body.release.environment,'string')});
test('write denied for a foreign origin before database access',async()=>{const {output,queries}=await run(request('POST','auth/login',{origin:'https://evil.example',body:{username:'admin',password:'Password12345'}}));assert.equal(output.status,403);assert.equal(queries.length,0)});
test('protected state requires server session',async()=>{const {output,queries}=await run(request('GET','state'));assert.equal(output.status,401);assert.equal(queries.length,0)});
test('invalid login input does not probe database',async()=>{const {output,queries}=await run(request('POST','auth/login',{body:{username:'a',password:'x'}}));assert.equal(output.status,401);assert.equal(queries.length,0)});


test('locked login attempts do not extend the existing lock window',async()=>{
  const lockUntil=Date.now()+60_000,updates=[];
  const row={id:'admin-1',username:'admin',active:1,locked_until:lockUntil,failed_count:5,password_hash:'unused',role:'admin',permissions:'{}'};
  const db={execute:async q=>{const {sql}=typeof q==='string'?{sql:q}:q;if(sql.includes('SELECT * FROM field_users'))return {rows:[row]};if(sql.startsWith('UPDATE field_users')){updates.push(sql);return {rows:[]}};throw new Error('Unexpected SQL: '+sql)}};
  const output={writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=JSON.parse(body)}};
  await createApi({db,origin:'https://field.example'})(request('POST','auth/login',{body:{username:'admin',password:'WrongPassword123'}}),output);
  assert.equal(output.status,401);
  assert.equal(output.body.error,'invalid_credentials');
  assert.equal(updates.length,0);
});


test('staff cannot access admin namespace even with a valid session and csrf',async()=>{
  const queries=[];
  const staff={token_hash:'staff-hash',csrf_token:'staff-csrf',id:'staff-1',username:'staff',role:'staff',permissions:JSON.stringify({order:true}),active:1};
  const db={execute:async q=>{
    const sql=typeof q==='string'?q:q.sql;queries.push(sql);
    if(sql.includes('FROM field_sessions s JOIN field_users u'))return {rows:[staff]};
    throw new Error('admin query must not run for staff: '+sql);
  }};
  const output={writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=JSON.parse(body)}};
  await createApi({db,origin:'https://field.example'})(request('GET',['admin','users'],{headers:{cookie:'field_session=staff-token'}}),output);
  assert.equal(output.status,403);
  assert.equal(output.body.error,'admin_required');
  assert.equal(queries.length,1);
});

test('admin namespace remains available to an authenticated admin',async()=>{
  const admin={token_hash:'admin-hash',csrf_token:'admin-csrf',id:'admin-1',username:'admin',role:'admin',permissions:'{}',active:1};
  const db={execute:async q=>{
    const sql=typeof q==='string'?q:q.sql;
    if(sql.includes('FROM field_sessions s JOIN field_users u'))return {rows:[admin]};
    if(sql.includes('FROM field_users ORDER BY created_at'))return {rows:[{id:'admin-1',username:'admin',role:'admin',permissions:'{}',active:1,created_at:1}]};
    throw new Error('Unexpected SQL: '+sql);
  }};
  const output={writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=JSON.parse(body)}};
  await createApi({db,origin:'https://field.example'})(request('GET',['admin','users'],{headers:{cookie:'field_session=admin-token'}}),output);
  assert.equal(output.status,200);
  assert.equal(output.body.users.length,1);
  assert.equal(output.body.users[0].role,'admin');
});

test('csrf rejection still happens before admin write authorization',async()=>{
  const admin={token_hash:'admin-hash',csrf_token:'admin-csrf',id:'admin-1',username:'admin',role:'admin',permissions:'{}',active:1};
  const db={execute:async q=>{
    const sql=typeof q==='string'?q:q.sql;
    if(sql.includes('FROM field_sessions s JOIN field_users u'))return {rows:[admin]};
    throw new Error('write query must not run when csrf is wrong: '+sql);
  }};
  const output={writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=JSON.parse(body)}};
  await createApi({db,origin:'https://field.example'})(request('POST',['admin','users'],{headers:{cookie:'field_session=admin-token','x-csrf-token':'wrong'},body:{username:'staff2',password:'Password12345',role:'staff'}}),output);
  assert.equal(output.status,403);
  assert.equal(output.body.error,'csrf_denied');
});
