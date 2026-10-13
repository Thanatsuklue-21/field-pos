import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import ts from 'typescript';
async function mod(t){
  const source=await readFile(new URL('../lib/critical-write-recovery.ts',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  return import('data:text/javascript;base64,'+Buffer.from(code+'\n// '+t.name).toString('base64'));
}
function storage(){
  const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m};
}
test('critical write keeps exact identity across unknown result and clears only exact ACK',async t=>{
  const x=await mod(t),store=storage(),body={requestKey:'cash-12345678',amount:50};
  const intent=x.prepareCriticalWriteIntent('owner','cashMovement',body,store);
  await assert.rejects(x.sendCriticalWriteIntent(intent,async()=>{throw Object.assign(new Error('network_unavailable'),{status:0})},()=>false,new Set(),store));
  assert.equal(x.readCriticalWriteIntent('owner','cashMovement',store).body.requestKey,body.requestKey);
  await assert.rejects(x.sendCriticalWriteIntent(intent,async()=>({ok:true}),()=>false,new Set(),store),{message:'critical_ack_unknown'});
  assert.ok(x.readCriticalWriteIntent('owner','cashMovement',store));
  const result=await x.sendCriticalWriteIntent(intent,async()=>({ok:true,id:'m1'}),r=>r.ok===true&&r.id==='m1',new Set(),store);
  assert.equal(result.id,'m1');assert.equal(x.readCriticalWriteIntent('owner','cashMovement',store),null);
});
test('authoritative pre-commit rejection clears intent so operator can correct input',async t=>{
  const x=await mod(t),store=storage(),body={requestKey:'stock-1234567',qtyDelta:-5};
  const intent=x.prepareCriticalWriteIntent('staff','stockTransaction',body,store);
  await assert.rejects(x.sendCriticalWriteIntent(intent,async()=>{throw Object.assign(new Error('stock_shortage'),{status:409})},()=>false,new Set(['stock_shortage']),store));
  assert.equal(x.readCriticalWriteIntent('staff','stockTransaction',store),null);
});
test('a different payload cannot replace an unresolved critical write',async t=>{
  const x=await mod(t),store=storage();
  x.prepareCriticalWriteIntent('owner','cashMovement',{requestKey:'cash-abcdefgh',amount:50},store);
  assert.throws(()=>x.prepareCriticalWriteIntent('owner','cashMovement',{requestKey:'cash-ijklmnop',amount:60},store),{message:'pending_critical_write_exists'});
});
