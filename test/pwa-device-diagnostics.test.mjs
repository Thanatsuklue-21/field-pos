import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import ts from "typescript";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

async function loadDiagnostics({width,height,visualWidth,visualHeight,touchPoints=0}){
  const raw=await read("lib/device-uat-diagnostics.ts");
  const source=ts.transpileModule(raw,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};
  const window={
    innerWidth:width,
    innerHeight:height,
    visualViewport:visualWidth==null?null:{width:visualWidth,height:visualHeight},
  };
  const navigator={maxTouchPoints:touchPoints};
  runInNewContext(source,{exports,window,navigator});
  return exports.readDeviceUatDiagnostics();
}

test("390px Android-class viewport is identified as phone UAT target",async()=>{
  const d=await loadDiagnostics({width:390,height:844,visualWidth:390,visualHeight:500,touchPoints:5});
  assert.equal(d.viewportWidth,390);
  assert.equal(d.viewportHeight,844);
  assert.equal(d.visualViewportSupported,true);
  assert.equal(d.visualViewportWidth,390);
  assert.equal(d.visualViewportHeight,500);
  assert.equal(d.touchCapable,true);
  assert.equal(d.orientation,"portrait");
  assert.equal(d.targetClass,"phone");
});

test("1024x768 touch viewport is identified as landscape tablet UAT target",async()=>{
  const d=await loadDiagnostics({width:1024,height:768,visualWidth:1024,visualHeight:768,touchPoints:10});
  assert.equal(d.orientation,"landscape");
  assert.equal(d.targetClass,"tablet");
  assert.equal(d.touchCapable,true);
});

test("device UAT diagnostics deliberately avoid fingerprint-heavy identifiers",async()=>{
  const source=await read("lib/device-uat-diagnostics.ts");
  for(const forbidden of ["userAgent","platform","deviceMemory","hardwareConcurrency","vendor"])assert.ok(!source.includes(forbidden),forbidden);
});

test("PWA snapshot and readiness expose only coarse device acceptance evidence",async()=>{
  const runtime=await read("components/pwa-runtime.tsx"),ui=await read("components/pwa-readiness.tsx"),meta=await read("lib/pwa-meta.ts");
  for(const token of ["viewportWidth","viewportHeight","visualViewportSupported","touchCapable","orientation","targetClass"]){
    assert.ok(runtime.includes(token),token);
    assert.ok(meta.includes(token),token);
  }
  for(const label of ["Viewport","VisualViewport","Touch","Orientation","UAT Target"])assert.ok(ui.includes(label),label);
  assert.ok(ui.includes("ไม่ถือว่า Android acceptance ผ่านอัตโนมัติ"));
  assert.ok(meta.includes('FIELD_APP_VERSION="8.0.0-pwa.22"'));
});
