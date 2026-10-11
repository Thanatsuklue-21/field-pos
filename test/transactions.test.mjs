import test from "node:test";
import assert from "node:assert/strict";
import {beginWriteTransaction,commitWriteTransaction} from "../lib/transactions.mjs";

test("write transaction acquisition retries transient libSQL busy errors",async()=>{
  let calls=0;
  const tx={};
  const db={async transaction(){
    calls++;
    if(calls<3)throw Object.assign(new Error("busy"),{code:"SQLITE_BUSY"});
    return tx;
  }};
  assert.equal(await beginWriteTransaction(db),tx);
  assert.equal(calls,3);
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
