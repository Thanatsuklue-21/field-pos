import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createApi} from '../lib/api.mjs';
import {digest} from '../lib/security.mjs';

const origin='https://field.example';
function request(method,route,body,headers={}) {
  return {method,query:{route},headers:{origin,...headers},body};
}
async function send(api,req){
  const res={
    writeHead(status,headers){this.status=status;this.headers=headers},
    end(text){this.body=JSON.parse(text)}
  };
  await api(req,res);
  return res;
}
function fakeDb(){
  const storage={users:[],revision:0,document:'{}',versions:[],audits:[]};
  const execute=async (query)=>{
    const {sql,args=[]}=typeof query==='string'?{sql:query}:query;
    if(sql.includes('COUNT(*)')&&sql.includes('field_users'))return {rows:[{n:storage.users.length}]};
    if(sql.includes('FROM field_sessions s'))return {rows:[{
      token_hash:digest('known-token'),csrf_token:'known-csrf',id:'admin-id',username:'admin',
      role:'admin',permissions:'{}',active:1
    }]};
    if(sql.startsWith('SELECT revision,document FROM field_state'))return {rows:[{revision:storage.revision,document:storage.document}]};
    if(sql.startsWith('SELECT revision,document,updated_at FROM field_state'))return {rows:[{revision:storage.revision,document:storage.document,updated_at:0}]};
    if(sql.startsWith('INSERT INTO field_users')){storage.users.push(args);return {rows:[]}};
    if(sql.startsWith('INSERT INTO field_state_versions')){storage.versions.push(args);return {rows:[]}};
    if(sql.startsWith('INSERT INTO field_audit')){storage.audits.push(args);return {rows:[]}};
    if(sql.startsWith('UPDATE field_state')){
      if(storage.revision!==args[2])return {rowsAffected:0,rows:[]};
      storage.document=args[0];
      storage.revision++;
      return {rowsAffected:1,rows:[]};
    }
    throw new Error('Unexpected SQL: '+sql);
  };
  return {storage,execute,async transaction(){return {execute,async commit(){},async rollback(){}}}};
}

test('initial Admin is provisioned by the bootstrap script, not a public setup API',async()=>{
  const bootstrap=await readFile(new URL('../scripts/bootstrap.mjs',import.meta.url),'utf8');
  assert.match(bootstrap,/FIELD_ADMIN_PASSWORD/);
  assert.match(bootstrap,/COUNT\(\*\) AS n FROM field_users WHERE role='admin'/);
  assert.match(bootstrap,/Admin exists\. Use the authenticated Admin API\./);
  assert.match(bootstrap,/INSERT INTO field_users/);
});

test('online snapshot commits reject stale revisions and retain previous version',async()=>{
  const db=fakeDb(),api=createApi({db,origin});
  const headers={cookie:'field_session=known-token','x-csrf-token':'known-csrf'};
  const state={menu:[],ingredients:{},sales:[{id:'sale-1'}]};
  const first=await send(api,request('POST','import/commit',{state,expectedRevision:0},headers));
  assert.equal(first.status,200);
  assert.equal(first.body.revision,1);

  const stale=await send(api,request('POST','import/commit',{state,expectedRevision:0,replace:true},headers));
  assert.equal(stale.status,409);
  assert.equal(db.storage.revision,1);

  const next=await send(api,request(
    'POST',
    'import/commit',
    {state:{...state,sales:[{id:'sale-1'},{id:'sale-2'}]},expectedRevision:1,replace:true},
    headers
  ));
  assert.equal(next.status,200);
  assert.equal(next.body.revision,2);
  assert.equal(db.storage.versions.length,2);
  assert.equal(JSON.parse(db.storage.document).sales.length,2);
});
