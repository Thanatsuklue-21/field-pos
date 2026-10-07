const n=v=>Number.isFinite(Number(v))?Number(v):0;
const round2=v=>Math.round((n(v)+Number.EPSILON)*100)/100;
const dateOk=v=>{const s=String(v||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s};
const deliverySale=s=>String(s?.status||'paid')==='paid'&&String(s?.salesChannel||'store')!=='store';

export function buildDeliverySettlementGroups(sales=[],reconciliations=[]){
  const reconciled=new Set(
    (reconciliations||[])
      .filter(r=>!r.cancelledAt)
      .flatMap(r=>Array.isArray(r.saleIds)?r.saleIds:[])
      .map(String)
  );
  const map=new Map();
  for(const sale of sales||[]){
    if(!deliverySale(sale)||reconciled.has(String(sale.id)))continue;
    const saleDate=String(sale.date||''),platform=String(sale.deliveryPlatform||sale.salesChannel||'other_delivery');
    if(!dateOk(saleDate))continue;
    const key=saleDate+'|'+platform;
    let row=map.get(key);
    if(!row){
      row={key,saleDate,platform,gross:0,gpFees:0,expectedAmount:0,orders:0,saleIds:[]};
      map.set(key,row);
    }
    row.gross+=n(sale.total);
    row.gpFees+=n(sale.gpFee);
    row.expectedAmount+=n(sale.netSettlement??sale.total);
    row.orders+=1;
    row.saleIds.push(String(sale.id));
  }
  return [...map.values()]
    .map(x=>({...x,gross:round2(x.gross),gpFees:round2(x.gpFees),expectedAmount:round2(x.expectedAmount)}))
    .sort((a,b)=>b.saleDate.localeCompare(a.saleDate)||a.platform.localeCompare(b.platform));
}

export function createDeliveryReconciliation({sales=[],reconciliations=[],saleDate,platform,receivedAmount,receivedDate,note='',now=Date.now(),userId=''}={}){
  saleDate=String(saleDate||'');platform=String(platform||'').trim();receivedDate=String(receivedDate||'');
  const received=Number(receivedAmount);
  if(!dateOk(saleDate)||!dateOk(receivedDate))throw new Error('invalid_settlement_date');
  if(!platform||platform==='store')throw new Error('invalid_delivery_platform');
  if(!Number.isFinite(received)||received<0)throw new Error('invalid_received_amount');
  const group=buildDeliverySettlementGroups(sales,reconciliations).find(x=>x.saleDate===saleDate&&x.platform===platform);
  if(!group)throw new Error('delivery_settlement_group_not_found');
  const variance=round2(received-group.expectedAmount);
  return {
    id:'drec_'+String(now)+'_'+Math.random().toString(36).slice(2,8),
    saleDate,platform,saleIds:group.saleIds,
    orders:group.orders,gross:group.gross,gpFees:group.gpFees,expectedAmount:group.expectedAmount,
    receivedAmount:round2(received),receivedDate,variance,
    status:Math.abs(variance)<.01?'matched':'variance',
    note:String(note||'').trim().slice(0,300),
    createdAt:now,createdBy:String(userId||'')
  };
}

export function deliveryReconciliationSummary(reconciliations=[]){
  const rows=(reconciliations||[]).filter(r=>!r.cancelledAt);
  const matched=rows.filter(r=>r.status==='matched').length,variance=rows.filter(r=>r.status==='variance').length;
  return {
    records:rows.length,matched,variance,
    expected:round2(rows.reduce((s,x)=>s+n(x.expectedAmount),0)),
    received:round2(rows.reduce((s,x)=>s+n(x.receivedAmount),0)),
    netVariance:round2(rows.reduce((s,x)=>s+n(x.variance),0))
  };
}
