const n=v=>Number.isFinite(Number(v))?Number(v):0;
const abs=v=>Math.abs(n(v));
const round2=v=>Math.round(n(v)*100)/100;

export const STOCK_INTEGRITY_POLICY=Object.freeze({
  adjustmentCountWarn:3,
  voidReversalCountWarn:3,
  wasteRatioWarn:0.25,
  minSaleUsageForRatio:20,
  minWasteUsageForRatio:10
});

export function buildStockIntegritySummary({transactions=[],ingredients={},policy=STOCK_INTEGRITY_POLICY}={}){
  const rows=(Array.isArray(transactions)?transactions:[]).map(x=>({
    id:x.id,
    ingredientId:String(x.ingredient_id??x.ingredientId??''),
    type:String(x.tx_type??x.type??''),
    qtyDelta:n(x.qty_delta??x.qtyDelta),
    unit:String(x.unit||'g'),
    reason:String(x.reason||'').trim(),
    actorId:x.actor_id??x.actorId??null,
    createdAt:n(x.created_at??x.createdAt),
    referenceType:x.reference_type??x.referenceType??null,
    referenceId:x.reference_id??x.referenceId??null
  }));
  const adjustments=rows.filter(x=>x.type==='ADJUSTMENT');
  const wastes=rows.filter(x=>x.type==='WASTE');
  const sales=rows.filter(x=>x.type==='SALE');
  const voidReversals=rows.filter(x=>x.type==='VOID_REVERSAL');
  const refundReversals=rows.filter(x=>x.type==='REFUND_REVERSAL');
  const signals=[],evidence=[];

  if(adjustments.length>=policy.adjustmentCountWarn){
    signals.push({code:'REPEATED_STOCK_ADJUSTMENT',level:'HIGH',count:adjustments.length,message:'มี Stock Adjustment ซ้ำหลายครั้ง ควรตรวจ physical count และเหตุผล'});
  }
  const missingReason=adjustments.filter(x=>!x.reason);
  if(missingReason.length){
    signals.push({code:'STOCK_ADJUSTMENT_MISSING_REASON',level:'HIGH',count:missingReason.length,message:'มี Stock Adjustment ที่ไม่มีเหตุผลประกอบ'});
  }
  if(voidReversals.length>=policy.voidReversalCountWarn){
    signals.push({code:'REPEATED_VOID_REVERSAL',level:'MEDIUM',count:voidReversals.length,message:'มีการคืนสต๊อกจาก Void ซ้ำหลายครั้ง ควรตรวจ Order และเหตุผล'});
  }

  const perIngredient=new Map();
  const rowFor=id=>{
    if(!perIngredient.has(id))perIngredient.set(id,{ingredientId:id,name:ingredients?.[id]?.name||id,unit:ingredients?.[id]?.unit||'g',saleUsage:0,wasteUsage:0,adjustments:0,voidReversals:0});
    return perIngredient.get(id);
  };
  for(const x of sales)rowFor(x.ingredientId).saleUsage+=abs(x.qtyDelta);
  for(const x of wastes)rowFor(x.ingredientId).wasteUsage+=abs(x.qtyDelta);
  for(const x of adjustments)rowFor(x.ingredientId).adjustments++;
  for(const x of voidReversals)rowFor(x.ingredientId).voidReversals++;

  const wasteAlerts=[];
  for(const v of perIngredient.values()){
    v.saleUsage=round2(v.saleUsage);v.wasteUsage=round2(v.wasteUsage);
    v.wasteRatio=v.saleUsage>0?round2(v.wasteUsage/v.saleUsage):null;
    if(v.saleUsage>=policy.minSaleUsageForRatio&&v.wasteUsage>=policy.minWasteUsageForRatio&&v.wasteRatio>=policy.wasteRatioWarn){
      wasteAlerts.push(v);
    }
  }
  if(wasteAlerts.length){
    const worst=wasteAlerts.slice().sort((a,b)=>(b.wasteRatio||0)-(a.wasteRatio||0))[0];
    signals.push({code:'HIGH_WASTE_RATIO',level:'HIGH',count:wasteAlerts.length,message:`Waste สูงเมื่อเทียบกับการใช้จากยอดขาย · สูงสุด ${worst.name} ${Math.round((worst.wasteRatio||0)*100)}%`});
  }

  const actorAdjustments=new Map();
  for(const x of adjustments)if(x.actorId)actorAdjustments.set(x.actorId,(actorAdjustments.get(x.actorId)||0)+1);
  const repeatedActors=[...actorAdjustments.entries()].filter(([,count])=>count>=policy.adjustmentCountWarn).map(([actorId,count])=>({actorId,count}));
  if(repeatedActors.length){
    signals.push({code:'REPEATED_MANUAL_STOCK_BY_ACTOR',level:'MEDIUM',count:repeatedActors.length,message:'พบผู้ใช้งานที่ทำ Stock Adjustment หลายครั้ง ควรตรวจรายการ ไม่ใช่ข้อสรุปการทุจริต'});
  }

  evidence.push(...adjustments.slice(0,10).map(x=>({kind:'ADJUSTMENT',...x})));
  evidence.push(...wasteAlerts.slice(0,10).map(x=>({kind:'WASTE_RATIO',...x})));
  evidence.push(...voidReversals.slice(0,10).map(x=>({kind:'VOID_REVERSAL',...x})));

  return {
    signals,
    metrics:{
      adjustments:adjustments.length,
      wasteEvents:wastes.length,
      voidReversals:voidReversals.length,
      refundReversals:refundReversals.length,
      saleMovements:sales.length,
      missingAdjustmentReasons:missingReason.length,
      highWasteIngredients:wasteAlerts.length
    },
    evidence:evidence.slice(0,25),
    actorPatterns:repeatedActors
  };
}
