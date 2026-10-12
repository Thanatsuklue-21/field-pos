import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("mobile More menu behaves as a trapped modal and restores the trigger",async()=>{
  const shell=await read("components/app-shell.tsx");
  assert.match(shell,/ref=\{moreDialogRef\}/);
  assert.match(shell,/role="dialog"/);
  assert.match(shell,/aria-modal="true"/);
  assert.match(shell,/tabIndex=\{-1\}/);
  assert.match(shell,/document\.body\.style\.overflow="hidden"/);
  assert.match(shell,/document\.body\.style\.overflow=previousOverflow/);
  assert.match(shell,/event\.key!=="Tab"/);
  assert.match(shell,/event\.shiftKey/);
  assert.match(shell,/dialog\?\.contains\(active\)/);
  assert.match(shell,/event\.key==="Escape"/);
  assert.match(shell,/moreTriggerRef\.current\?\.focus\(\)/);
});

test("mobile More backdrop and close affordance share focus-restoring dismissal",async()=>{
  const shell=await read("components/app-shell.tsx");
  assert.match(shell,/const closeMore=\(\)=>\{/);
  assert.match(shell,/onClick=\{closeMore\}/);
  assert.match(shell,/aria-label="ปิดเมนูอื่น"/);
});
