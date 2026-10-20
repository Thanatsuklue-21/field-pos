import {buildCatalogReadiness} from './catalog-readiness.mjs';
import {buildAccountingReconciliation} from './accounting-reconciliation.mjs';
import {buildStockIntegritySummary} from './stock-integrity.mjs';

const n=v=>Number.isFinite(Number(v))?Number(v):0;
const statusRank={READY:0,WARN:1,BLOCKED:2};

function push(checks,id,label,status,message,evidence={}){
  checks.push({id,label,status,message,evidence});
}

export function buildSystemReadiness({doc={},date,stockTransactions=[],now=Date.now()}={}){
  const checks=[];
  const ingredients=doc.ingredients||{};
  const menu=Array.isArray(doc.menu)?doc.menu:[];
  const activeMenus=menu.filter(x=>x&&x.enabled!==false&&!x.archived);
  const paymentSessions=Array.isArray(doc.paymentSessions)?doc.paymentSessions:[];
  const orders=Array.isArray(doc.orders)?doc.orders:[];
  const cashShifts=Array.isArray(doc.cashShifts)?doc.cashShifts:[];
  const closes=Array.isArray(doc.closes)?doc.closes:[];

  const badIngredients=Object.entries(ingredients).filter(([,x])=>!Number.isFinite(Number(x?.qty))||n(x?.qty)<0);
  push(checks,'stock_balance','Stock balance',badIngredients.length?'BLOCKED':'READY',
    badIngredients.length?'พบสต๊อกติดลบหรือจำนวนไม่ถูกต้อง':'ยอดคงเหลือสต๊อกไม่ติดลบ',
    {items:badIngredients.slice(0,10).map(([id,x])=>({id,qty:x?.qty}))});

  const missingRecipes=[];
  for(const m of activeMenus){
    const variants=Array.isArray(m.variants)?m.variants:[];
    if(!variants.length){missingRecipes.push({menuId:m.id,name:m.name,reason:'NO_VARIANTS'});continue}
    for(const v of variants){
      const items=v?.recipe?.items||{};
      if(!Object.keys(items).length)missingRecipes.push({menuId:m.id,name:m.name,variant:v?.label,reason:'RECIPE_MISSING'});
      for(const [ingredientId,qty] of Object.entries(items)){
        if(!ingredients[ingredientId]||!(n(qty)>0))missingRecipes.push({menuId:m.id,name:m.name,variant:v?.label,ingredientId,reason:'INGREDIENT_OR_QTY_INVALID'});
      }
    }
  }
  push(checks,'menu_recipe','Menu & recipe',missingRecipes.length?'BLOCKED':'READY',
    missingRecipes.length?'มีเมนูที่สูตรไม่สมบูรณ์หรืออ้างวัตถุดิบไม่ได้':'เมนูที่เปิดขายมีสูตรและวัตถุดิบครบ',
    {items:missingRecipes.slice(0,20)});

  const pendingPayments=paymentSessions.filter(x=>x.date===date&&['collecting','requires_resolution'].includes(String(x.status||'')));
  push(checks,'payments','Payment safety',pendingPayments.length?'BLOCKED':'READY',
    pendingPayments.length?'มี Payment ที่ยังค้างหรือรอแก้ไข':'ไม่มี Payment ค้าง',
    {count:pendingPayments.length,ids:pendingPayments.slice(0,10).map(x=>x.id)});

  const paidSaleIds=new Set((doc.sales||[]).filter(x=>x.date===date&&x.status==='paid').map(x=>x.id));
  const openOrders=orders.filter(o=>!['returned','void'].includes(String(o.status||''))&&(o.saleIds||[o.saleId]).filter(Boolean).some(id=>paidSaleIds.has(id)));
  push(checks,'queue','Queue completion',openOrders.length?'WARN':'READY',
    openOrders.length?'มีคิวที่ยังไม่ส่งมอบ':'ไม่มีคิวค้างที่ผูกกับยอดขายวันนี้',
    {count:openOrders.length,ids:openOrders.slice(0,10).map(x=>x.id)});

  const accounting=buildAccountingReconciliation({doc,date});
  push(checks,'accounting','Accounting reconciliation',accounting.ok?'READY':'BLOCKED',
    accounting.ok?'Sale / Payment / Expense / Drawer กระทบกันได้':'บัญชีมี Critical mismatch',
    {level:accounting.level,blocking:accounting.blocking.slice(0,10),totals:accounting.totals});

  const stockIntegrity=buildStockIntegritySummary({transactions:stockTransactions,ingredients});
  const severeStock=stockIntegrity.signals.filter(x=>x.level==='HIGH'||x.level==='CRITICAL');
  push(checks,'stock_integrity','Stock integrity',severeStock.length?'WARN':'READY',
    severeStock.length?'พบ Waste / Adjustment / Reversal ที่ควรตรวจ':'ไม่พบสัญญาณสต๊อกรุนแรง',
    {signals:severeStock.slice(0,10),metrics:stockIntegrity.metrics});

  const todayShift=cashShifts.find(x=>x.date===date);
  const closedToday=closes.some(x=>x.date===date);
  let drawerStatus='READY',drawerMessage='สถานะกะเงินสดสอดคล้องกับวันทำการ';
  if(closedToday&&todayShift?.status==='open'){drawerStatus='BLOCKED';drawerMessage='วันถูกปิดแล้วแต่ Cash Shift ยังเปิด'}
  else if(!closedToday&&!todayShift){drawerStatus='WARN';drawerMessage='ยังไม่ได้เปิด Cash Shift สำหรับวันนี้'}
  push(checks,'cash_shift','Cash shift',drawerStatus,drawerMessage,{shift:todayShift||null,closedToday});

  const pendingApprovals=(Array.isArray(doc.cycleCountProposals)?doc.cycleCountProposals:[]).filter(x=>x.date===date&&x.status==='pending');
  push(checks,'owner_approvals','Owner approvals',pendingApprovals.length?'WARN':'READY',
    pendingApprovals.length?'มีรายการรอ Owner อนุมัติ':'ไม่มีรายการอนุมัติค้าง',
    {count:pendingApprovals.length,ids:pendingApprovals.slice(0,10).map(x=>x.id)});

  const worst=checks.reduce((a,x)=>statusRank[x.status]>statusRank[a]?x.status:a,'READY');
  const blocked=checks.filter(x=>x.status==='BLOCKED');
  const warnings=checks.filter(x=>x.status==='WARN');
  const score=Math.max(0,100-blocked.length*25-warnings.length*8);
  const nextActions=[
    ...blocked.map(x=>({priority:'P0',checkId:x.id,label:x.message})),
    ...warnings.map(x=>({priority:'P1',checkId:x.id,label:x.message}))
  ].slice(0,12);
  if(!nextActions.length)nextActions.push({priority:'P2',checkId:'all',label:'ระบบผ่าน Readiness checks หลัก ดำเนินงานได้ตาม Flow'});

  return {
    generatedAt:now,date,status:worst,score,checks,catalog:buildCatalogReadiness({menu,ingredients,settings:doc.settings}),
    summary:{total:checks.length,ready:checks.filter(x=>x.status==='READY').length,warn:warnings.length,blocked:blocked.length},
    nextActions
  };
}
