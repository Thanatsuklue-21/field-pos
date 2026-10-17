import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("expense reconnect recovery is deferred instead of dropped while a write mutex is settling",async()=>{
  const page=await read("app/expenses/page.tsx");
  assert.match(page,/let disposed=false,retryTimer:number\|undefined/);
  assert.match(page,/const writeSettling=savingRef\.current\|\|\(session\.user\.role==="admin"&&deleteSavingRef\.current\)/);
  assert.match(page,/if\(writeSettling\)\{/);
  assert.match(page,/retryTimer=window\.setTimeout\(\(\)=>\{retryTimer=undefined;reconnect\(\)\},100\)/);
  assert.match(page,/window\.addEventListener\("online",reconnect\)/);
  assert.match(page,/if\(retryTimer!==undefined\)window\.clearTimeout\(retryTimer\)/);
  assert.match(page,/disposed=true/);
});
