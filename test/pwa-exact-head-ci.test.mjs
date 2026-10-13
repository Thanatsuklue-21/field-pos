import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("FIELD POS CI verifies the exact PWA branch head after every merge",async()=>{
  const workflow=await read(".github/workflows/ci.yml");
  const push=workflow.slice(workflow.indexOf("push:"),workflow.indexOf("pull_request:"));
  assert.match(push,/branches:/);
  assert.match(push,/- main/);
  assert.match(push,/- feat\/pwa-app-shell/);
  assert.match(workflow,/pull_request:[\s\S]*- feat\/pwa-app-shell/);
  assert.match(workflow,/npm test/);
  assert.match(workflow,/npm run build/);
});
