import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import ts from "typescript";

async function mod(t){
  const source=await readFile(new URL("../lib/recipe-mutation-recovery.ts",import.meta.url),"utf8");
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  return import("data:text/javascript;base64,"+Buffer.from(code+"\n// "+t.name).toString("base64"));
}
function storage(){
  const m=new Map();
  return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m};
}
const publish=(extra={})=>({requestKey:"recipe-publish-0001",operation:"publish",menuId:"menu-1",variant:"Standard",items:{water:180,matcha:5},...extra});

test("recipe mutation recovery persists canonical publish identity and blocks another write",async t=>{
  const x=await mod(t),store=storage(),intent=x.prepareRecipeMutationIntent("owner",publish(),store);
  assert.deepEqual(Object.keys(intent.body.items),["matcha","water"]);
  assert.equal(x.readRecipeMutationIntent("owner",store)?.body.requestKey,intent.body.requestKey);
  assert.throws(()=>x.prepareRecipeMutationIntent("owner",{requestKey:"recipe-comment-0002",operation:"commentCreate",menuId:"menu-1",variant:"Standard",authorType:"owner",authorName:"owner",text:"good"},store),/pending_recipe_mutation_exists/);
});

test("ambiguous publish transport keeps request and exact replay clears it",async t=>{
  const x=await mod(t),store=storage(),intent=x.prepareRecipeMutationIntent("owner",publish(),store);
  await assert.rejects(x.sendRecipeMutationIntent(intent,async()=>{throw Object.assign(new Error("network_unavailable"),{status:0})},store),/network_unavailable/);
  assert.equal(x.readRecipeMutationIntent("owner",store)?.body.requestKey,intent.body.requestKey);
  const result=await x.sendRecipeMutationIntent(intent,async body=>({ok:true,requestKey:body.requestKey,performedBy:"owner",operation:"publish",menuId:"menu-1",variant:"Standard",items:{matcha:5,water:180},version:2,id:"rv-2"}),store);
  assert.equal(result.id,"rv-2");assert.equal(x.readRecipeMutationIntent("owner",store),null);
});

test("reconcile and comment create require exact operation-specific acknowledgement",async t=>{
  const x=await mod(t);
  const reconcileStore=storage(),reconcile=x.prepareRecipeMutationIntent("owner",{requestKey:"recipe-reconcile-01",operation:"reconcile",updateId:"pure-matcha-2026-10-12-5-180"},reconcileStore);
  await x.sendRecipeMutationIntent(reconcile,async body=>({ok:true,requestKey:body.requestKey,performedBy:"owner",operation:"reconcile",updateId:body.updateId,menuId:"pure-matcha",variant:"Standard",items:{matcha:5,water:180},version:1,id:"rv-r1"}),reconcileStore);
  assert.equal(x.readRecipeMutationIntent("owner",reconcileStore),null);

  const commentStore=storage(),comment=x.prepareRecipeMutationIntent("owner",{requestKey:"recipe-comment-001",operation:"commentCreate",menuId:"menu-1",variant:"Standard",authorType:"owner",authorName:"owner",text:"balanced"},commentStore);
  await x.sendRecipeMutationIntent(comment,async body=>({ok:true,requestKey:body.requestKey,performedBy:"owner",operation:"commentCreate",comment:{id:"rc-1",menuId:body.menuId,variant:body.variant,authorType:body.authorType,authorName:body.authorName,text:body.text}}),commentStore);
  assert.equal(x.readRecipeMutationIntent("owner",commentStore),null);
});

test("authoritative recipe validation clears intent but unknown ACK remains recoverable",async t=>{
  const x=await mod(t),badStore=storage(),bad=x.prepareRecipeMutationIntent("owner",publish(),badStore);
  await assert.rejects(x.sendRecipeMutationIntent(bad,async()=>{throw Object.assign(new Error("ingredient_missing"),{status:400})},badStore),/ingredient_missing/);
  assert.equal(x.readRecipeMutationIntent("owner",badStore),null);

  const unknownStore=storage(),unknown=x.prepareRecipeMutationIntent("owner",publish(),unknownStore);
  await assert.rejects(x.sendRecipeMutationIntent(unknown,async body=>({ok:true,requestKey:body.requestKey,performedBy:"other",operation:"publish",menuId:"menu-1",variant:"Standard",items:body.items,version:2,id:"rv-2"}),unknownStore),/recipe_ack_unknown/);
  assert.equal(x.readRecipeMutationIntent("owner",unknownStore)?.body.requestKey,unknown.body.requestKey);
});

test("recipe UI persists publish reconcile and comment create before send and replays on reconnect",async()=>{
  const ui=await readFile(new URL("../app/recipes/page.tsx",import.meta.url),"utf8");
  assert.match(ui,/prepareRecipeMutationIntent/);
  assert.match(ui,/sendRecipeMutationIntent/);
  assert.match(ui,/readRecipeMutationIntent/);
  assert.match(ui,/operation:"publish"/);
  assert.match(ui,/operation:"reconcile"/);
  assert.match(ui,/operation:"commentCreate"/);
  assert.match(ui,/window\.addEventListener\("online",recover\)/);
  assert.match(ui,/window\.addEventListener\("focus",recover\)/);
  assert.match(ui,/document\.addEventListener\("visibilitychange",visible\)/);
  assert.match(ui,/ห้าม Publish\/Reconcile\/สร้าง Comment ใหม่แทน/);
  for(const marker of ['operation:"publish"','operation:"reconcile"','operation:"commentCreate"']){
    const start=ui.indexOf(marker),persisted=ui.indexOf("setPendingRecipeIntent(intent)",start),sent=ui.indexOf("await submitRecipeIntent(intent,false)",persisted);
    assert.ok(start>=0&&persisted>start&&sent>persisted);
  }
});
