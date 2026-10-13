import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("POS dialogs trap keyboard focus, restore focus and expose dialog semantics",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/function useDialogKeyboard/);
  assert.match(pos,/event\.key==="Escape"/);
  assert.match(pos,/event\.key!=="Tab"/);
  assert.match(pos,/previous\.focus\(\{preventScroll:true\}\)/);
  assert.match(pos,/ref=\{menuDialogRef\} role="dialog" aria-modal="true"/);
  assert.match(pos,/aria-labelledby="field-variant-title"/);
  assert.match(pos,/ref=\{paymentDialogRef\} role="dialog" aria-modal="true"/);
  assert.match(pos,/aria-labelledby="field-payment-title"/);
});

test("payment modal remains keyboard and safe-area aware on small PWA viewports",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/safe-area-inset-top/);
  assert.match(pos,/safe-area-inset-bottom/);
  assert.match(pos,/safe-area-inset-left/);
  assert.match(pos,/safe-area-inset-right/);
  assert.match(pos,/100dvh/);
  assert.match(pos,/overscroll-contain/);
  assert.match(pos,/data-dialog-initial-focus autoFocus inputMode="decimal"/);
});

test("mobile dialog patch does not alter durable payment identity or stock recovery contracts",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/field-pos-pending-promptpay-v1/);
  assert.match(pos,/field-pos-pending-cash-v1/);
  assert.match(pos,/requestKey:p\.requestKey/);
  assert.match(pos,/recoverPending/);
  assert.match(pos,/recoverCashCheckout/);
});
