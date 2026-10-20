import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi} from '../lib/api.mjs';
import {digest} from '../lib/security.mjs';
async function overview(permissions){
 const queries=[],document=JSON.stringify({menu:[{id:'latte',name:'Latte',enabled:true,price:55,variants:[{label:'normal',recipe:{items:{milk:100}}}]}],ingredients:{milk:{name:'Milk',qty:0,unit:'g',unitCost:.05}}});
 const db={execute:async query=>{const sql=typeof query==='string'?query:query.sql;queries.push(sql);
  if(sql.includes('FROM field_sessions s'))return {rows:[{token_hash:digest('token'),csrf_token:'csrf',id:'staff',username:'staff',role:'staff',permissions:JSON.stringify(permissions),active:1}]};
  if(sql.startsWith('SELECT revision,document FROM field_state'))return {rows:[{revision:7,document}]};
  if(sql.includes('FROM field_purchase_records')||sql.includes('FROM field_stock_transactions'))return {rows:[]};
  throw new Error('Unexpected SQL: '+sql);
 }};
 const response={writeHead(status){this.status=status},end(raw){this.body=JSON.parse(raw)}};
 await createApi({db,origin:'https://field.example'})({method:'GET',query:{route:'stock/overview'},headers:{cookie:'field_session=token'}},response);
 return {response,queries};
}
test('stock guidance is a read-only projection behind the existing stock permission',async()=>{
 const {response,queries}=await overview({stock:true});assert.equal(response.status,200);assert.equal(response.body.revision,7);
 assert.deepEqual(response.body.attention,{blockedMenus:1,ingredients:[{id:'milk',menuNames:['Latte']}],missingReferences:0});
 assert.ok(queries.every(sql=>sql.startsWith('SELECT')));
 const denied=await overview({order:true});assert.equal(denied.response.status,403);assert.equal(denied.queries.length,1);
});
