import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("receipt portal never touches document during server render",async()=>{
  const receipt=await read("components/sale-receipt.tsx");
  assert.match(receipt,/useEffect\(\(\)=>setMounted\(true\),\[\]\)/);
  assert.match(receipt,/if\(!mounted\|\|typeof document==="undefined"\)return null/);
  const guard=receipt.indexOf('if(!mounted||typeof document==="undefined")return null');
  const portal=receipt.indexOf('createPortal(');
  assert.ok(guard>0&&portal>guard);
});

test("order history exposes configured receipt paper width",async()=>{
  const api=await read("lib/api.mjs");
  const start=api.indexOf("if(path==='/api/pos/history'&&method==='GET')");
  const end=api.indexOf("if(path==='/api/pos/queue'&&method==='GET')",start);
  const block=api.slice(start,end);
  assert.match(block,/receiptPaperWidth:Number\(doc\.settings\?\.receiptPaperWidth\)===58\?58:80/);
});

test("historical reprint uses the same 58 or 80 mm setting as live POS",async()=>{
  const orders=await read("app/orders/page.tsx");
  assert.match(orders,/receiptPaperWidth,setReceiptPaperWidth/);
  assert.match(orders,/receiptPaperWidth\?:58\|80/);
  assert.match(orders,/setReceiptPaperWidth\(Number\(x\.receiptPaperWidth\)===58\?58:80\)/);
  assert.match(orders,/<SaleReceipt sale=\{detail\} paperWidth=\{receiptPaperWidth\}\/>/);

  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/<SaleReceipt sale=\{lastSale\.receipt\} paperWidth=\{receiptPaperWidth\}\/>/);
});
