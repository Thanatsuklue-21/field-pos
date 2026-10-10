import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("manual preview smoke workflow is read-only and exact-commit gated",async()=>{
  const workflow=await read(".github/workflows/pwa-preview-smoke.yml");
  assert.ok(workflow.includes("workflow_dispatch:"));
  assert.ok(workflow.includes("base_url:"));
  assert.ok(workflow.includes("expected_sha:"));
  assert.ok(workflow.includes("contents: read"));
  assert.ok(workflow.includes("BASE_URL:"));
  assert.ok(workflow.includes("EXPECTED_SHA:"));
  assert.ok(workflow.includes("VERCEL_AUTOMATION_BYPASS_SECRET:"));
  assert.ok(workflow.includes("node scripts/pwa-smoke.mjs"));
});

test("secret-bearing preview workflow pins checkout and never prints the bypass secret",async()=>{
  const workflow=await read(".github/workflows/pwa-preview-smoke.yml");
  assert.ok(workflow.includes("actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683"));
  assert.ok(workflow.includes("persist-credentials: false"));
  assert.ok(!workflow.includes("actions/checkout@v"));
  assert.ok(!workflow.includes("echo $VERCEL_AUTOMATION_BYPASS_SECRET"));
  assert.ok(!workflow.includes("printenv"));
});
