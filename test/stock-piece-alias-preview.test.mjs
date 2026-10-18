import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {calculateReceivedQuantity,normalizeUsageUnit} from "../lib/domain/stock-units.mjs";

test("piece aliases used by legacy stock masters stay compatible",()=>{
  for(const unit of ["piece","pieces","pc","pcs","ชิ้น"])assert.equal(normalizeUsageUnit(unit),"piece");
});

test("one pack of 100 pieces converts correctly into legacy pcs stock",()=>{
  const out=calculateReceivedQuantity({packageQty:1,packSize:100,packSizeUnit:"piece",usageUnit:"pcs"});
  assert.equal(out.quantity,100);
  assert.equal(out.quantityPerPackage,100);
  assert.equal(out.approximate,false);
});

test("stock purchase preview delegates to the shared unit conversion domain",async()=>{
  const source=await readFile(new URL("../app/stock/page.tsx",import.meta.url),"utf8");
  const start=source.indexOf("function previewReceived");
  const end=source.indexOf("function compactMoney",start);
  const block=source.slice(start,end);
  assert.match(source,/calculateReceivedQuantity/);
  assert.match(block,/calculateReceivedQuantity\(\{packageQty:packs,packSize:size,packSizeUnit:fromUnit,usageUnit:toUnit\}\)/);
  assert.doesNotMatch(block,/from==="piece"&&\(to==="piece"\|\|to==="ชิ้น"\)/);
});
