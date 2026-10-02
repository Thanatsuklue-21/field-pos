const DAY=86400000;
const hourFmt=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Bangkok',hour:'2-digit',hourCycle:'h23'});
const dateFmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'});
const weekdayNames=['อา','จ','อ','พ','พฤ','ศ','ส'];
const n=v=>Number.isFinite(Number(v))?Number(v):0;
function weekdayIndex(ms){const local=dateFmt.format(new Date(ms));return new Date(local+'T12:00:00Z').getUTCDay()}
export function buildOperationalAnalytics({sales=[],ingredients={},now=Date.now(),windowDays=14,targetDays=7}={}){
  const windowStart=now-(windowDays*DAY);
  const recent=(sales||[]).filter(s=>s?.status==='paid'&&Number.isFinite(Number(s.time))&&Number(s.time)>=windowStart&&Number(s.time)<=now);
  const earliest=recent.length?Math.min(...recent.map(s=>Number(s.time))):now;
  const observedDays=recent.length?Math.min(windowDays,Math.max(1,Math.ceil((now-earliest)/DAY)+1)):0;
  const hours=Array.from({length:24},(_,hour)=>({hour,revenue:0,orders:0,cups:0}));
  const weekdays=Array.from({length:7},(_,day)=>({day,label:weekdayNames[day],revenue:0,orders:0,cups:0}));
  const consumption={};let revenue14d=0,orders14d=0,cups14d=0;
  for(const sale of recent){
    const time=Number(sale.time),hour=Number(hourFmt.format(new Date(time))),w=weekdayIndex(time),revenue=n(sale.total);
    revenue14d+=revenue;orders14d++;hours[hour].revenue+=revenue;hours[hour].orders++;weekdays[w].revenue+=revenue;weekdays[w].orders++;
    for(const item of sale.items||[]){const qty=n(item.qty);cups14d+=qty;hours[hour].cups+=qty;weekdays[w].cups+=qty;for(const [ingredientId,usage] of Object.entries(item.recipe?.items||{}))consumption[ingredientId]=n(consumption[ingredientId])+n(usage)*qty}
  }
  const peakHour=hours.filter(x=>x.orders>0).sort((a,b)=>b.revenue-a.revenue||b.orders-a.orders)[0]||null;
  const bestWeekday=weekdays.filter(x=>x.orders>0).sort((a,b)=>b.revenue-a.revenue||b.orders-a.orders)[0]||null;
  const purchaseRecommendations=[];
  if(observedDays>0)for(const [id,totalUsage] of Object.entries(consumption)){
    const ing=ingredients?.[id];if(!ing)continue;const dailyUsage=n(totalUsage)/observedDays;if(dailyUsage<=0)continue;
    const qty=n(ing.qty),safetyStock=n(ing.safetyStock??ing.minQty),daysCover=qty/dailyUsage,targetQty=(dailyUsage*targetDays)+safetyStock,suggestQty=Math.max(0,Math.ceil(targetQty-qty));
    const profile=ing.purchaseProfile&&typeof ing.purchaseProfile==='object'?ing.purchaseProfile:null;
    const quantityPerPackage=n(profile?.quantityPerPackage);
    const suggestedPackages=quantityPerPackage>0&&suggestQty>0?Math.ceil(suggestQty/quantityPerPackage):null;
    const packageUnit=suggestedPackages?String(profile?.packageUnit||'').trim():'';
    if(qty<=safetyStock||daysCover<=3||suggestQty>0&&daysCover<targetDays)purchaseRecommendations.push({id,name:String(ing.name||id),unit:String(ing.unit||'g'),qty,safetyStock,totalUsage:n(totalUsage),dailyUsage,daysCover,suggestQty,suggestedPackages,packageUnit,quantityPerPackage:quantityPerPackage||null});
  }
  purchaseRecommendations.sort((a,b)=>a.daysCover-b.daysCover||b.suggestQty-a.suggestQty);
  return {windowDays,observedDays,revenue14d,orders14d,cups14d,avgDailyRevenue:observedDays?revenue14d/observedDays:0,avgDailyOrders:observedDays?orders14d/observedDays:0,peakHour,bestWeekday,hours,weekdays,purchaseRecommendations:purchaseRecommendations.slice(0,10)};
}
