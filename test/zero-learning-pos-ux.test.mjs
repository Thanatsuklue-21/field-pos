import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("POS teaches the core sale flow with visible 1-2-3 guidance",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.ok(pos.includes('const orderStep=payOpen?3:cart.items.length?2:1'));
  assert.ok(pos.includes('["1","เลือกเมนู"]'));
  assert.ok(pos.includes('["2","เพิ่ม / ตรวจ"]'));
  assert.ok(pos.includes('["3","รับเงิน"]'));
  assert.ok(pos.includes("แตะเมนู → เพิ่ม / ตรวจ → รับเงิน"));
});

test("single-variant products add directly while multi-variant drinks still ask for a choice",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.ok(pos.includes("function chooseMenu(product:MenuItem)"));
  assert.ok(pos.includes("if(product.variants.length===1)"));
  assert.ok(pos.includes("addVariant(product,product.variants[0])"));
  assert.ok(pos.includes("setSelected(product)"));
  assert.ok(pos.includes("onClick={()=>chooseMenu(x)}"));
});

test("normal payment stays compact while split bill keeps line-item controls explicit",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.ok(pos.includes("const [paymentReviewOpen,setPaymentReviewOpen]=useState(false)"));
  assert.ok(pos.includes("setPaymentReviewOpen(false)"));
  assert.ok(pos.includes("(splitBill||paymentReviewOpen)&&"));
  assert.ok(pos.includes('paymentReviewOpen?"ซ่อนรายการ":"ดูรายการ"'));
  assert.ok(pos.includes("setPaymentReviewOpen(next)"));
  assert.ok(pos.includes("flex items-end justify-center"));
  assert.ok(pos.includes("sticky bottom-0 z-10"));
});

test("primary POS actions use operator language instead of developer checkout jargon",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/aria-label="ชำระเงิน"[^>]*>รับเงิน/);
  assert.ok(pos.includes('"ยืนยันรับเงิน"'));
  assert.ok(pos.includes('"สร้าง QR ให้ลูกค้า"'));
  assert.ok(pos.includes("เลือกระดับหวาน / สูตร"));
  assert.ok(pos.includes("เลือกวิธีชำระ"));
  assert.ok(pos.includes("ยอดสินค้า"));
  assert.ok(pos.includes("รวมสุทธิ"));
});

test("cash payment provides common one-tap tender amounts",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.ok(pos.includes("const quickCashAmounts="));
  assert.ok(pos.includes("quickCashAmounts.map"));
  assert.ok(pos.includes("setReceived(String(amount))"));
  assert.ok(pos.includes("รับพอดี ฿{netPayable.toFixed(0)}"));
});

test("menu rendering and touch ergonomics stay mobile friendly",async()=>{
  const pos=await read("app/pos/page.tsx"),css=await read("app/globals.css");
  assert.ok(pos.includes('loading="lazy"'));
  assert.ok(pos.includes('decoding="async"'));
  assert.ok(pos.includes("pos-menu-card"));
  assert.ok(css.includes(".pos-menu-card{content-visibility:auto"));
  assert.ok(css.includes('.field-app-root :is(button,a[href],[role="button"]){'));
  assert.ok(css.includes("min-block-size:44px;"));
  assert.ok(css.includes("min-inline-size:44px;"));
  assert.ok(css.includes("input,select,textarea{font-size:16px}"));
});

test("navigation keeps sale and production primary while secondary work stays one tap away",async()=>{
  const shell=await read("components/app-shell.tsx");
  assert.ok(shell.includes('const focusPrimary=["/pos","/queue","/orders","/stock","/close"]'));
  assert.ok(shell.includes('const primaryMobile=["/pos","/queue"]'));
  assert.ok(shell.includes('const mobileMorePriority=["/orders","/stock","/expenses","/close","/settings"]'));
  assert.ok(shell.includes("desktopPrimary"));
  assert.ok(shell.includes("desktopManage"));
  assert.ok(shell.includes('aria-controls="field-desktop-manage"'));
  assert.ok(shell.includes('aria-label="จัดการร้านและตั้งค่า"'));
  assert.ok(shell.includes("manageOpen&&"));
  assert.ok(shell.includes("mobilePrimary"));
  assert.ok(shell.includes("mobileMore"));
  assert.ok(shell.includes("MoreHorizontal"));
  assert.ok(shell.includes('aria-controls="field-mobile-more"'));
  assert.ok(shell.includes("max-h-[calc(100dvh-110px)] overflow-y-auto overscroll-contain"));
  assert.ok(shell.includes("overflow-hidden rounded-[20px]"));
});

test("order history becomes card-based on phones while desktop keeps the table",async()=>{
  const orders=await read("app/orders/page.tsx");
  assert.ok(orders.includes('space-y-2 sm:hidden'));
  assert.ok(orders.includes('hidden sm:block'));
  assert.ok(orders.includes('h-11 w-11'));
  assert.ok(orders.includes('aria-label="ปิดรายละเอียด"'));
});


test("POS dialogs trap keyboard focus, restore focus, and respect mobile safe areas",async()=>{
  const pos=await read("app/pos/page.tsx");
  const modal=await read("components/modal-focus.tsx");
  const css=await read("app/globals.css");
  assert.ok(pos.includes('import ModalFocus from "@/components/modal-focus"'));
  assert.ok(pos.includes('labelId="field-held-title"'));
  assert.ok(pos.includes('labelId="field-modifier-title"'));
  assert.ok(pos.includes('labelId="field-payment-title"'));
  assert.ok(pos.includes('onEscape={busy||hasPendingPrompt?undefined:()=>setPayOpen(false)}'));
  assert.match(pos,/disabled=\{busy\|\|hasPendingPrompt\} onClick=\{\(\)=>setPayOpen\(false\)\}/);
  assert.ok(modal.includes('role="dialog"'));
  assert.ok(modal.includes('aria-modal="true"'));
  assert.ok(modal.includes('event.key==="Tab"'));
  assert.ok(modal.includes('event.key==="Escape"'));
  assert.ok(modal.includes('previous.focus({preventScroll:true})'));
  assert.ok(css.includes(".field-modal-overlay"));
  assert.ok(css.includes("env(safe-area-inset-bottom)"));
  assert.ok(css.includes("100dvh"));
  assert.ok(css.includes("100svh"));
});


test("cashier-facing POS status copy avoids infrastructure jargon",async()=>{
  const pos=await read("app/pos/page.tsx");
  for(const phrase of [
    "Offline Mode",
    "Sync Cloud",
    "Stock reservation",
    "Beam Merchant/API/Webhook",
    "เลขอ้างอิงบัตร / Terminal",
    "Slip/Terminal ref",
    "Export บัญชี",
    "OFFLINE ORDER"
  ]) assert.equal(pos.includes(phrase),false,"cashier copy leaks "+phrase);

  assert.match(pos,/เน็ตหลุด/);
  assert.match(pos,/การจองวัตถุดิบ/);
  assert.match(pos,/ให้เจ้าของร้านตรวจการตั้งค่า PromptPay/);
  assert.match(pos,/เลขอ้างอิงจากเครื่องรับบัตร/);
  assert.match(pos,/รายงานบัญชี/);
  assert.match(pos,/บิลรอส่ง/);
  assert.match(pos,/ห้ามล้างข้อมูลแอปหรือเบราว์เซอร์/);
});


test("post-payment handoff blocks the sale screen until the cashier chooses the next safe action",async()=>{
  const pos=await read("app/pos/page.tsx");
  const start=pos.indexOf("{lastSale&&");
  const end=pos.indexOf("{workspaceMounted&&",start);
  const handoff=pos.slice(start,end);
  assert.match(handoff,/fixed inset-0 z-\[95\]/);
  assert.match(handoff,/bg-slate-950\/20/);
  assert.doesNotMatch(handoff,/bg-black\/30/);
  assert.match(handoff,/ModalFocus labelId="field-payment-handoff-title"/);
  assert.match(handoff,/initialFocusSelector='\[data-handoff-primary\]'/);
  assert.match(handoff,/data-handoff-primary/);
  assert.match(handoff,/รับออเดอร์ถัดไป/);
  assert.match(handoff,/ทำคิว \{lastSale\.queueNo\} ตรงนี้/);
  assert.match(handoff,/เลือกขั้นตอนถัดไปก่อนกลับหน้าขาย/);
  assert.doesNotMatch(handoff,/onEscape=/);
  assert.match(handoff,/onClick=\{\(\)=>\{setLastSale\(null\);openWorkspace\("queue"\)\}\}/);
  assert.doesNotMatch(handoff,/router\.push\("\/queue"\)/);
  assert.match(pos,/function startNextOrder\(\)/);
  assert.match(pos,/setLastSale\(null\)/);
});


test("open and close day keeps operator-facing guidance in plain Thai",async()=>{
  const close=await read("app/close/page.tsx");
  assert.match(close,/งานประจำวัน/);
  assert.match(close,/เปิดร้าน \/ ปิดร้าน/);
  assert.match(close,/ระบบจะตรวจคำสั่งเดิมซ้ำ/);
  assert.match(close,/อ่านข้อมูลรายการเดิม/);
  for(const phrase of ["DAILY CONTROL","OPEN / CLOSE DAY","Request เดิม","ข้อมูล recovery"]){
    assert.equal(close.includes(phrase),false,"close-day copy leaks "+phrase);
  }
});


test("payment modal locks every editable control while a checkout is committing",async()=>{
  const pos=await read("app/pos/page.tsx");
  const start=pos.indexOf("{payOpen&&");
  const end=pos.indexOf("{lastSale&&",start);
  const payment=pos.slice(start,end);
  assert.match(payment,/<fieldset disabled=\{busy\} aria-busy=\{busy\}/);
  assert.match(payment,/กำลังยืนยันรายการนี้ · ห้ามรับเงินซ้ำหรือเปลี่ยนยอดจนกว่าระบบจะแจ้งผล/);
  assert.match(payment,/role="status" aria-live="assertive"/);
  assert.match(payment,/disabled=\{busy\|\|!payableItems\.length/);
  assert.match(pos,/if\(!cart\.items\.length\|\|busy\|\|!payableItems\.length\)return/);
});


test("split-payment handoff keeps the cashier on the same queue until every payer is done",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/const splitPaymentPending=!!splitGroup&&cart\.items\.length>0/);
  assert.match(pos,/const splitRemainingQty=splitPaymentPending\?cart\.items\.reduce/);
  const start=pos.indexOf("{lastSale&&");
  const end=pos.indexOf("<PosDailyWorkspace",start);
  const handoff=pos.slice(start,end);
  assert.match(handoff,/รับเงินคนนี้สำเร็จ · คิวเดิมยังไม่จบ/);
  assert.match(pos,/กลุ่มเดียวกัน · คิว \{splitGroup\.queueNo\}/);
  assert.doesNotMatch(pos,/คิว \$\{splitGroup\.queueNo\}/);
  assert.match(handoff,/ยังไม่ต้องส่งคิวไปทำ/);
  assert.match(handoff,/เลือกของคนถัดไป/);
  assert.match(handoff,/อย่าเปิดออเดอร์ใหม่จนกว่าจะรับเงินคิวนี้ครบ/);
  assert.match(handoff,/ปุ่มเดียวจะพาไปเลือกรายการของคนถัดไป/);
  assert.match(handoff,/if\(lastSale\.offline\|\|splitPaymentPending\)\{startNextOrder\(\);return\}setLastSale\(null\);openWorkspace\("queue"\)/);
  assert.match(handoff,/lastSale\.offline\?"รับออเดอร์ถัดไป":splitPaymentPending\?"เลือกของคนถัดไป":"ทำคิว "/);
  assert.doesNotMatch(handoff,/!lastSale\.offline&&!splitPaymentPending&&<button/);
});


test("payment screen shows common tenders first and hides rare methods behind one clear choice",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/const \[otherPaymentOpen,setOtherPaymentOpen\]=useState\(false\)/);
  assert.match(pos,/const otherPaymentActive=\["bank","card","delivery"\]\.includes\(method\)/);
  assert.match(pos,/const showOtherPayments=otherPaymentOpen\|\|otherPaymentActive/);
  const start=pos.indexOf(">เลือกวิธีชำระ</p>");
  const end=pos.indexOf("{hasPendingPrompt&&",start);
  const paymentMethods=pos.slice(start,end);
  assert.match(paymentMethods,/>เงินสด<\/button>/);
  assert.match(paymentMethods,/>PromptPay/);
  assert.match(paymentMethods,/>ช่องทางอื่น<\/button>/);
  assert.match(paymentMethods,/aria-expanded=\{showOtherPayments\}/);
  assert.match(paymentMethods,/\{showOtherPayments&&<div id="field-other-payment-methods"/);
  assert.match(paymentMethods,/>โอน<\/button>/);
  assert.match(paymentMethods,/>บัตร<\/button>/);
  assert.match(paymentMethods,/>เดลิเวอรี<\/button>/);
  assert.match(paymentMethods,/setMethod\("cash"\);setOtherPaymentOpen\(false\)/);
  assert.match(paymentMethods,/setMethod\("promptpay"\);setOtherPaymentOpen\(false\)/);
});


test("split bill and loyalty stay out of the normal payment path but reopen automatically when needed",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/const \[orderOptionsOpen,setOrderOptionsOpen\]=useState\(false\)/);
  assert.match(pos,/setOrderOptionsOpen\(!!splitGroup\|\|!!customerId\)/);
  assert.match(pos,/const orderOptionsVisible=orderOptionsOpen\|\|splitBill\|\|!!customerId\|\|!!splitGroup/);
  const start=pos.indexOf('aria-controls="field-order-payment-options"');
  const end=pos.indexOf('<div className="mt-3 rounded-[20px] border border-slate-200 bg-slate-50 p-3">',start);
  const options=pos.slice(start,end);
  assert.match(options,/ตัวเลือกบิล \/ สมาชิก/);
  assert.match(options,/\{orderOptionsVisible&&<div id="field-order-payment-options"/);
  assert.match(options,/แยกบิล \/ จ่ายแยกตามคน/);
  assert.match(options,/ลูกค้าทั่วไป \/ ไม่สะสมแต้ม/);
  assert.match(options,/กลุ่มเดียวกัน · คิว \{splitGroup\.queueNo\}/);
});
