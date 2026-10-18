import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source=fs.readFileSync(new URL("../app/pos/page.tsx",import.meta.url),"utf8");

test("POS keeps operations hub off the initial critical path",()=>{
  assert.match(source,/dynamic\(\(\)=>import\("@\/components\/pos-operations-hub"\)/);
  assert.match(source,/\{opsOpen&&<PosOperationsHub/);
  assert.doesNotMatch(source,/import PosOperationsHub,\{type HubTab\}/);
  assert.doesNotMatch(source,/router\.prefetch\("\/(?:queue|orders)"\)/);
});
