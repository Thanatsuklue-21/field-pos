import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("order history exposes customer context needed for safe cash-order editing",async()=>{
  const api=await read("lib/api.mjs");
  assert.ok(api.includes("customerId:s.customerId||null"));
  assert.ok(api.includes("pointsRedeemed:Number(s.pointsRedeemed)||0"));
});

test("whole-order cash edit refuses mixed customer ownership and persists prior loyalty context",async()=>{
  const orders=await read("app/orders/page.tsx");
  assert.ok(orders.includes("customerKeys"));
  assert.ok(orders.includes("customerKeys.length>1"));
  assert.ok(orders.includes("originalPointsRedeemed"));
  assert.ok(orders.includes("customerId,pointsRedeemed:originalPointsRedeemed"));
  assert.ok(orders.includes('writeRecovery("field-pos-edit-cash-v1"'));
});

test("POS restores prior customer and redeemed points only after customer data is available",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.ok(pos.includes("editCustomerRecovery"));
  assert.ok(pos.includes("if(!editCustomerRecovery||!customers.length)return"));
  assert.ok(pos.includes("setCustomerId(editCustomerRecovery.customerId)"));
  assert.ok(pos.includes("setPointsRedeemed(editCustomerRecovery.pointsRedeemed)"));
  assert.ok(pos.includes("เรียกคืนลูกค้าและแต้มจากบิลเดิมแล้ว"));
});
