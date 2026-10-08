import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi} from '../lib/api.mjs';
function request(method,route,{origin='https://field.example',body}={}){return {method,query:{route},headers:{origin},body}}
async function run(req){const queries=[];const db={execute:async({sql}={})=>{queries.push(sql);return {rows:[{ok:1}]}}};const output={writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=JSON.parse(body)}};await createApi({db,origin:'https://field.example'})(req,output);return {output,queries}}
test('health checks Turso with the established minimal contract',async()=>{const {output}=await run(request('GET','health'));assert.equal(output.status,200);assert.deepEqual(output.body,{ok:true,storage:'turso'});assert.ok(!('token' in output.body));assert.ok(!('secret' in output.body));assert.ok(!('url' in output.body))});
test('build endpoint exposes exact deployment identity without database secrets',async()=>{const oldSha=process.env.VERCEL_GIT_COMMIT_SHA,oldEnv=process.env.VERCEL_ENV;process.env.VERCEL_GIT_COMMIT_SHA='1234567890abcdef1234567890abcdef12345678';process.env.VERCEL_ENV='preview';try{const {output,queries}=await run(request('GET','build'));assert.equal(output.status,200);assert.equal(output.body.buildSha,'1234567890abcdef1234567890abcdef12345678');assert.equal(output.body.environment,'preview');assert.deepEqual(Object.keys(output.body).sort(),['buildSha','environment']);assert.equal(queries.length,0)}finally{if(oldSha===undefined)delete process.env.VERCEL_GIT_COMMIT_SHA;else process.env.VERCEL_GIT_COMMIT_SHA=oldSha;if(oldEnv===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=oldEnv}});
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
