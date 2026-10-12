import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("split payment banner renders the live queue number instead of a literal template token",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/กลุ่มเดียวกัน · คิว \{splitGroup\.queueNo\}/);
  assert.doesNotMatch(pos,/คิว \$\{splitGroup\.queueNo\}/);
});
