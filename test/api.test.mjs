import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi} from '../lib/api.mjs';
function request(method,route,{origin='https://field.example',body}={}){return {method,query:{route},headers:{origin},body}}
async function run(req){const queries=[];const db={execute:async({sql}={})=>{queries.push(sql);return {rows:[{ok:1}]}}};const output={writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=JSON.parse(body)}};await createApi({db,origin:'https://field.example'})(req,output);return {output,queries}}
test('health checks Turso and reports no secret',async()=>{const {output}=await run(request('GET','health'));assert.equal(output.status,200);assert.deepEqual(output.body,{ok:true,storage:'turso'})});
test('write denied for a foreign origin before database access',async()=>{const {output,queries}=await run(request('POST','auth/login',{origin:'https://evil.example',body:{username:'admin',password:'Password12345'}}));assert.equal(output.status,403);assert.equal(queries.length,0)});
test('protected state requires server session',async()=>{const {output,queries}=await run(request('GET','state'));assert.equal(output.status,401);assert.equal(queries.length,0)});
test('invalid login input does not probe database',async()=>{const {output,queries}=await run(request('POST','auth/login',{body:{username:'a',password:'x'}}));assert.equal(output.status,401);assert.equal(queries.length,0)});
