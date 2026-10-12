import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("client telemetry is optional and does not create a second analytics stack",async()=>{
  const telemetry=await read("lib/client-telemetry.ts");
  assert.ok(telemetry.includes("window as any).posthog?.capture?."));
  assert.ok(!telemetry.includes("localStorage"));
  assert.ok(!telemetry.includes("fetch("));
});

test("checkout and queue latency telemetry never includes request payloads",async()=>{
  const api=await read("lib/api-client.ts");
  assert.ok(api.includes('"checkout_latency"'));
  assert.ok(api.includes('"queue_action_latency"'));
  assert.ok(api.includes("duration_ms:elapsedMs(started)"));
  assert.ok(api.includes("http_status:httpStatus"));
  assert.ok(api.includes("success:httpStatus>=200&&httpStatus<300"));
  const telemetryCall=api.slice(api.indexOf("if(metric)captureClientTelemetry"),api.indexOf("if(metric)captureClientTelemetry")+240);
  assert.ok(!telemetryCall.includes("body"));
  assert.ok(!telemetryCall.includes("customer"));
  assert.ok(!telemetryCall.includes("cart"));
});

test("runtime errors capture only coarse error metadata without messages or stacks",async()=>{
  const runtime=await read("components/pwa-runtime.tsx");
  assert.ok(runtime.includes('capture("runtime_error"'));
  assert.ok(runtime.includes('kind:"error"'));
  assert.ok(runtime.includes('kind:"unhandledrejection"'));
  assert.ok(runtime.includes("window.addEventListener(\"error\",runtimeError)"));
  assert.ok(runtime.includes("window.addEventListener(\"unhandledrejection\",unhandledRejection)"));
  const start=runtime.indexOf("const runtimeError=");
  const end=runtime.indexOf("const syncEvent=",start);
  const block=runtime.slice(start,end);
  assert.ok(!block.includes(".message"));
  assert.ok(!block.includes(".stack"));
});
