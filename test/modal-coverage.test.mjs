import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("operational overlays use the shared modal keyboard and safe-area contract",async()=>{
  const cases=[
    ["app/orders/page.tsx",["payment-recovery-title","refund-review-title","cash-action-review-title","order-detail-title"],4],
    ["app/stock/page.tsx",["stock-ingredient-review-title","stock-count-review-title","stock-transaction-title","stock-master-title","stock-daily-count-title","stock-purchase-edit-title"],6],
    ["app/products/page.tsx",["product-structure-title","product-edit-title","product-archive-title"],3],
    ["app/settlements/page.tsx",["settlement-reconcile-title","settlement-cancel-title"],2],
    ["components/ai-supervisor.tsx",["ai-supervisor-title"],1],
    ["app/expenses/page.tsx",["expense-dialog-title"],1],
    ["app/close/page.tsx",["open-shift-review-title","close-day-review-title","cash-drawer-dialog-title"],3],
    ["app/customers/page.tsx",["customer-create-title"],1],
    ["app/queue/page.tsx",["queue-waste-review-title"],1]
  ];
  for(const [path,labels,count] of cases){
    const source=await read(path);
    assert.equal((source.match(/<ModalFocus/g)||[]).length,count,path+" ModalFocus count");
    assert.equal((source.match(/field-modal-overlay/g)||[]).length,count,path+" overlay count");
    assert.equal((source.match(/field-modal-panel/g)||[]).length,count,path+" panel count");
    assert.doesNotMatch(source,/role="dialog"/,path+" must delegate dialog semantics");
    for(const label of labels)assert.ok(source.includes('labelId="'+label+'"'),path+" label "+label);
  }
});

test("financial and stock mutation modals cannot escape-dismiss while busy",async()=>{
  const orders=await read("app/orders/page.tsx");
  const stock=await read("app/stock/page.tsx");
  const settlements=await read("app/settlements/page.tsx");
  const products=await read("app/products/page.tsx");
  const queue=await read("app/queue/page.tsx");

  assert.ok(orders.includes('onEscape={busy?undefined:()=>setRecoveryDetail(null)}'));
  assert.ok(orders.includes('onEscape={busy?undefined:()=>setRefundReview(null)}'));
  assert.ok(orders.includes('onEscape={busy?undefined:()=>setCashActionReview(null)}'));
  assert.ok(stock.includes('onEscape={busy?undefined:()=>setIngredientReview(null)}'));
  assert.ok(stock.includes('onEscape={busy||!!pendingStockIntent?undefined:()=>setCountReview(null)}'));
  assert.ok(stock.includes('onEscape={busy?undefined:()=>setTxOpen(null)}'));
  assert.ok(stock.includes('onEscape={busy?undefined:()=>{setMaster(null);setMasterMsg("")}}'));
  assert.ok(stock.includes('onEscape={busy?undefined:()=>setCountOpen(false)}'));
  assert.ok(stock.includes('onEscape={busy?undefined:()=>setPurchaseEdit(null)}'));
  assert.ok((await read("app/close/page.tsx")).includes('onEscape={busy?undefined:()=>setOpenShiftReview(null)}'));
  assert.ok((await read("app/close/page.tsx")).includes('onEscape={busy?undefined:()=>setCloseDayReview(null)}'));
  assert.ok(settlements.includes('onEscape={busy?undefined:()=>setSelected(null)}'));
  assert.ok(settlements.includes('onEscape={busy?undefined:closeCancelReview}'));
  assert.ok(products.includes('onEscape={busy?undefined:()=>setStructureOpen(false)}'));
  assert.ok(products.includes('onEscape={busy?undefined:()=>{setEdit(null);setPendingImage("")}}'));
  assert.ok(products.includes('onEscape={busy?undefined:()=>setDel(null)}'));
  assert.ok(queue.includes('onEscape={busy?undefined:()=>setWasteReview(null)}'));
});

test("Today Workspace retains its complete custom focus trap",async()=>{
  const workspace=await read("components/pos-daily-workspace.tsx");
  assert.ok(workspace.includes('role="dialog"'));
  assert.ok(workspace.includes('aria-modal="true"'));
  assert.ok(workspace.includes('event.key==="Escape"'));
  assert.ok(workspace.includes('event.key!=="Tab"'));
  assert.ok(workspace.includes('document.addEventListener("keydown",onKey)'));
  assert.ok(workspace.includes('document.removeEventListener("keydown",onKey)'));
  assert.ok(workspace.includes('previous?.focus()'));
});


test("customer create dialog traps focus, restores focus and stays above mobile navigation",async()=>{
  const customers=await read("app/customers/page.tsx");
  assert.match(customers,/import ModalFocus from "@\/components\/modal-focus"/);
  assert.match(customers,/field-modal-overlay fixed inset-0 z-\[80\]/);
  assert.match(customers,/labelId="customer-create-title"/);
  assert.match(customers,/initialFocusSelector='\[aria-label="ชื่อลูกค้า"\]'/);
  assert.match(customers,/onEscape=\{creatingCustomer\|\|!!pendingCustomerCreate\?undefined:\(\)=>setOpen\(false\)\}/);
  assert.match(customers,/aria-label="ปิดหน้าต่างเพิ่มลูกค้า"/);
  assert.match(customers,/aria-label="ชื่อลูกค้า"/);
  assert.match(customers,/aria-label="เบอร์โทรลูกค้า"/);
  assert.match(customers,/inputMode="tel"/);
});
