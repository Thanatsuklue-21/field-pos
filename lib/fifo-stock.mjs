import {randomUUID} from 'node:crypto';
import {exact,add,sub,mul,div,cmp,decimalString,serializeExact,parseExact,moneyNumber} from './domain/exact-quantity.mjs';
import {buildPosAvailability,cartAvailability} from './domain/availability.mjs';

const shortage=id=>Object.assign(new Error('stock_shortage:'+id),{status:409});
const active=s=>['collecting','requires_resolution'].includes(s.status);
const orderLots=lots=>lots.sort((a,b)=>a.receivedAt-b.receivedAt||(a.lotId<b.lotId?-1:a.lotId>b.lotId?1:0));

function take(lots,ingredientId,quantity){
  let remaining=exact(quantity);const parts=[];
  for(const lot of orderLots(lots.filter(x=>x.ingredientId===ingredientId))){
    if(cmp(remaining,0)<=0)break;
    if(cmp(lot.remaining,0)<=0)continue;
    const qty=cmp(lot.remaining,remaining)<0?lot.remaining:remaining;
    lot.remaining=sub(lot.remaining,qty);remaining=sub(remaining,qty);
    const total=mul(qty,lot.unitCost);
    parts.push({ingredientId,lotId:lot.lotId,receivedAt:lot.receivedAt,qty:decimalString(qty),unitCost:decimalString(lot.unitCost),unitCostExact:serializeExact(lot.unitCost),totalCost:decimalString(total),totalCostExact:serializeExact(total),costStatus:lot.costStatus,source:lot.source});
  }
  if(cmp(remaining,0)>0)throw shortage(ingredientId);
  return parts;
}

// This is a projection of the existing stock ledger, never another balance.
// Opening quantities remain explicitly legacy/provisional; they are not claimed
// to be purchase lots whose receiving history the database does not contain.
export async function loadFifoStock(db,doc,{excludeSessionId,captureOpening=false}={}){
  const [movements,purchases,snapshots]=await Promise.all([
    db.execute('SELECT rowid AS sequence,* FROM field_stock_transactions ORDER BY created_at,rowid'),
    db.execute('SELECT p.*,h.cost_status AS fifo_cost_status FROM field_purchase_records p LEFT JOIN field_cost_history h ON h.purchase_record_id=p.id'),
    db.execute('SELECT sale_id,document FROM field_cost_snapshots ORDER BY created_at,rowid')
  ]);
  const purchaseByTx=new Map(purchases.rows.map(p=>[String(p.stock_transaction_id),p]));
  const saleParts=new Map();
  for(const row of snapshots.rows){const data=JSON.parse(row.document);if(data.consumptions){const list=saleParts.get(String(row.sale_id))||[];list.push(...data.consumptions);saleParts.set(String(row.sale_id),list)}}
  const reservations=(doc.paymentSessions||[]).filter(active),lots=[];
  const rows=movements.rows.filter(row=>Number(row.created_at)>=Math.max(Number(doc.testStockResetAt||0),Number(doc.ingredients?.[row.ingredient_id]?.historyResetAt||0)));
  for(const [id,ingredient] of Object.entries(doc.ingredients||{})){
    const ledger=rows.filter(r=>r.ingredient_id===id).reduce((sum,r)=>add(sum,r.qty_delta),exact(0));
    const reserved=reservations.flatMap(s=>s.items||[]).reduce((sum,item)=>add(sum,mul(item.recipe?.items?.[id]||0,item.qty)),exact(0));
    const opening=sub(add(ingredient.qty||0,reserved),ledger);
    if(cmp(opening,0)<0)throw Object.assign(new Error('stock_ledger_mismatch:'+id),{status:409});
    const resetAt=Math.max(Number(doc.testStockResetAt||0),Number(ingredient.historyResetAt||0));
    let recorded=ingredient.fifoOpeningLot?.resetAt===resetAt?ingredient.fifoOpeningLot:null;
    if(captureOpening&&!recorded){
      // This is immutable opening provenance, not a second stock balance.
      recorded={qty:decimalString(opening),startingQty:decimalString(ingredient.qty||0),unitCostExact:serializeExact(exact(ingredient.unitCost||0)),costStatus:ingredient.costStatus==='MISSING'?'MISSING':'PROVISIONAL',capturedAt:Date.now(),resetAt};
      ingredient.fifoOpeningLot=recorded;
    }
    if(cmp(opening,0)>0)lots.push({lotId:'legacy-opening:'+id,ingredientId:id,receivedAt:0,remaining:opening,unitCost:recorded?parseExact(recorded.unitCostExact):exact(ingredient.unitCost||0),costStatus:recorded?.costStatus||(ingredient.costStatus==='MISSING'?'MISSING':'PROVISIONAL'),source:'LEGACY_OPENING'});
  }
  for(const row of rows){
    const id=String(row.ingredient_id),delta=exact(row.qty_delta),purchase=purchaseByTx.get(String(row.id));
    if(cmp(delta,0)>0){
      if(['VOID_REVERSAL','REFUND_REVERSAL'].includes(row.tx_type)&&saleParts.has(String(row.reference_id))){
        let left=delta;
        const keys=String(row.request_key||'').split(':'),itemIndex=Number(keys[keys.length-2]);
        for(const part of saleParts.get(String(row.reference_id)).filter(x=>x.ingredientId===id&&x.itemIndex===itemIndex)){
          if(cmp(left,0)<=0)break;
          const amount=cmp(left,part.qty)<0?left:exact(part.qty),lot=lots.find(x=>x.lotId===part.lotId);
          if(!lot)throw new Error('fifo_reversal_lot_missing');
          lot.remaining=add(lot.remaining,amount);left=sub(left,amount);
        }
        if(cmp(left,0)>0)throw new Error('fifo_reversal_quantity_mismatch');
      }else{
        lots.push({lotId:purchase?String(purchase.id):String(row.id),ingredientId:id,receivedAt:Number(row.created_at),remaining:delta,unitCost:purchase?div(purchase.total_cost,purchase.quantity_received):exact(doc.ingredients?.[id]?.unitCost||0),costStatus:purchase?String(purchase.fifo_cost_status||'MISSING'):'PROVISIONAL',source:purchase?'PURCHASE':'ADJUSTMENT'});
      }
    }else{
      // Historic movements already determined the physical quantity. Snapshot
      // lot allocations pin new sales; old movements use deterministic FIFO.
      const quantity=mul(delta,-1);
      if(row.tx_type==='PURCHASE_REVERSAL'){
        const lot=lots.find(x=>x.lotId===String(row.reference_id)&&x.ingredientId===id);
        if(!lot||cmp(lot.remaining,quantity)<0)throw shortage(id);
        lot.remaining=sub(lot.remaining,quantity);continue;
      }
      const parts=row.tx_type==='SALE'?saleParts.get(String(row.reference_id)):null;
      if(parts){
        let left=quantity;
        const used=row.request_key?.split(':');const index=Number(used?.[used.length-2]);
        const relevant=parts.filter(x=>x.ingredientId===id&&x.itemIndex===index);
        for(const part of relevant){const lot=lots.find(x=>x.lotId===part.lotId);if(!lot||cmp(lot.remaining,part.qty)<0)throw shortage(id);lot.remaining=sub(lot.remaining,part.qty);left=sub(left,part.qty)}
        if(cmp(left,0)!==0)throw new Error('fifo_snapshot_quantity_mismatch');
      }else take(lots,id,quantity);
    }
  }
  const planningLots=lots.map(lot=>({...lot}));
  for(const session of [...reservations].sort((a,b)=>Number(a.createdAt)-Number(b.createdAt)||String(a.id).localeCompare(String(b.id)))){
    const planned=allocateFifoItems(planningLots,session.items||[],{reservedItems:session.fifoReservations});
    // Upgrade pre-rollout reservations inside the same eventual write transaction.
    // Read-only callers operate on a detached document and never persist this.
    if(!session.fifoReservations)session.fifoReservations=planned;
  }
  for(const session of reservations){
    if(session.id===excludeSessionId)continue;
    allocateFifoItems(lots,session.items||[],{reservedItems:session.fifoReservations});
  }
  return lots;
}

export function allocateFifoItems(lots,items,{reservedItems}={}){
  return items.map((item,itemIndex)=>{
    let parts;
    if(reservedItems){
      parts=reservedItems[itemIndex]?.consumptions;
      if(!Array.isArray(parts))throw new Error('fifo_reservation_missing');
      const demand=Object.fromEntries(Object.entries(item.recipe?.items||{}).filter(([,qty])=>cmp(qty,0)>0).map(([id,qty])=>[id,mul(qty,item.qty)]));
      for(const part of parts){
        const lot=lots.find(x=>x.lotId===part.lotId&&x.ingredientId===part.ingredientId);
        if(!lot||cmp(part.qty,0)<=0||cmp(lot.remaining,part.qty)<0)throw shortage(part.ingredientId);
        if(cmp(lot.unitCost,parseExact(part.unitCostExact))!==0)throw Object.assign(new Error('fifo_reserved_cost_changed'),{status:409});
        if(!demand[part.ingredientId])throw new Error('fifo_reservation_mismatch');
        demand[part.ingredientId]=sub(demand[part.ingredientId],part.qty);
        lot.remaining=sub(lot.remaining,part.qty);
      }
      if(Object.values(demand).some(qty=>cmp(qty,0)!==0))throw new Error('fifo_reservation_mismatch');
    }else parts=Object.entries(item.recipe?.items||{}).filter(([,qty])=>cmp(qty,0)>0).flatMap(([id,qty])=>take(lots,id,mul(qty,item.qty)));
    const consumptions=parts.map(part=>({...part,itemIndex,recipeVersion:item.recipeVersion??null}));
    const cost=consumptions.reduce((sum,p)=>add(sum,parseExact(p.totalCostExact)),exact(0));
    const missingCost=[...new Set(consumptions.filter(x=>x.costStatus==='MISSING').map(x=>x.ingredientId))];
    const pendingCost=[...new Set(consumptions.filter(x=>x.costStatus==='PROVISIONAL').map(x=>x.ingredientId))];
    return {...item,consumptions,missingCost,pendingCost,lineCostExact:serializeExact(cost),lineCost:moneyNumber(cost),unitCost:moneyNumber(div(cost,item.qty)),costStatus:missingCost.length?'MISSING':pendingCost.length?'PROVISIONAL':'CONFIRMED'};
  });
}
export const actualSaleCost=items=>moneyNumber(items.reduce((sum,x)=>add(sum,x.lineCostExact?parseExact(x.lineCostExact):mul(x.unitCost,x.qty)),exact(0)));

export async function fifoAvailability(db,doc,menu=doc.menu||[]){
  const lots=await loadFifoStock(db,doc),ingredients={};
  for(const [id,ingredient] of Object.entries(doc.ingredients||{})){
    const qty=lots.filter(lot=>lot.ingredientId===id).reduce((sum,lot)=>add(sum,lot.remaining),exact(0));
    ingredients[id]={...ingredient,qty:Number(decimalString(qty))};
  }
  return buildPosAvailability({menu,ingredients,lowServings:Number(doc.settings?.availabilityLowServings)||5});
}

export async function precheckFifoCart(db,doc,cart){
  const availability=await fifoAvailability(db,doc,(doc.menu||[]).filter(product=>product.enabled&&!product.archived&&Number(product.price)>0));
  return {...availability,...cartAvailability({cart,menu:availability.menu,stock:availability.stock})};
}

export async function purchaseHasFifoConsumption(db,lotId,doc={}){
  if((doc.paymentSessions||[]).filter(active).some(session=>(session.fifoReservations||[]).some(item=>(item.consumptions||[]).some(part=>part.lotId===lotId))))return true;
  const rows=(await db.execute('SELECT document FROM field_cost_snapshots')).rows;
  return rows.some(row=>(JSON.parse(row.document).consumptions||[]).some(part=>part.lotId===lotId));
}

export function openingInventoryPreview(doc,revision){
  return {revision,items:Object.entries(doc.ingredients||{}).filter(([,x])=>!x.archived).map(([id,x])=>{
    const resetAt=Math.max(Number(doc.testStockResetAt||0),Number(x.historyResetAt||0));
    const opening=x.fifoOpeningLot?.resetAt===resetAt?x.fifoOpeningLot:null;
    return {id,name:String(x.name||id),qty:Number(opening?.startingQty??x.qty)||0,unit:String(x.unit||'g'),capturedAt:opening?.capturedAt||null,costStatus:opening?.costStatus||'PROVISIONAL'};
  })};
}

export async function recordFifoReversal(tx,{sale,orderId,now,requestKey}){
  const rows=(await tx.execute({sql:'SELECT * FROM field_cost_snapshots WHERE sale_id=? ORDER BY created_at,rowid',args:[sale.id]})).rows;
  for(const row of rows){
    const original=JSON.parse(row.document);if(!original.consumptions)continue;
    const reversals=original.consumptions.map(part=>({...part,consumedAt:now,originalSnapshotId:String(row.id),requestKey}));
    await tx.execute({sql:'INSERT INTO field_cost_snapshots(id,sale_id,order_id,order_item_id,menu_id,recipe_version,standard_cost,document,created_at) VALUES(?,?,?,?,?,?,?,?,?)',args:['cost_reversal_'+randomUUID(),sale.id,orderId,row.order_item_id,row.menu_id,row.recipe_version,0,JSON.stringify({type:'COMPENSATING_REVERSAL',originalSnapshotId:row.id,reversals}),now]});
  }
}
