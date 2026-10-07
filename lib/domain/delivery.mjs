const n=v=>Number.isFinite(Number(v))?Number(v):0;
const money=v=>Math.round((n(v)+Number.EPSILON)*100)/100;

export const DEFAULT_DELIVERY_PLATFORMS=Object.freeze([
  Object.freeze({id:'grab',name:'Grab',gpPercent:0,active:false}),
  Object.freeze({id:'lineman',name:'LINE MAN',gpPercent:0,active:false}),
  Object.freeze({id:'shopeefood',name:'ShopeeFood',gpPercent:0,active:false}),
]);

function cleanId(value){
  const id=String(value||'').trim().toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);
  if(!id)throw new Error('invalid_delivery_platform_id');
  return id;
}

export function normalizeDeliveryPlatforms(input){
  const source=input===undefined||input===null?DEFAULT_DELIVERY_PLATFORMS:input;
  if(!Array.isArray(source)||source.length>20)throw new Error('invalid_delivery_platforms');
  const seen=new Set();
  return source.map(row=>{
    const id=cleanId(row?.id),name=String(row?.name||'').trim().slice(0,60),gpPercent=Number(row?.gpPercent),active=!!row?.active;
    if(seen.has(id))throw new Error('duplicate_delivery_platform');
    seen.add(id);
    if(name.length<2)throw new Error('invalid_delivery_platform_name');
    if(!Number.isFinite(gpPercent)||gpPercent<0||gpPercent>70)throw new Error('invalid_delivery_gp_percent');
    return {id,name,gpPercent:Math.round(gpPercent*100)/100,active};
  });
}

export function deliveryPlatformsFromSettings(settings={}){
  try{return normalizeDeliveryPlatforms(settings?.deliveryPlatforms)}
  catch{return normalizeDeliveryPlatforms(DEFAULT_DELIVERY_PLATFORMS)}
}

export function resolveSaleChannel({salesChannel='store',deliveryPlatformId='',settings={},total=0}={}){
  const channel=String(salesChannel||'store').trim().toLowerCase();
  if(channel==='store')return {salesChannel:'store',deliveryPlatformId:null,deliveryPlatformName:null,deliveryGpPercent:0,deliveryGpAmount:0,netReceivable:money(total)};
  if(channel!=='delivery')throw new Error('invalid_sales_channel');
  const platforms=deliveryPlatformsFromSettings(settings),id=cleanId(deliveryPlatformId),platform=platforms.find(x=>x.id===id&&x.active);
  if(!platform)throw new Error('delivery_platform_unavailable');
  const gross=money(total),fee=money(gross*(platform.gpPercent/100));
  return {salesChannel:'delivery',deliveryPlatformId:platform.id,deliveryPlatformName:platform.name,deliveryGpPercent:platform.gpPercent,deliveryGpAmount:fee,netReceivable:money(gross-fee)};
}

export function buildChannelSummary(sales=[]){
  const out={storeGross:0,deliveryGross:0,deliveryGp:0,deliveryNet:0,storeOrders:0,deliveryOrders:0,platforms:{}};
  for(const sale of sales||[]){
    if(String(sale?.status||'')!=='paid')continue;
    const total=money(sale.total),channel=String(sale.salesChannel||'store');
    if(channel!=='delivery'){out.storeGross=money(out.storeGross+total);out.storeOrders++;continue}
    const fee=money(sale.deliveryGpAmount),net=Number.isFinite(Number(sale.netReceivable))?money(sale.netReceivable):money(total-fee);
    out.deliveryGross=money(out.deliveryGross+total);out.deliveryGp=money(out.deliveryGp+fee);out.deliveryNet=money(out.deliveryNet+net);out.deliveryOrders++;
    const id=String(sale.deliveryPlatformId||'unknown'),name=String(sale.deliveryPlatformName||id||'Unknown');
    const row=out.platforms[id]||(out.platforms[id]={id,name,gross:0,gp:0,net:0,orders:0});
    row.gross=money(row.gross+total);row.gp=money(row.gp+fee);row.net=money(row.net+net);row.orders++;
  }
  return {...out,platforms:Object.values(out.platforms).sort((a,b)=>b.gross-a.gross)};
}
