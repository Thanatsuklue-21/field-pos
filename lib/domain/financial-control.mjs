import {buildStockIntegritySummary} from './stock-integrity.mjs';
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const abs=v=>Math.abs(n(v));
const sameMoney=(a,b)=>Math.round(n(a)*100)===Math.round(n(b)*100);
const clampText=(v,max=240)=>String(v||'').trim().slice(0,max);

export const CASH_CONTROL_POLICY=Object.freeze({
  warnVariance:20,
  ownerConfirmVariance:100,
  criticalVariance:500,
  reviewTtlMs:20*60*1000,
  recountTolerance:0,
  highCashMovement:500
});

export function classifyCashVariance(value,policy=CASH_CONTROL_POLICY){
  const amount=abs(value);
  if(amount===0)return 'OK';
  if(amount>=policy.criticalVariance)return 'CRITICAL';
  if(amount>=policy.ownerConfirmVariance)return 'HIGH';
  if(amount>=policy.warnVariance)return 'MEDIUM';
  return 'LOW';
}

export function buildCashCloseReview({
  date,openingCash=0,cashSales=0,cashIn=0,cashPaidOut=0,cashOut=0,
  firstCount,secondCount,sales=[],expenses=[],movements=[],now=Date.now(),policy=CASH_CONTROL_POLICY
}={}){
  const first=n(firstCount),second=n(secondCount);
  const recountMatches=sameMoney(first,second);
  if(!recountMatches){
    return {
      ok:false,
      code:'cash_recount_mismatch',
      blindRecount:true,
      firstCount:first,
      secondCount:second,
      countDifference:Number((second-first).toFixed(2))
    };
  }
  const expectedCash=n(openingCash)+n(cashSales)+n(cashIn)-n(cashPaidOut)-n(cashOut);
  const variance=Number((second-expectedCash).toFixed(2));
  const level=classifyCashVariance(variance,policy);
  const signals=[];
  const evidence=[];
  if(variance!==0){
    signals.push({code:'CASH_VARIANCE',level,amount:variance,message:variance>0?`เงินสดเกิน ฿${abs(variance).toLocaleString('th-TH')}`:`เงินสดขาด ฿${abs(variance).toLocaleString('th-TH')}`});
  }
  const cashExpenses=(expenses||[]).filter(x=>String(x.paymentMethod||x.payment||'').toLowerCase()==='cash');
  const cashSaleCount=(sales||[]).filter(s=>(s.payments||[{method:s.payment,amount:s.total}]).some(p=>p.method==='cash')).length;
  const largeMovements=(movements||[]).filter(x=>abs(x.amount)>=policy.highCashMovement);
  if(cashExpenses.length) evidence.push({code:'CASH_EXPENSES',count:cashExpenses.length,total:Number(cashExpenses.reduce((s,x)=>s+n(x.amount),0).toFixed(2))});
  if(cashSaleCount) evidence.push({code:'CASH_SALES',count:cashSaleCount,total:Number(n(cashSales).toFixed(2))});
  if(largeMovements.length) evidence.push({code:'LARGE_DRAWER_MOVEMENT',count:largeMovements.length,items:largeMovements.slice(0,5).map(x=>({id:x.id,type:x.type,amount:n(x.amount),reason:clampText(x.reason,120),time:x.time}))});
  const reasonRequired=variance!==0;
  const ownerConfirmRequired=abs(variance)>=policy.ownerConfirmVariance;
  const summary=variance===0
    ?'เงินสดตรงกับระบบ'
    :level==='LOW'
      ?'พบส่วนต่างเล็กน้อย ควรระบุเหตุผลเพื่อเก็บประวัติ'
      :level==='MEDIUM'
        ?'พบส่วนต่างที่ควรตรวจสอบรายการทอนเงิน/เงินเข้าออก'
        :level==='HIGH'
          ?'พบส่วนต่างสูง ต้องยืนยันโดยเจ้าของและระบุเหตุผล'
          :'พบส่วนต่างวิกฤต ห้ามปิดวันจนกว่าจะตรวจสอบอย่างละเอียด';
  return {
    ok:true,date,createdAt:now,blindRecount:true,recountMatches,
    firstCount:first,secondCount:second,countedCash:second,
    openingCash:n(openingCash),cashSales:n(cashSales),cashIn:n(cashIn),
    cashPaidOut:n(cashPaidOut),cashOut:n(cashOut),expectedCash:Number(expectedCash.toFixed(2)),
    variance,level,reasonRequired,ownerConfirmRequired,summary,signals,evidence
  };
}

export function buildAiControlSummary({doc={},date,auditRows=[],stockTransactions=[],now=Date.now(),policy=CASH_CONTROL_POLICY}={}){
  const ingredients=doc.ingredients||{};
  const lowStock=Object.entries(ingredients).map(([id,x])=>({
    id,name:x?.name||id,qty:n(x?.qty),safetyStock:n(x?.safetyStock??x?.minQty),unit:x?.unit||'g'
  })).filter(x=>x.safetyStock>0&&x.qty<=x.safetyStock);
  const pendingPayments=(doc.paymentSessions||[]).filter(x=>x.date===date&&['collecting','requires_resolution'].includes(x.status));
  const saleIds=new Set((doc.sales||[]).filter(x=>x.date===date&&x.status==='paid').map(x=>x.id));
  const openOrders=(doc.orders||[]).filter(o=>!['returned','void'].includes(String(o.status||''))&&(o.saleIds||[o.saleId]).filter(Boolean).some(id=>saleIds.has(id)));
  const movements=(doc.cashMovements||[]).filter(x=>x.date===date);
  const largeMovements=movements.filter(x=>abs(x.amount)>=policy.highCashMovement);
  const highRiskActions=(auditRows||[]).filter(x=>/refund|void|cash_drawer|cash_out|stock_adjust|payment|close_day/i.test(String(x.action||''))).slice(0,20);
  const pendingCountApprovals=(Array.isArray(doc.cycleCountProposals)?doc.cycleCountProposals:[]).filter(x=>x.date===date&&x.status==='pending');
  const signals=[];
  if(pendingPayments.length)signals.push({code:'PENDING_PAYMENTS',level:'CRITICAL',count:pendingPayments.length,message:'มีรายการชำระเงินค้าง ต้องจัดการก่อนปิดวัน'});
  if(openOrders.length)signals.push({code:'OPEN_ORDERS',level:'HIGH',count:openOrders.length,message:'มีคิวที่ยังไม่ได้ส่งมอบ'});
  if(lowStock.length)signals.push({code:'LOW_STOCK',level:'MEDIUM',count:lowStock.length,message:'มีวัตถุดิบต่ำกว่าระดับเตือน'});
  if(largeMovements.length)signals.push({code:'LARGE_CASH_MOVEMENT',level:'HIGH',count:largeMovements.length,message:'มีเงินเข้า/ออกลิ้นชักจำนวนสูง'});
  if(highRiskActions.length>=5)signals.push({code:'HIGH_RISK_ACTIVITY_CLUSTER',level:'MEDIUM',count:highRiskActions.length,message:'มีเหตุการณ์การเงิน/สต๊อกเสี่ยงหลายรายการ ควรตรวจ Audit'});
  if(pendingCountApprovals.length)signals.push({code:'OWNER_APPROVAL_PENDING',level:'HIGH',count:pendingCountApprovals.length,message:'มีผลนับสต๊อกรอ Owner อนุมัติ'});
  const stockIntegrity=buildStockIntegritySummary({transactions:stockTransactions,ingredients:doc.ingredients||{}});
  signals.push(...stockIntegrity.signals);
  const rank={OK:0,LOW:1,MEDIUM:2,HIGH:3,CRITICAL:4};
  let level='OK';
  for(const s of signals)if(rank[s.level]>rank[level])level=s.level;
  const recommendations=[];
  if(pendingPayments.length)recommendations.push({priority:'P0',action:'REVIEW_PENDING_PAYMENTS',label:'ตรวจ Payment ที่ค้างก่อนรับออเดอร์เพิ่ม'});
  if(openOrders.length)recommendations.push({priority:'P0',action:'FINISH_OPEN_ORDERS',label:'ส่งมอบคิวค้างตาม FIFO'});
  if(largeMovements.length)recommendations.push({priority:'P0',action:'REVIEW_CASH_MOVEMENTS',label:'ตรวจเงินเข้า/ออกลิ้นชักจำนวนสูง'});
  if(lowStock.length)recommendations.push({priority:'P1',action:'REVIEW_LOW_STOCK',label:'ตรวจและวางแผนซื้อวัตถุดิบต่ำ'});
  if(pendingCountApprovals.length)recommendations.push({priority:'P0',action:'REVIEW_OWNER_APPROVALS',label:'ตรวจผลนับสต๊อกที่รอ Owner อนุมัติ'});
  if(stockIntegrity.signals.some(x=>x.level==='HIGH'||x.level==='CRITICAL'))recommendations.push({priority:'P0',action:'REVIEW_STOCK_INTEGRITY',label:'ตรวจ Stock Ledger: Waste / Adjustment / Void ที่ผิดปกติ'});
  else if(stockIntegrity.signals.length)recommendations.push({priority:'P1',action:'REVIEW_STOCK_INTEGRITY',label:'ตรวจ Stock Ledger ที่ควรทบทวน'});
  if(!recommendations.length)recommendations.push({priority:'P2',action:'CONTINUE_NORMAL',label:'ระบบปกติ ดำเนินงานตาม Flow ได้'});
  return {
    generatedAt:now,date,level,signals,recommendations,
    metrics:{
      lowStock:lowStock.length,pendingPayments:pendingPayments.length,openOrders:openOrders.length,
      cashMovements:movements.length,largeCashMovements:largeMovements.length,highRiskAuditEvents:highRiskActions.length,pendingOwnerApprovals:pendingCountApprovals.length,stockAdjustments:stockIntegrity.metrics.adjustments,wasteEvents:stockIntegrity.metrics.wasteEvents,highWasteIngredients:stockIntegrity.metrics.highWasteIngredients,voidReversals:stockIntegrity.metrics.voidReversals
    },
    evidence:{lowStock:lowStock.slice(0,10),largeMovements:largeMovements.slice(0,10),highRiskActions:highRiskActions.slice(0,10).map(x=>({id:x.id,action:x.action,createdAt:x.created_at??x.createdAt,actorId:x.actor_id??x.actorId})),pendingOwnerApprovals:pendingCountApprovals.slice(0,10).map(x=>({id:x.id,submittedBy:x.submittedBy,submittedAt:x.submittedAt,variances:(x.adjustments||[]).filter(a=>Math.abs(Number(a.variance||0))>0.000001).length})),stockIntegrity:stockIntegrity.evidence}
  };
}

export function validateCloseReview({review,date,countedCash,expectedCash,variance,now=Date.now(),policy=CASH_CONTROL_POLICY}={}){
  if(!review||review.status!=='ready')return {ok:false,code:'close_day_review_required'};
  if(review.date!==date)return {ok:false,code:'close_day_review_date_mismatch'};
  if(now-n(review.createdAt)>policy.reviewTtlMs)return {ok:false,code:'close_day_review_expired'};
  if(!sameMoney(review.countedCash,countedCash))return {ok:false,code:'close_day_review_count_changed'};
  if(!sameMoney(review.expectedCash,expectedCash)||!sameMoney(review.variance,variance))return {ok:false,code:'close_day_review_stale'};
  return {ok:true};
}
