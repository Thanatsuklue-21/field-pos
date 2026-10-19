import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("stock archive and reset use guided in-app review instead of browser confirm",async()=>{
  const ui=await read("app/stock/page.tsx");
  const start=ui.indexOf("async function performIngredientAction");
  const end=ui.indexOf("function openCount",start);
  const block=ui.slice(start,end);
  assert.match(block,/setIngredientReview/);
  assert.match(block,/confirmIngredientReview/);
  assert.doesNotMatch(block,/window\.confirm/);
  assert.match(ui,/stock-ingredient-review-title/);
  assert.match(ui,/Audit เดิมยังเก็บไว้/);
});

test("cycle-count approve and reject stay in-app and retain durable stock intent",async()=>{
  const ui=await read("app/stock/page.tsx");
  const start=ui.indexOf("function reviewCountProposal");
  const end=ui.indexOf("async function savePurchaseEdit",start);
  const block=ui.slice(start,end);
  assert.match(block,/setCountReview/);
  assert.match(block,/confirmCountReview/);
  assert.doesNotMatch(block,/window\.confirm/);
  assert.doesNotMatch(block,/window\.prompt/);
  assert.match(block,/prepareStockWriteIntent/);
  assert.match(block,/setPendingStockIntent\(intent\)/);
  assert.match(block,/submitStockIntent\(intent,false\)/);
  assert.match(ui,/stock-count-review-title/);
  assert.match(ui,/Server จะตรวจว่าข้อมูลยังไม่เปลี่ยน/);
});

test("guided stock mutation modals fail closed while writes are busy or pending",async()=>{
  const ui=await read("app/stock/page.tsx");
  assert.match(ui,/onEscape=\{busy\?undefined:\(\)=>setIngredientReview\(null\)\}/);
  assert.match(ui,/onEscape=\{busy\|\|!!pendingStockIntent\?undefined:\(\)=>setCountReview\(null\)\}/);
  assert.match(ui,/disabled=\{busy\|\|!!pendingStockIntent/);
});
