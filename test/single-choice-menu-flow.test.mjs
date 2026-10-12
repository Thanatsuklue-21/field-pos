import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("single-choice menus skip the redundant modifier dialog",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/function selectMenu\(product:MenuItem\)/);
  assert.match(pos,/if\(product\.variants\.length===1\)/);
  assert.match(pos,/if\(variant\.available&&remaining>0\)\{addVariant\(product,variant\);return\}/);
  assert.match(pos,/onClick=\{\(\)=>selectMenu\(x\)\}/);
});

test("multi-choice or unavailable single-choice menus still use the existing selector",async()=>{
  const pos=await read("app/pos/page.tsx");
  const start=pos.indexOf("function selectMenu");
  const end=pos.indexOf("function addVariant",start);
  const block=pos.slice(start,end);
  assert.match(block,/setSelected\(product\)/);
  assert.match(block,/additionalServingsAvailable/);
});

test("direct-add still routes through the same stock-safe addVariant path",async()=>{
  const pos=await read("app/pos/page.tsx");
  const select=pos.slice(pos.indexOf("function selectMenu"),pos.indexOf("function addVariant"));
  assert.match(select,/addVariant\(product,variant\)/);
  const add=pos.slice(pos.indexOf("function addVariant"),pos.indexOf("function updateCartQuantity"));
  assert.match(add,/additionalServingsAvailable/);
  assert.match(add,/cart\.addItem/);
  assert.match(add,/setNotice/);
});
