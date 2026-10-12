const TERMINAL_ORDER_STATES=new Set(['returned','done','complete','completed','void','cancelled']);
const PENDING_PAYMENT_STATES=new Set(['collecting','pending','ambiguous','processing','requires_resolution']);
const round2=n=>Math.round((Number(n)||0)*100)/100;
function byDate(list,date){return (Array.isArray(list)?list:[]).filter(x=>String(x?.date||'')===date)}
function severityRank(s){return ({critical:4,high:3,medium:2,low:1,info:0})[s]??0}
export function buildAiSupervisorSnapshot({doc={},audit=[],date,now=Date.now()}){
  const alerts=[],sales=byDate(doc.sales,date),saleIds=new Set(sales.map(x=>x.id)),orders=(Array.isArray(doc.orders)?doc.orders:[]).filter(o=>(o.saleIds||[o.saleId]).filter(Boolean).some(id=>saleIds.has(id))),expenses=byDate(doc.expenses,date);
  const shifts=byDate(doc.cashShifts,date),shift=shifts.find(x=>x.status==='open')||shifts.at(-1)||null;
  const closes=byDate(doc.closes,date),close=closes.at(-1)||null;
  const paidSales=sales.filter(x=>x.status!=='refunded'&&x.status!=='void');
  const refunded=sales.filter(x=>x.status==='refunded');
  const revenue=round2(paidSales.reduce((s,x)=>s+Number(x.total||0),0));
  const refundAmount=round2(refunded.reduce((s,x)=>s+Number(x.total||0),0));
  const openOrders=orders.filter(x=>!TERMINAL_ORDER_STATES.has(String(x.status||'').toLowerCase()));
  const pendingPayments=(Array.isArray(doc.paymentSessions)?doc.paymentSessions:[]).filter(x=>String(x.date||date)===date&&PENDING_PAYMENT_STATES.has(String(x.status||'').toLowerCase()));
  const ingredients=Object.entries(doc.ingredients||{}).map(([id,x])=>({id,name:x?.name||id,qty:Number(x?.qty||0),min:Number(x?.minStock??x?.safetyStock??0),unit:x?.unit||'g'}));
  const outOfStock=ingredients.filter(x=>x.qty<=0),lowStock=ingredients.filter(x=>x.qty>0&&x.min>0&&x.qty<=x.min);
  const threshold=Number(doc.settings?.aiSupervisor?.expenseReviewThreshold||1000);
  const highExpenses=expenses.filter(x=>Number(x.amount||0)>=threshold);
  if(outOfStock.length)alerts.push({id:'stock-out',severity:'critical',area:'stock',title:'วัตถุดิบหมด/ติดลบ',detail:outOfStock.slice(0,4).map(x=>x.name+' '+x.qty+' '+x.unit).join(' · '),href:'/stock'});
  if(lowStock.length)alerts.push({id:'stock-low',severity:'medium',area:'stock',title:'วัตถุดิบใกล้หมด',detail:lowStock.slice(0,4).map(x=>x.name).join(', '),href:'/stock'});
  if(openOrders.length)alerts.push({id:'orders-open',severity:'high',area:'flow',title:'ยังมีคิวค้าง '+openOrders.length+' รายการ',detail:'ควรเคลียร์ FIFO และส่งมอบให้ครบก่อนปิดวัน',href:'/queue'});
  if(pendingPayments.length)alerts.push({id:'payment-pending',severity:'critical',area:'money',title:'มี Payment ที่ยังไม่ resolve',detail:pendingPayments.length+' รายการ ห้ามสร้างการชำระใหม่ซ้ำจนกว่าจะทราบผลเดิม',href:'/pos'});
  if(sales.length>0&&!shift)alerts.push({id:'shift-missing',severity:'high',area:'money',title:'พบยอดขายแต่ไม่พบ Cash Shift วันนี้',detail:'ตรวจการเปิดกะและเงินตั้งต้นก่อนดำเนินงานต่อ',href:'/close'});
  if(highExpenses.length)alerts.push({id:'expense-high',severity:'high',area:'money',title:'พบรายจ่ายสูงที่ควรตรวจซ้ำ',detail:highExpenses.slice(0,3).map(x=>'฿'+Number(x.amount||0).toLocaleString()).join(' · '),href:'/expenses'});
  if(revenue>0&&refundAmount/revenue>=.08)alerts.push({id:'refund-rate',severity:'high',area:'money',title:'Refund ratio สูงผิดปกติ',detail:'Refund '+round2(refundAmount/revenue*100)+'% ของยอดขายวันนี้',href:'/orders'});
  if(close&&Math.abs(Number(close.cashVariance||0))>.009)alerts.push({id:'cash-variance',severity:'critical',area:'money',title:'เงินสดปิดวันไม่ตรง',detail:(Number(close.cashVariance)>0?'เกิน ':'ขาด ')+'฿'+Math.abs(Number(close.cashVariance)).toLocaleString(),href:'/close'});
  const dayStart=Date.parse(date+'T00:00:00+07:00'),todayAudit=(Array.isArray(audit)?audit:[]).filter(x=>Number(x.created_at||0)>=dayStart);
  const refundVoidSignals=todayAudit.filter(x=>/refund|void/i.test(String(x.action||''))).length;
  const stockAdjustSignals=todayAudit.filter(x=>/stock.*adjust|adjust.*stock/i.test(String(x.action||''))).length;
  if(refundVoidSignals>=3)alerts.push({id:'refund-void-pattern',severity:'high',area:'money',title:'Refund / Void เกิดซ้ำหลายครั้งวันนี้',detail:refundVoidSignals+' เหตุการณ์ · ควรตรวจเหตุผลและผู้ทำรายการ ไม่ใช่หลักฐานการทุจริตโดยตัวมันเอง',href:'/audit'});
  if(stockAdjustSignals>=3)alerts.push({id:'stock-adjust-pattern',severity:'high',area:'stock',title:'Stock Adjustment เกิดซ้ำหลายครั้งวันนี้',detail:stockAdjustSignals+' เหตุการณ์ · ตรวจ physical count, waste และเหตุผลการปรับ',href:'/audit'});
  const recentRiskAudit=todayAudit.filter(x=>/refund|void|cash|stock|expense|close/i.test(String(x.action||''))).slice(0,10);
  alerts.sort((a,b)=>severityRank(b.severity)-severityRank(a.severity));
  const top=alerts[0]?.severity||'info';
  return {generatedAt:now,date,health:alerts.some(x=>x.severity==='critical')?'critical':alerts.some(x=>x.severity==='high'||x.severity==='medium')?'review':'ok',topSeverity:top,metrics:{revenue,refundAmount,orders:orders.length,openOrders:openOrders.length,expenses:round2(expenses.reduce((s,x)=>s+Number(x.amount||0),0)),pendingPayments:pendingPayments.length,outOfStock:outOfStock.length,lowStock:lowStock.length,cashVariance:round2(close?.cashVariance||0)},alerts,auditSignals:recentRiskAudit.map(x=>({action:x.action,actorId:x.actor_id,createdAt:Number(x.created_at||0)})),policy:{auto:['navigate','refresh','explain'],approval:['refund','void_paid_sale','cash_out','stock_adjustment','close_day','payment_override'],never:['delete_financial_record','rewrite_audit','change_closed_day_balance','mark_unverified_payment_paid']}}
}
