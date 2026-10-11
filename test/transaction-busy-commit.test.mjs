import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {commitWriteTransaction} from "../lib/transactions.mjs";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("same SQLite commit retries SQLITE_BUSY without replaying transaction work",async()=>{
  let attempts=0;
  const tx={commit:async()=>{
    attempts++;
    if(attempts<3)throw Object.assign(new Error("locked"),{code:"SQLITE_BUSY"});
    return "committed";
  }};
  assert.equal(await commitWriteTransaction(tx),"committed");
  assert.equal(attempts,3);
});

test("commit helper does not retry ambiguous snapshot/provider failures",async()=>{
  let attempts=0;
  const failure=Object.assign(new Error("snapshot busy"),{code:"SQLITE_BUSY_SNAPSHOT"});
  const tx={commit:async()=>{attempts++;throw failure}};
  await assert.rejects(()=>commitWriteTransaction(tx),error=>error===failure);
  assert.equal(attempts,1);
});

test("queue actions use same-transaction busy commit recovery instead of replaying the mutation",async()=>{
  const source=await read("lib/pos-api.mjs");
  const start=source.indexOf("export async function queuePosAction");
  const end=source.indexOf("\nexport async function",start+20);
  const block=source.slice(start,end>0?end:source.length);
  assert.match(source,/import \{beginWriteTransaction,commitWriteTransaction\} from '\.\/transactions\.mjs'/);
  assert.match(block,/await commitWriteTransaction\(tx\)/);
  assert.doesNotMatch(block,/await tx\.commit\(\)/);
});
