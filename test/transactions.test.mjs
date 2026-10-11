import test from "node:test";
import assert from "node:assert/strict";
import {beginWriteTransaction,commitWriteTransaction} from "../lib/transactions.mjs";

test("write transaction acquisition tolerates sustained transient libSQL busy contention",async()=>{
  let calls=0;
  const tx={};
  const db={async transaction(){
    calls++;
    if(calls<7)throw Object.assign(new Error("busy"),{code:"SQLITE_BUSY"});
    return tx;
  }};
  assert.equal(await beginWriteTransaction(db),tx);
  assert.equal(calls,7);
});

test("commit tolerates sustained SQLITE_BUSY on the same transaction and then succeeds",async()=>{
  let calls=0;
  const tx={async commit(){
    calls++;
    if(calls<7)throw Object.assign(new Error("busy"),{code:"SQLITE_BUSY"});
  }};
  await commitWriteTransaction(tx);
  assert.equal(calls,7);
});

test("write transactions on one client serialize so a second stale device reads after first commit",async()=>{
  let opens=0;
  const events=[];
  const makeTx=id=>({
    async commit(){events.push("commit-"+id)},
    async rollback(){events.push("rollback-"+id)}
  });
  const db={async transaction(){opens++;events.push("open-"+opens);return makeTx(opens)}};
  const first=await beginWriteTransaction(db);
  let secondResolved=false;
  const secondPromise=beginWriteTransaction(db).then(tx=>{secondResolved=true;return tx});
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(secondResolved,false);
  assert.deepEqual(events,["open-1"]);
  await commitWriteTransaction(first);
  const second=await secondPromise;
  assert.equal(secondResolved,true);
  assert.deepEqual(events,["open-1","commit-1","open-2"]);
  await second.rollback();
  assert.deepEqual(events,["open-1","commit-1","open-2","rollback-2"]);
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

