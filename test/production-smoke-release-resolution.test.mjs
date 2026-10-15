import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("scheduled production smoke resolves the deployed merge commit on main first-parent",async()=>{
  const workflow=await read(".github/workflows/production-smoke.yml");
  assert.match(workflow,/git log --first-parent -1 --format=%H -- \.vercel-release/);
  assert.doesNotMatch(workflow,/expected="\$\(git log -1 --format=%H -- \.vercel-release\)"/);
  assert.match(workflow,/Stale release: expected SHA/);
  assert.match(workflow,/github\.event\.deployment\.sha/);
});
