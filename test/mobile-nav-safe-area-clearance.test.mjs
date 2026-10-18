import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("mobile POS cart bar clears bottom navigation plus device safe area",async()=>{
  const pos=await read("app/pos/page.tsx");
  const css=await read("app/globals.css");
  assert.match(pos,/field-pos-mobile-cartbar/);
  assert.doesNotMatch(pos,/fixed bottom-\[70px\]/);
  assert.match(css,/\.field-pos-mobile-cartbar\{[\s\S]*bottom:calc\(64px \+ max\(\.35rem,env\(safe-area-inset-bottom\)\)\)/);
});

test("mobile page content also reserves safe-area-aware navigation clearance",async()=>{
  const shell=await read("components/app-shell.tsx");
  const css=await read("app/globals.css");
  assert.match(shell,/field-app-root/);
  assert.match(css,/@media \(max-width:639px\)\{[\s\S]*\.field-app-root\{[\s\S]*padding-bottom:calc\(70px \+ max\(\.35rem,env\(safe-area-inset-bottom\)\)\)/);
  assert.match(css,/@media \(min-width:640px\) and \(max-width:767px\)\{[\s\S]*padding-bottom:calc\(76px \+ max\(\.35rem,env\(safe-area-inset-bottom\)\)\)/);
});

test("mobile checkout remains above nav at both phone and small-tablet widths",async()=>{
  const css=await read("app/globals.css");
  assert.match(css,/@media \(min-width:640px\) and \(max-width:1023px\)\{[\s\S]*\.field-pos-mobile-cartbar\{[\s\S]*bottom:calc\(72px \+ max\(\.35rem,env\(safe-area-inset-bottom\)\)\)/);
});
