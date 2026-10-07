import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("all phone modal cards are bounded by Android visual viewport",async()=>{
  const css=await read("app/globals.css");
  assert.ok(css.includes(".field-app-root .fixed.inset-0>.card"));
  assert.ok(css.includes("var(--field-visual-viewport-height,100dvh) - 1rem"));
  assert.ok(css.includes("overscroll-behavior:contain"));
});

test("phone form fields cannot force two-column admin grids wider than viewport",async()=>{
  const css=await read("app/globals.css");
  assert.ok(css.includes(".field-app-root input"));
  assert.ok(css.includes(".field-app-root select"));
  assert.ok(css.includes("min-inline-size:0;max-inline-size:100%"));
});
