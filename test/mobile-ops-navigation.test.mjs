import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("mobile bar keeps only POS Queue and More as primary controls",async()=>{
  const shell=await read("components/app-shell.tsx");
  assert.match(shell,/const primaryMobile=\["\/pos","\/queue"\]/);
  assert.match(shell,/mobileMore\.length>0&&<button/);
  assert.doesNotMatch(shell,/const primaryMobile=\[[^\]]*"\/orders"/);
  assert.doesNotMatch(shell,/const primaryMobile=\[[^\]]*"\/stock"/);
});

test("mobile More prioritizes operational detail before administration",async()=>{
  const nav=await read("lib/mobile-navigation.ts");
  assert.match(nav,/const PRIORITY=\["\/orders","\/stock","\/expenses","\/close","\/settings"\]/);
});
