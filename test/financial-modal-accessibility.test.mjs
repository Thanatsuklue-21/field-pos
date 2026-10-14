import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("expense and cash drawer use the shared keyboard-safe modal contract",async()=>{
  const expenses=await read("app/expenses/page.tsx");
  const close=await read("app/close/page.tsx");

  assert.ok(expenses.includes('import ModalFocus from "@/components/modal-focus"'));
  assert.ok(expenses.includes('className="field-modal-overlay fixed inset-0 z-[80]'));
  assert.ok(expenses.includes('labelId="expense-dialog-title"'));
  assert.ok(expenses.includes('onEscape={busy?undefined:closeCreate}'));
  assert.ok(expenses.includes('className="field-modal-panel soft-scroll'));
  assert.ok(expenses.includes('onMouseDown={e=>e.stopPropagation()}'));

  assert.ok(close.includes('import ModalFocus from "@/components/modal-focus"'));
  assert.ok(close.includes('className="field-modal-overlay fixed inset-0 z-[100]'));
  assert.ok(close.includes('labelId="cash-drawer-dialog-title"'));
  assert.ok(close.includes('onEscape={busy?undefined:()=>setDrawerOpen(false)}'));
  assert.ok(close.includes('className="field-modal-panel soft-scroll'));
  assert.ok(close.includes('onMouseDown={e=>e.stopPropagation()}'));
});

test("shared modal focus preserves a valid React autofocus target unless caller overrides it",async()=>{
  const modal=await read("components/modal-focus.tsx");
  assert.ok(modal.includes('const preferred=initialFocusSelector?node.querySelector<HTMLElement>(initialFocusSelector):null'));
  assert.ok(modal.includes('const active=document.activeElement instanceof HTMLElement?document.activeElement:null'));
  assert.ok(modal.includes('const target=preferred||(active&&node.contains(active)?active:null)||focusables()[0]||node'));
  assert.ok(modal.includes('previous.focus({preventScroll:true})'));
  assert.ok(modal.includes('event.key==="Tab"'));
  assert.ok(modal.includes('event.key==="Escape"'));
});
