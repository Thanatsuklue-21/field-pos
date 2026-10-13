import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("terminal PromptPay checkout does not clear pending until server stock release is confirmed",async()=>{
  const pos=await read("app/pos/page.tsx");
  const start=pos.indexOf('if(method==="promptpay")');
  const end=pos.indexOf('if(["bank","card"].includes(method))',start);
  const block=pos.slice(start,end);
  const term=block.slice(block.indexOf('if(["failed","expired","reversed"]'),block.indexOf('if(st.paid)',block.indexOf('if(["failed","expired","reversed"]')));
  assert.match(term,/const released=activePending\?await cancelPendingReservation\(activePending\):false/);
  assert.match(term,/if\(released\)\{/);
  assert.match(term,/pendingClear\(\)/);
  assert.match(term,/promptpay_release_unconfirmed/);
  assert.ok(term.indexOf("pendingClear()")>term.indexOf("if(released)"));
});

test("PromptPay recovery path and checkout path use the same release-confirmation invariant",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/ระบบชำระเงินแจ้งว่ารายการสิ้นสุดแล้ว แต่ยังยืนยันการคืนสต็อกไม่ได้/);
  const matches=[...pos.matchAll(/promptpay_release_unconfirmed/g)];
  assert.ok(matches.length>=2);
});
