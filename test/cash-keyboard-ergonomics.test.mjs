import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("cash tender does not summon the mobile keyboard before the operator needs it",async()=>{
  const pos=await read("app/pos/page.tsx");
  const cashStart=pos.indexOf('tenderUnlocked&&method==="cash"');
  const cashBlock=pos.slice(cashStart,cashStart+5000);
  assert.ok(cashStart>=0);
  assert.ok(!cashBlock.includes("autoFocus"));
  assert.ok(cashBlock.includes('inputMode="decimal"'));
  assert.ok(cashBlock.includes('enterKeyHint="done"'));
});

test("one-tap tender choices dismiss an already-open keyboard",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.ok(pos.includes("function chooseCashAmount(amount:number)"));
  assert.ok(pos.includes("document.activeElement.blur()"));
  assert.ok(pos.includes("onClick={()=>chooseCashAmount(netPayable)}"));
  assert.ok(pos.includes("onClick={()=>chooseCashAmount(amount)}"));
});
