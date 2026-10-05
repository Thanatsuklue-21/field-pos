import {beginWriteTransaction} from './transactions.mjs';
import {randomUUID} from 'node:crypto';
import {STOCK_TX_TYPES, createStockTransaction} from './domain/stock-ledger.mjs';
import {bangkokDate} from './time.mjs';
import {calculateReceivedQuantity} from './domain/stock-units.mjs';

const VALID_TYPES = new Set(Object.values(STOCK_TX_TYPES));
const REQUEST_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

function cleanText(value, max = 120) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (!text || text.length > max) throw new Error('invalid_stock_text');
  return text;
}

function validateSign(type, qtyDelta) {
  if (type === STOCK_TX_TYPES.PURCHASE && qtyDelta <= 0) throw new Error('purchase_must_increase_stock');
  if (type === STOCK_TX_TYPES.SALE && qtyDelta >= 0) throw new Error('sale_must_decrease_stock');
  if (type === STOCK_TX_TYPES.WASTE && qtyDelta >= 0) throw new Error('waste_must_decrease_stock');
  if (type === STOCK_TX_TYPES.VOID_REVERSAL && qtyDelta <= 0) throw new Error('void_reversal_must_increase_stock');
}

export function normalizeStockWrite(input, {actorId, now = Date.now()} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_stock_transaction');

  const requestKey = String(input.requestKey || '').trim();
  if (!REQUEST_KEY_RE.test(requestKey)) throw new Error('invalid_request_key');

  const ingredientId = cleanText(input.ingredientId, 80);
  if (!ingredientId) throw new Error('ingredient_required');

  const type = String(input.type || '');
  if (!VALID_TYPES.has(type)) throw new Error('invalid_stock_transaction_type');

  const unit=cleanText(input.unit || 'g',16);
  const packageQty=input.packageQty==null||input.packageQty===''?null:Number(input.packageQty);
  if(packageQty!==null&&(!Number.isFinite(packageQty)||packageQty<=0))throw new Error('invalid_package_qty');
  const packSize=input.packSize==null||input.packSize===''?null:Number(input.packSize);
  if(packSize!==null&&(!Number.isFinite(packSize)||packSize<=0))throw new Error('invalid_pack_size');
  const packSizeUnit=cleanText(input.packSizeUnit,24)||'';
  const packageUnit=cleanText(input.packageUnit,30)||'';

  let qtyDelta=Number(input.qtyDelta);
  let receivedQuantity=null,quantityPerPackage=null,conversionApproximate=false;
  const hasPackaging=type===STOCK_TX_TYPES.PURCHASE&&(packSize!==null||!!packSizeUnit);
  if(hasPackaging){
    if(packageQty===null||packSize===null||!packSizeUnit||!packageUnit)throw new Error('incomplete_purchase_packaging');
    const calculated=calculateReceivedQuantity({packageQty,packSize,packSizeUnit,usageUnit:unit});
    receivedQuantity=calculated.quantity;
    quantityPerPackage=calculated.quantityPerPackage;
    conversionApproximate=calculated.approximate;
    if(Number.isFinite(qtyDelta)&&qtyDelta!==0&&Math.abs(qtyDelta-receivedQuantity)>Math.max(0.000001,receivedQuantity*1e-9))throw new Error('packaging_quantity_mismatch');
    qtyDelta=receivedQuantity;
  }
  if (!Number.isFinite(qtyDelta) || qtyDelta === 0) throw new Error('invalid_qty_delta');
  validateSign(type, qtyDelta);

  const tx = createStockTransaction({
    id: `stx_${randomUUID()}`,
    ingredientId,
    type,
    qtyDelta,
    unit,
    referenceType: cleanText(input.referenceType, 40),
    referenceId: cleanText(input.referenceId, 120),
    reason: cleanText(input.reason, 240) || '',
    createdAt: now,
    createdBy: actorId || null,
  });

  const purchaseCost=input.purchaseCost===undefined?null:Number(input.purchaseCost);
  if(type===STOCK_TX_TYPES.PURCHASE&&purchaseCost!==null&&(!Number.isFinite(purchaseCost)||purchaseCost<0))throw new Error('invalid_purchase_cost');
  const purchaseDate=input.purchaseDate==null?bangkokDate(now):String(input.purchaseDate).trim();
  if(type===STOCK_TX_TYPES.PURCHASE){
    const parsed=Date.parse(purchaseDate+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)||!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,10)!==purchaseDate)throw new Error('invalid_purchase_date');
    if(purchaseDate>bangkokDate(now))throw new Error('future_purchase_date');
  }
  const url=value=>normalizePurchaseUrl(value);
  const purchasePaymentMethod=type===STOCK_TX_TYPES.PURCHASE?String(input.purchasePaymentMethod||'bank').trim().toLowerCase():'';
  if(type===STOCK_TX_TYPES.PURCHASE&&!['cash','bank','other'].includes(purchasePaymentMethod))throw new Error('invalid_purchase_payment_method');
  const costStatus=String(input.costStatus||(purchaseCost===null?'MISSING':'CONFIRMED')).toUpperCase();
  if(!['MISSING','PROVISIONAL','CONFIRMED'].includes(costStatus))throw new Error('invalid_cost_status');
  if(costStatus==='CONFIRMED'&&purchaseCost===null)throw new Error('confirmed_cost_required');
  return {...tx,requestKey,purchaseCost,purchaseDate,packageQty,packageUnit,packSize,packSizeUnit,receivedQuantity,quantityPerPackage,conversionApproximate,supplier:cleanText(input.supplier,120)||'',sourceUrl:url(input.sourceUrl),imageUrl:url(input.imageUrl),purchaseNote:cleanText(input.purchaseNote,500)||'',purchasePaymentMethod,costStatus};
}

export function normalizePurchaseUrl(value){
  let text=String(value||'').trim();
  if(!text)return '';
  if(text.length>500)throw new Error('invalid_purchase_url');
  if(!/^[a-z][a-z0-9+.-]*:\/\//i.test(text))text='https://'+text.replace(/^\/\//,'');
  let parsed;try{parsed=new URL(text)}catch{throw new Error('invalid_purchase_url')}
  if(!['http:','https:'].includes(parsed.protocol)||!parsed.hostname)throw new Error('invalid_purchase_url');
  return parsed.toString();
}

function rowToStock(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    ingredientId: String(row.ingredient_id),
    type: String(row.tx_type),
    qtyDelta: Number(row.qty_delta),
    unit: String(row.unit),
    referenceType: row.reference_type == null ? null : String(row.reference_type),
    referenceId: row.reference_id == null ? null : String(row.reference_id),
    requestKey: String(row.request_key),
    reason: String(row.reason || ''),
    createdBy: row.actor_id == null ? null : String(row.actor_id),
    createdAt: Number(row.created_at),
    purchaseCost: row.cost_status==='MISSING'||row.purchase_total_cost==null?null:Number(row.purchase_total_cost),
    purchaseDate: row.purchased_at==null?null:String(row.purchased_at),
    packageQty: row.package_qty==null?null:Number(row.package_qty),
    packageUnit: String(row.package_unit||''),
    packSize: row.pack_size==null?null:Number(row.pack_size),
    packSizeUnit: String(row.pack_size_unit||''),
    conversionApproximate: !!Number(row.conversion_approximate||0),
    supplier: String(row.supplier||''),
    sourceUrl: String(row.source_url||''),
    imageUrl: String(row.image_url||''),
    purchaseNote: String(row.purchase_note||''),
    purchasePaymentMethod: String(row.payment_method||'bank'),
    costStatus: String(row.cost_status||(row.purchase_total_cost==null?'MISSING':'CONFIRMED')),
  };
}

function sameRequest(a, b) {
  return a.ingredientId === b.ingredientId &&
    a.type === b.type &&
    a.qtyDelta === b.qtyDelta &&
    a.unit === b.unit &&
    a.referenceType === b.referenceType &&
    a.referenceId === b.referenceId &&
    a.reason === b.reason && a.purchaseCost === b.purchaseCost &&
    a.purchaseDate === b.purchaseDate && a.packageQty === b.packageQty &&
    a.packageUnit === b.packageUnit && a.packSize === b.packSize &&
    a.packSizeUnit === b.packSizeUnit && a.conversionApproximate === b.conversionApproximate &&
    a.supplier === b.supplier &&
    a.sourceUrl === b.sourceUrl && a.imageUrl === b.imageUrl &&
    a.purchaseNote === b.purchaseNote && a.purchasePaymentMethod === b.purchasePaymentMethod && a.costStatus === b.costStatus;
}

export async function recordStockTransaction({db, actorId, input, now = Date.now()}) {
  const wanted = normalizeStockWrite(input, {actorId, now});
  const tx = await beginWriteTransaction(db);

  try {
    const found = (await tx.execute({
      sql: `SELECT t.*,p.total_cost AS purchase_total_cost,p.purchased_at,p.package_qty,p.package_unit,
        p.pack_size,p.pack_size_unit,p.conversion_approximate,
        p.supplier,p.source_url,p.image_url,p.note AS purchase_note,p.payment_method,h.cost_status
        FROM field_stock_transactions t
        LEFT JOIN field_purchase_records p ON p.stock_transaction_id=t.id
        LEFT JOIN field_cost_history h ON h.purchase_record_id=p.id
        WHERE t.request_key=?`,
      args: [wanted.requestKey],
    })).rows[0];

    if (found) {
      const existing = rowToStock(found);
      if (!sameRequest(existing, wanted)) {
        await tx.rollback();
        return {status: 'conflict', transaction: existing};
      }
      await tx.rollback();
      return {status: 'replayed', transaction: existing};
    }

    await tx.execute({
      sql: `INSERT INTO field_stock_transactions(
        id,ingredient_id,tx_type,qty_delta,unit,reference_type,reference_id,request_key,reason,actor_id,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        wanted.id,
        wanted.ingredientId,
        wanted.type,
        wanted.qtyDelta,
        wanted.unit,
        wanted.referenceType,
        wanted.referenceId,
        wanted.requestKey,
        wanted.reason,
        wanted.createdBy,
        wanted.createdAt,
      ],
    });

    const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0];
    if(!state)throw new Error('state_missing');
    const doc=JSON.parse(state.document||'{}');
    if(!doc.ingredients||typeof doc.ingredients!=='object')doc.ingredients={};
    const ingredient=doc.ingredients[wanted.ingredientId];
    if(!ingredient)throw new Error('ingredient_missing');
    const nextQty=Number(ingredient.qty||0)+wanted.qtyDelta;
    if(nextQty<0)throw new Error('stock_shortage');
    ingredient.qty=nextQty;
    if(wanted.type===STOCK_TX_TYPES.PURCHASE){
      if((doc.closes||[]).some(x=>x.date===bangkokDate(now)))throw new Error('day_closed');
      if((doc.closes||[]).some(x=>x.date===wanted.purchaseDate))throw new Error('purchase_date_closed');
      const unitCost=wanted.purchaseCost===null?null:wanted.purchaseCost/wanted.qtyDelta;
      if(unitCost!==null)ingredient.unitCost=unitCost;
      if(wanted.packageQty!==null&&wanted.packSize!==null&&wanted.packSizeUnit){
        ingredient.purchaseProfile={
          packageUnit:wanted.packageUnit,
          packSize:wanted.packSize,
          packSizeUnit:wanted.packSizeUnit,
          quantityPerPackage:wanted.quantityPerPackage,
          usageUnit:wanted.unit,
          conversionApproximate:!!wanted.conversionApproximate,
          supplier:wanted.supplier||'',
          sourceUrl:wanted.sourceUrl||'',
          imageUrl:wanted.imageUrl||'',
          purchaseCost:wanted.purchaseCost,
          purchaseDate:wanted.purchaseDate,
          note:wanted.purchaseNote||'',
          paymentMethod:wanted.purchasePaymentMethod,
          updatedAt:now,
        };
      }
      const purchaseRecordId='pur_'+randomUUID();
      if(wanted.purchaseCost!==null){
      if(!Array.isArray(doc.expenses))doc.expenses=[];
      doc.expenses.push({
        id:'exp_'+randomUUID(),date:wanted.purchaseDate,time:now,
        category:'PURCHASE',description:'Purchase '+(ingredient.name||wanted.ingredientId),
        amount:wanted.purchaseCost,ingredientId:wanted.ingredientId,qty:wanted.qtyDelta,unit:wanted.unit,
        referenceId:wanted.referenceId||wanted.id,stockTransactionId:wanted.id,purchaseRecordId,
        paymentMethod:wanted.purchasePaymentMethod,sourceType:'STOCK_PURCHASE',createdBy:actorId||null
      });
      }
      await tx.execute({sql:`INSERT INTO field_purchase_records(id,stock_transaction_id,ingredient_id,supplier,purchased_at,package_qty,package_unit,quantity_received,usage_unit,total_cost,unit_cost,source_url,image_url,note,created_by,created_at,pack_size,pack_size_unit,conversion_approximate,payment_method) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,args:[
        purchaseRecordId,wanted.id,wanted.ingredientId,wanted.supplier,wanted.purchaseDate,wanted.packageQty,wanted.packageUnit,wanted.qtyDelta,wanted.unit,wanted.purchaseCost??0,unitCost??0,wanted.sourceUrl,wanted.imageUrl,wanted.purchaseNote,actorId||null,now,wanted.packSize,wanted.packSizeUnit,wanted.conversionApproximate?1:0,wanted.purchasePaymentMethod
      ]});
      await tx.execute({sql:`INSERT INTO field_cost_history(id,ingredient_id,purchase_record_id,unit_cost,cost_status,effective_date,source_type,supplier,package_qty,package_unit,confirmed_by,confirmed_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,args:[
        'costh_'+randomUUID(),wanted.ingredientId,purchaseRecordId,unitCost,wanted.costStatus,wanted.purchaseDate,'PURCHASE',wanted.supplier,wanted.packageQty,wanted.packageUnit,wanted.costStatus==='CONFIRMED'?(actorId||null):null,wanted.costStatus==='CONFIRMED'?now:null,now
      ]});
    }
    if(wanted.type===STOCK_TX_TYPES.WASTE){
      if((doc.closes||[]).some(x=>x.date===bangkokDate(now)))throw new Error('day_closed');
      if(!Array.isArray(doc.expenses))doc.expenses=[];
      const unitCost=Math.max(0,Number(ingredient.unitCost)||0),amount=Math.abs(wanted.qtyDelta)*unitCost;
      doc.expenses.push({id:'exp_'+randomUUID(),date:bangkokDate(now),time:now,category:'WASTE',description:'Waste '+(ingredient.name||wanted.ingredientId)+(wanted.reason?' · '+wanted.reason:''),amount,ingredientId:wanted.ingredientId,qty:Math.abs(wanted.qtyDelta),unit:wanted.unit,referenceId:wanted.id,paymentMethod:'noncash',sourceType:'STOCK_WASTE',costStatus:String(ingredient.costStatus||(unitCost>0?'CONFIRMED':'MISSING')),createdBy:actorId||null});
    }
    await tx.execute({
      sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',
      args:[JSON.stringify(doc),now],
    });

    await tx.execute({
      sql: 'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',
      args: [
        actorId || null,
        'stock_transaction_create',
        JSON.stringify({
          id: wanted.id,
          ingredientId: wanted.ingredientId,
          type: wanted.type,
          qtyDelta: wanted.qtyDelta,
          referenceType: wanted.referenceType,
          referenceId: wanted.referenceId,
          requestKey: wanted.requestKey,
        }),
        now,
      ],
    });

    await tx.commit();
    return {status: 'created', transaction: wanted};
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  }
}
