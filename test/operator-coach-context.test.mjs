import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("operator coach remembers POS and Queue training independently",async()=>{
  const coach=await read("components/operator-coach.tsx");
  assert.match(coach,/const KEY_PREFIX="field-operator-coach-v3:"/);
  assert.match(coach,/const seenKey=mode\?KEY_PREFIX\+mode:""/);
  assert.match(coach,/localStorage\.getItem\(seenKey\)!=="seen"/);
  assert.match(coach,/localStorage\.setItem\(seenKey,"seen"\)/);
  assert.match(coach,/path\.startsWith\("\/queue"\)\?"queue":path\.startsWith\("\/pos"\)\?"pos":""/);
});

test("one-minute guide stays closed during transaction work without marking the guide as completed",async()=>{
  const coach=await read("components/operator-coach.tsx");
  assert.match(coach,/field:transaction-busy/);
  assert.match(coach,/if\(next\)closeGuide\(false\)/);
  assert.match(coach,/disabled=\{busy\}/);
  assert.match(coach,/open&&!busy/);
});

test("operator coach dialog supports escape focus trapping scroll lock and focus return",async()=>{
  const coach=await read("components/operator-coach.tsx");
  assert.match(coach,/dialogRef=useRef<HTMLDivElement\|null>\(null\)/);
  assert.match(coach,/triggerRef=useRef<HTMLButtonElement\|null>\(null\)/);
  assert.match(coach,/document\.body\.style\.overflow="hidden"/);
  assert.match(coach,/event\.key==="Escape"/);
  assert.match(coach,/event\.key!=="Tab"/);
  assert.match(coach,/dialogRef\.current\.querySelectorAll/);
  assert.match(coach,/triggerRef\.current\?\.focus\(\)/);
  assert.match(coach,/role="dialog" aria-modal="true"/);
  assert.match(coach,/tabIndex=\{-1\}/);
});
