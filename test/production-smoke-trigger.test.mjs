import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const source=await readFile(new URL("../.github/workflows/production-smoke.yml",import.meta.url),"utf8");

test("deployment-triggered production smoke ignores preview environments",()=>{
  assert.match(source,/github\.event\.deployment\.environment == 'Production'/);
  assert.match(source,/github\.event\.deployment\.environment == 'production'/);
  const jobIf=source.slice(source.indexOf("jobs:"),source.indexOf("runs-on:"));
  assert.match(jobIf,/deployment_status\.state == 'success'/);
  assert.match(jobIf,/deployment\.environment == 'Production'/);
});

test("expected SHA is populated only for a production deployment event",()=>{
  const line=source.split("\n").find(x=>x.includes("EXPECTED_SHA:"))||"";
  assert.match(line,/deployment_status/);
  assert.match(line,/deployment\.environment == 'Production'/);
  assert.match(line,/deployment\.sha/);
});

test("scheduled and manual smoke remain enabled against production URL",()=>{
  assert.match(source,/github\.event_name == 'schedule'/);
  assert.match(source,/github\.event_name == 'workflow_dispatch'/);
  assert.match(source,/https:\/\/field-pos\.vercel\.app/);
});

test("production identity verification still fails stale releases",()=>{
  assert.match(source,/if \[ "\$actual" != "\$EXPECTED_SHA" \]/);
  assert.match(source,/Stale release: expected SHA/);
});


test("smoke covers every go-live core route",()=>{
  assert.match(source,/for path in \/ \/pos \/queue \/stock \/orders \/settings \/close; do/);
});

test("scheduled smoke resolves the approved production release marker",()=>{
  assert.match(source,/Checkout release history/);
  assert.match(source,/git log -1 --format=%H -- \.vercel-release/);
  assert.match(source,/EXPECTED_SHA=\$expected.*GITHUB_ENV/);
  assert.doesNotMatch(source,/if: env\.EXPECTED_SHA != ''\n\s*shell: bash/);
});
