import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("phone app shell uses bounded primary nav plus overflow menu",async()=>{
  const shell=await read("components/app-shell.tsx");
  assert.ok(shell.includes('const primaryMobile=["/pos","/queue","/orders","/stock"]'));
  assert.ok(shell.includes('const overflowMobile=["/expenses","/close","/settings"]'));
  assert.ok(shell.includes("MoreHorizontal"));
  assert.ok(shell.includes("overflow-hidden"));
  assert.ok(shell.includes("min-h-11 min-w-0 flex-1"));
  assert.ok(!shell.includes("overflow-x-auto rounded-[20px] p-1 md:hidden"));
});

test("phone operational controls keep a 44px minimum hit area",async()=>{
  const css=await read("app/globals.css");
  assert.ok(css.includes(".field-app-root button{min-inline-size:44px;min-block-size:44px}"));
});

test("forced-width operator tables collapse into labeled phone cards",async()=>{
  const css=await read("app/globals.css");
  for(const width of ["680px","720px","780px","560px"])assert.ok(css.includes('table[class~="min-w-['+width+']"]'));
  assert.ok(css.includes('td:nth-child(1)::before{content:"ORDER"}'));
  assert.ok(css.includes('td:nth-child(3)::before{content:"DESCRIPTION"}'));
  assert.ok(css.includes('td:nth-child(7)::before{content:"สถานะ / จัดการ"}'));
  assert.ok(css.includes('td:nth-child(4)::before{content:"เวลา"}'));
});


test("payment review rows may wrap instead of overlapping at narrow phone widths",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.ok(pos.includes('mt-3 flex flex-wrap items-center justify-between gap-3'));
  assert.ok(pos.includes('field-payment-sheet'));
});
