const n=v=>Number.isFinite(Number(v))?Number(v):0;
const round2=v=>Math.round((n(v)+Number.EPSILON)*100)/100;
export const DELIVERY_CHANNELS=Object.freeze(['store','grab','lineman','other_delivery']);
export function normalizeDeliveryGp(settings={}){
  const src=settings?.deliveryGp&&typeof settings.deliveryGp==='object'?settings.deliveryGp:{};
  const rate=key=>Math.max(0,Math.min(.8,n(src[key])));
  return {grab:rate('grab'),lineman:rate('lineman'),other_delivery:rate('other_delivery')};
}
export function deliverySettlement({salesChannel='store',total=0,settings={}}={}){
  const channel=String(salesChannel||'store').trim().toLowerCase();
  if(!DELIVERY_CHANNELS.includes(channel))throw new Error('invalid_sales_channel');
  const gross=Math.max(0,n(total));
  if(channel==='store')return {salesChannel:'store',delivery:false,platform:null,gpRate:0,gpFee:0,netSettlement:gross};
  const rates=normalizeDeliveryGp(settings),rate=rates[channel]||0,fee=round2(gross*rate),net=round2(gross-fee);
  return {salesChannel:channel,delivery:true,platform:channel,gpRate:rate,gpFee:fee,netSettlement:net};
}
export function deliverySummary(sales=[]){
  const rows=(sales||[]).filter(s=>String(s.status||'paid')==='paid'&&String(s.salesChannel||'store')!=='store');
  return {
    gross:round2(rows.reduce((s,x)=>s+n(x.total),0)),
    gpFees:round2(rows.reduce((s,x)=>s+n(x.gpFee),0)),
    netSettlement:round2(rows.reduce((s,x)=>s+n(x.netSettlement??x.total),0)),
    orders:rows.length
  };
}
