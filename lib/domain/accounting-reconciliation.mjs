const n=v=>Number.isFinite(Number(v))?Number(v):0;
const money=v=>Math.round(n(v)*100)/100;
const same=(a,b)=>Math.round(n(a)*100)===Math.round(n(b)*100);
const methods=new Set(['cash','promptpay','bank','card','other']);

function salePayments(sale){
  if(Array.isArray(sale?.payments)&&sale.payments.length)return sale.payments.map(p=>({method:String(p.method||''),amount:money(p.amount)}));
  return [{method:String(sale?.payment||''),amount:money(sale?.total)}];
}
function duplicateIds(rows=[]){const seen=new Set(),dupes=new Set();for(const x of rows){const id=String(x?.id||'');if(!id)continue;if(seen.has(id))dupes.add(id);seen.add(id)}return [...dupes]}

export function buildAccountingReconciliation({doc={},date}={}){
  const allSales=Array.isArray(doc.sales)?doc.sales:[],sales=allSales.filter(x=>x.date===date);
  const paid=sales.filter(x=>x.status==='paid'),refunded=sales.filter(x=>x.status==='refunded'),voided=sales.filter(x=>x.status==='void');
  const expenses=(Array.isArray(doc.expenses)?doc.expenses:[]).filter(x=>x.date===date);
  const movements=(Array.isArray(doc.cashMovements)?doc.cashMovements:[]).filter(x=>x.date===date);
  const findings=[],paymentTotals={cash:0,promptpay:0,bank:0,card:0,other:0};

  for(const sale of paid){
    const ps=salePayments(sale),sum=money(ps.reduce((a,p)=>a+n(p.amount),0));
    if(!same(sum,sale.total))findings.push({code:'SALE_PAYMENT_TOTAL_MISMATCH',level:'CRITICAL',saleId:sale.id,expected:money(sale.total),actual:sum,message:'ยอด Payment ไม่เท่ากับยอดขาย'});
    for(const p of ps){
      if(!methods.has(p.method))findings.push({code:'UNKNOWN_PAYMENT_METHOD',level:'HIGH',saleId:sale.id,method:p.method,message:'พบวิธีชำระเงินที่ระบบบัญชีไม่รู้จัก'});
      else paymentTotals[p.method]=money(paymentTotals[p.method]+p.amount);
      if(p.amount<0)findings.push({code:'NEGATIVE_PAYMENT',level:'CRITICAL',saleId:sale.id,amount:p.amount,message:'พบ Payment ติดลบ'});
    }
  }
  for(const sale of refunded){
    if(!same(sale.refundAmount??sale.total,sale.total))findings.push({code:'REFUND_TOTAL_MISMATCH',level:'CRITICAL',saleId:sale.id,expected:money(sale.total),actual:money(sale.refundAmount),message:'ยอด Refund ไม่เท่ากับยอดขายเดิม'});
    if(!sale.refundMethod)findings.push({code:'REFUND_METHOD_MISSING',level:'HIGH',saleId:sale.id,message:'Refund ไม่มีวิธีคืนเงิน'});
  }
  for(const e of expenses){
    if(!(n(e.amount)>0))findings.push({code:'INVALID_EXPENSE_AMOUNT',level:'HIGH',expenseId:e.id,amount:e.amount,message:'ค่าใช้จ่ายมีจำนวนเงินไม่ถูกต้อง'});
    if(!String(e.category||'').trim())findings.push({code:'EXPENSE_CATEGORY_MISSING',level:'MEDIUM',expenseId:e.id,message:'ค่าใช้จ่ายไม่มีหมวด'});
    if(!String(e.paymentMethod||'').trim())findings.push({code:'EXPENSE_PAYMENT_MISSING',level:'HIGH',expenseId:e.id,message:'ค่าใช้จ่ายไม่มีวิธีชำระ'});
  }
  for(const m of movements){
    if(!['CASH_IN','CASH_OUT'].includes(String(m.type||'')))findings.push({code:'INVALID_CASH_MOVEMENT_TYPE',level:'HIGH',movementId:m.id,message:'ประเภทเงินเข้า/ออกลิ้นชักไม่ถูกต้อง'});
    if(!(n(m.amount)>0))findings.push({code:'INVALID_CASH_MOVEMENT_AMOUNT',level:'HIGH',movementId:m.id,message:'จำนวนเงินเข้า/ออกลิ้นชักไม่ถูกต้อง'});
    if(String(m.reason||'').trim().length<2)findings.push({code:'CASH_MOVEMENT_REASON_MISSING',level:'HIGH',movementId:m.id,message:'เงินเข้า/ออกลิ้นชักไม่มีเหตุผล'});
  }

  for(const [kind,rows] of [['SALE',sales],['EXPENSE',expenses],['CASH_MOVEMENT',movements]]){
    const ids=duplicateIds(rows);if(ids.length)findings.push({code:'DUPLICATE_'+kind+'_ID',level:'CRITICAL',ids:ids.slice(0,20),message:'พบ ID ซ้ำในข้อมูลบัญชี'});
  }

  const revenue=money(paid.reduce((s,x)=>s+n(x.total),0));
  const paymentSum=money(Object.values(paymentTotals).reduce((s,x)=>s+n(x),0));
  if(!same(revenue,paymentSum))findings.push({code:'DAY_SALES_PAYMENT_MISMATCH',level:'CRITICAL',expected:revenue,actual:paymentSum,message:'ยอดขายรวมไม่เท่ากับยอดรับชำระรวม'});

  const cashExpenses=money(expenses.filter(e=>String(e.paymentMethod||'').toLowerCase()==='cash').reduce((s,e)=>s+Math.max(0,n(e.amount)),0));
  const cashIn=money(movements.filter(x=>x.type==='CASH_IN').reduce((s,x)=>s+n(x.amount),0));
  const cashOut=money(movements.filter(x=>x.type==='CASH_OUT').reduce((s,x)=>s+n(x.amount),0));
  const rank={OK:0,MEDIUM:1,HIGH:2,CRITICAL:3};let level='OK';
  for(const f of findings)if(rank[f.level]>rank[level])level=f.level;
  const blocking=findings.filter(x=>x.level==='CRITICAL');

  return {
    ok:blocking.length===0,level,date,findings,blocking,
    totals:{revenue,paymentSum,paymentTotals,cashExpenses,cashIn,cashOut,paidSales:paid.length,refundedSales:refunded.length,voidedSales:voided.length,expenses:expenses.length},
    checked:{sales:sales.length,expenses:expenses.length,cashMovements:movements.length}
  };
}


export function findAccountingCauses({doc={},date,reconciliation}={}){
  const rec=reconciliation||buildAccountingReconciliation({doc,date});
  const sales=(Array.isArray(doc.sales)?doc.sales:[]).filter(x=>x.date===date);
  const expenses=(Array.isArray(doc.expenses)?doc.expenses:[]).filter(x=>x.date===date);
  const movements=(Array.isArray(doc.cashMovements)?doc.cashMovements:[]).filter(x=>x.date===date);
  const causes=[];

  for(const f of rec.findings){
    if(f.code==='SALE_PAYMENT_TOTAL_MISMATCH'){
      const sale=sales.find(x=>x.id===f.saleId);
      causes.push({
        code:'PAYMENT_AMOUNT_MISMATCH',confidence:'HIGH',severity:f.level,
        title:'ยอดรับชำระไม่ตรงกับยอดขาย',
        explanation:`Sale ${f.saleId} มียอดขาย ฿${money(f.expected)} แต่ Payment รวม ฿${money(f.actual)}`,
        evidence:{saleId:f.saleId,total:f.expected,paymentTotal:f.actual,payments:salePayments(sale)},
        nextAction:'REVIEW_SALE_PAYMENT'
      });
    } else if(f.code==='DAY_SALES_PAYMENT_MISMATCH'){
      causes.push({
        code:'DAY_TOTAL_MISMATCH',confidence:'HIGH',severity:f.level,
        title:'ยอดขายรวมไม่ตรงกับยอดรับชำระรวม',
        explanation:`ยอดขายรวม ฿${money(f.expected)} แต่รับชำระรวม ฿${money(f.actual)}`,
        evidence:{salesTotal:f.expected,paymentTotal:f.actual,difference:money(n(f.actual)-n(f.expected))},
        nextAction:'REVIEW_PAYMENT_TOTALS'
      });
    } else if(f.code==='REFUND_TOTAL_MISMATCH'){
      const sale=sales.find(x=>x.id===f.saleId);
      causes.push({
        code:'REFUND_MISMATCH',confidence:'HIGH',severity:f.level,
        title:'ยอด Refund ไม่ตรงกับยอดขายเดิม',
        explanation:`Refund ของ ${f.saleId} ไม่ตรงกับยอดขายเดิม`,
        evidence:{saleId:f.saleId,original:f.expected,refund:f.actual,refundMethod:sale?.refundMethod||null,refundReference:sale?.refundReference||null},
        nextAction:'REVIEW_REFUND'
      });
    } else if(f.code==='EXPENSE_PAYMENT_MISSING'||f.code==='INVALID_EXPENSE_AMOUNT'){
      const row=expenses.find(x=>x.id===f.expenseId);
      causes.push({
        code:'EXPENSE_RECORD_ISSUE',confidence:'HIGH',severity:f.level,
        title:'ข้อมูลค่าใช้จ่ายไม่ครบหรือผิดรูปแบบ',
        explanation:'พบค่าใช้จ่ายที่ไม่สามารถนำไปกระทบยอดได้อย่างปลอดภัย',
        evidence:{expenseId:f.expenseId,amount:row?.amount,paymentMethod:row?.paymentMethod,category:row?.category},
        nextAction:'REVIEW_EXPENSE'
      });
    } else if(f.code.startsWith('INVALID_CASH_MOVEMENT')||f.code==='CASH_MOVEMENT_REASON_MISSING'){
      const row=movements.find(x=>x.id===f.movementId);
      causes.push({
        code:'CASH_MOVEMENT_ISSUE',confidence:'HIGH',severity:f.level,
        title:'รายการเงินเข้า/ออกลิ้นชักผิดปกติ',
        explanation:'พบ Cash Movement ที่ข้อมูลไม่ครบหรือรูปแบบไม่ถูกต้อง',
        evidence:{movementId:f.movementId,type:row?.type,amount:row?.amount,reason:row?.reason},
        nextAction:'REVIEW_CASH_MOVEMENT'
      });
    } else if(f.code.startsWith('DUPLICATE_')){
      causes.push({
        code:'DUPLICATE_FINANCIAL_ID',confidence:'HIGH',severity:f.level,
        title:'พบ Financial ID ซ้ำ',
        explanation:'มีรายการที่ใช้ ID ซ้ำ ซึ่งอาจทำให้รายงานหรือการกระทบยอดซ้ำซ้อน',
        evidence:{ids:f.ids||[],source:f.code},
        nextAction:'REVIEW_DUPLICATE_RECORD'
      });
    }
  }

  const largeCash=movements.filter(x=>n(x.amount)>=500).slice(0,10);
  if(largeCash.length){
    causes.push({
      code:'LARGE_CASH_MOVEMENT_CONTEXT',confidence:'MEDIUM',severity:'MEDIUM',
      title:'มีเงินเข้า/ออกลิ้นชักจำนวนสูงในวันนี้',
      explanation:'ไม่ใช่ข้อผิดพลาดโดยตัวมันเอง แต่ควรใช้เป็นบริบทเมื่อเงินสดขาด/เกิน',
      evidence:{items:largeCash.map(x=>({id:x.id,type:x.type,amount:n(x.amount),reason:x.reason,time:x.time}))},
      nextAction:'REVIEW_CASH_MOVEMENT'
    });
  }

  if(!causes.length){
    causes.push({
      code:'NO_CAUSE_FOUND',confidence:'LOW',severity:'LOW',
      title:'ยังไม่พบสาเหตุจากข้อมูลในระบบ',
      explanation:'ข้อมูลที่มีอยู่ยังไม่ชี้สาเหตุที่น่าเชื่อถือ ระบบจะไม่เดาหรือกล่าวหาบุคคล',
      evidence:{checked:rec.checked},
      nextAction:'MANUAL_REVIEW'
    });
  }

  return causes.slice(0,20);
}
