import test from "node:test";
import assert from "node:assert/strict";
import {beginWriteTransaction,commitWriteTransaction} from "../lib/transactions.mjs";

test("write transaction acquisition retries transient libSQL busy errors",async()=>{
  let calls=0;
  const raw={async rollback(){}};
  const db={async transaction(){
    calls++;
    if(calls<3)throw Object.assign(new Error("busy"),{code:"SQLITE_BUSY"});
    return raw;
  }};
  const tx=await beginWriteTransaction(db);
  assert.equal(typeof tx.rollback,"function");
  assert.equal(calls,3);
  await tx.rollback();
});

test("same database client serializes writes until the active transaction settles",async()=>{
  let opens=0;
  const db={async transaction(){
    const id=++opens;
    return {id,async commit(){},async rollback(){}};
  }};
  const first=await beginWriteTransaction(db);
  let secondResolved=false;
  const secondPromise=beginWriteTransaction(db).then(tx=>{secondResolved=true;return tx});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(opens,1);
  assert.equal(secondResolved,false);
  await commitWriteTransaction(first);
  const second=await secondPromise;
  assert.equal(opens,2);
  assert.equal(second.id,2);
  await second.rollback();
});

test("rollback releases the per-client write slot",async()=>{
  let opens=0;
  const db={async transaction(){opens++;return {async commit(){},async rollback(){}}}};
  const first=await beginWriteTransaction(db);
  const secondPromise=beginWriteTransaction(db);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(opens,1);
  await first.rollback();
  const second=await secondPromise;
  assert.equal(opens,2);
  await second.rollback();
});

test("commit retries SQLITE_BUSY on the same transaction and then succeeds",async()=>{
  let calls=0;
  const tx={async commit(){
    calls++;
    if(calls<3)throw Object.assign(new Error("busy"),{code:"SQLITE_BUSY"});
  }};
  await commitWriteTransaction(tx);
  assert.equal(calls,3);
});

test("commit never retries SQLITE_BUSY_SNAPSHOT or unknown outcomes",async()=>{
  for(const code of ["SQLITE_BUSY_SNAPSHOT","ECONNRESET",undefined]){
    let calls=0;
    const error=Object.assign(new Error("commit failed"),code?{code}:{});
    const tx={async commit(){calls++;throw error}};
    await assert.rejects(commitWriteTransaction(tx),candidate=>candidate===error);
    assert.equal(calls,1);
  }
});

test("critical write modules route commits through the bounded helper",async()=>{
  const {readFile}=await import("node:fs/promises");
  for(const path of ["lib/pos-api.mjs","lib/api.mjs","lib/stock-service.mjs"]){
    const source=await readFile(new URL("../"+path,import.meta.url),"utf8");
    assert.match(source,/commitWriteTransaction/);
    assert.doesNotMatch(source,/await tx\.commit\(\)/);
  }
});

test("purchase edit date rejection rolls back before returning",async()=>{
  const {readFile}=await import("node:fs/promises");
  const source=await readFile(new URL("../lib/api.mjs",import.meta.url),"utf8");
  assert.match(source,/invalid_purchase_date[^\n]*\{await tx\.rollback\(\);return reply/);
  assert.match(source,/if\(purchaseDate>bangkokDate\(now\)\)\{await tx\.rollback\(\);return reply/);
});

