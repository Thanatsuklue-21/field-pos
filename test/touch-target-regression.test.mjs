import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("admin product and cost controls keep mobile-safe touch targets",async()=>{
  const products=await read("app/products/page.tsx");
  const costs=await read("app/costs/page.tsx");

  assert.doesNotMatch(products,/grid h-9 w-9 place-items-center rounded-full border/);
  assert.match(products,/aria-label={"แก้เมนู "+x\.name}/);
  assert.match(products,/aria-label={"เก็บเมนู "+x\.name}/);
  assert.ok((products.match(/min-h-11/g)||[]).length>=10);
  assert.doesNotMatch(products,/rounded-lg border px-2 py-1 text-xs/);

  assert.doesNotMatch(costs,/grid h-9 w-9 place-items-center rounded-full bg-\[#d4af37\]/);
  assert.match(costs,/aria-label="บันทึกต้นทุนผันแปร"/);
  assert.match(costs,/min-h-11 rounded-full px-5 py-2 text-xs font-bold/);
});

test("AI quick actions remain comfortably tappable",async()=>{
  const ai=await read("components/ai-supervisor.tsx");
  assert.doesNotMatch(ai,/whitespace-nowrap rounded-full bg-slate-100 px-3 py-1\.5/);
  assert.ok((ai.match(/min-h-11 whitespace-nowrap rounded-full bg-slate-100/g)||[]).length>=3);
});
