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

test("expected SHA uses deployment SHA and scheduled release-marker history",()=>{
  const line=source.split("\n").find(x=>x.includes("EXPECTED_SHA:"))||"";
  assert.match(line,/deployment_status/);
  assert.match(line,/deployment\.environment == 'Production'/);
  assert.match(line,/deployment\.sha/);
  assert.doesNotMatch(line,/github\.sha/);
  assert.match(source,/git log -1 --format=%H -- \.vercel-release/);
  assert.match(source,/Resolve intended production release/);
});

test("scheduled and manual smoke remain enabled against production URL",()=>{
  assert.match(source,/github\.event_name == 'schedule'/);
  assert.match(source,/github\.event_name == 'workflow_dispatch'/);
  assert.match(source,/https:\/\/field-pos\.vercel\.app/);
});

test("production identity verification fails stale releases",()=>{
  assert.match(source,/if \[ "\$actual" != "\$RESOLVED_EXPECTED_SHA" \]/);
  assert.match(source,/Stale release: expected SHA/);
  assert.match(source,/release\.branch!=='main'/);
  assert.match(source,/release\.environment!=='production'/);
  assert.match(source,/release\.deploymentId/);
});

test("production smoke covers root redirect, go-live routes and auth guard",()=>{
  for(const path of ["/pos","/queue","/stock","/orders","/settings","/close","/backup"]){
    assert.ok(source.includes(path),path);
  }
  assert.match(source,/root_code=.*\$base\//);
  assert.match(source,/root_code" = "307"/);
  assert.match(source,/location:\[\[:space:\]\]\*\/pos/);
  assert.match(source,/for path in \/pos \/queue \/stock \/orders \/settings \/close \/backup/);
  assert.match(source,/for path in \/api\/pos\/bootstrap \/api\/expenses/);
  assert.match(source,/must reject unauthenticated access with HTTP 401/);
  assert.match(source,/content-security-policy/);
  assert.match(source,/x-content-type-options/);
});
