import {randomUUID} from 'node:crypto';

const clone = value => JSON.parse(JSON.stringify(value ?? {}));
const n = value => Number(value) || 0;
const bad = (message,status=400) => Object.assign(new Error(message),{status});

function findVariant(doc,item){
  const menu=(doc.menu||[]).find(m=>m.id===item.id);
  if(!menu||!menu.enabled||n(menu.price)<=0)throw bad('menu_unavailable',409);
  const variant=(menu.variants||[]).find(v=>v.label===item.variant);
  if(!variant)throw bad('variant_unavailable',409);
  return {menu,variant};
}
function queueLabelFromSeq(seq){return 'A'+String(seq).padStart(3,'0')}
function costInfo(doc,variant){
  let cost=0;
  for(const [key,qty] of Object.entries(variant?.recipe?.items||{})){
    const ing=doc.ingredients?.[key],unit=n(ing?.unitCost);
    if(unit>0)cost+=n(qty)*unit;
  }
  return cost;
}
function ensureRequestStore(doc){
  if(!doc.posRequestKeys||typeof doc.posRequestKeys!=='object'||Array.isArray(doc.posRequestKeys))doc.posRequestKeys={};
  return doc.posRequestKeys;
}
function remember(doc,key,response){
  const store=ensureRequestStore(doc);
  store[key]={at:Date.now(),response};
  const keys=Object.keys(store).sort((a,b)=>n(store[a]?.at)-n(store[b]?.at));
  while(keys.length>100){delete store[keys.shift()]}
}
function replay(doc,key){
  return key&&ensureRequestStore(doc)[key]?.response||null;
}
export async function getPosRequestReplay({db,requestKey}){
  if(typeof requestKey!=='string'||requestKey.length<8||requestKey.length>120)return null;
  const row=(await db.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0];
  if(!row)return null;
  const response=replay(readStateRow(row),requestKey);
  return response?{...response,replayed:true}:null;
}
function validateRequestKey(key){
  if(typeof key!=='string'||key.length<8||key.length>120)throw bad('invalid_request_key');
}
function readStateRow(row){
  const doc=JSON.parse(row.document||'{}');
  if(!Array.isArray(doc.sales))doc.sales=[];
  if(!Array.isArray(doc.orders))doc.orders=[];
  if(!doc.ingredients||typeof doc.ingredients!=='object')doc.ingredients={};
  if(!doc.settings||typeof doc.settings!=='object')doc.settings={};
  if(!doc.billSeq||typeof doc.billSeq!=='object')doc.billSeq={};
  if(!Array.isArray(doc.paymentSessions))doc.paymentSessions=[];
  return doc;
}
async function saveState(tx,row,doc,actorId,action,details,now){
  prunePaymentSessions(doc);
  const nextRevision=n(row.revision)+1;
  await tx.execute({sql:'UPDATE field_state SET revision=?,document=?,updated_at=? WHERE singleton=1',args:[nextRevision,JSON.stringify(doc),now]});
  await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[actorId,action,JSON.stringify(details||{}),now]});
  return nextRevision;
}
function activeOrders(doc){return doc.orders.filter(o=>!['returned','void'].includes(String(o.status||'')))}
function activePaymentSessions(doc,now=Date.now()){
  return (doc.paymentSessions||[]).filter(s=>s.status==='requires_resolution'||(s.status==='collecting'&&n(s.expiresAt)>now));
}
function firstFreePager(doc,now=Date.now()){
  const used=new Set(activeOrders(doc).map(o=>n(o.pagerNo)));
  for(const s of activePaymentSessions(doc,now))used.add(n(s.pager));
  const max=Math.max(1,n(doc.settings?.pagerCount)||10);
  for(let i=1;i<=max;i++)if(!used.has(i))return i;
  return null;
}
function normalizeCart(body){
  if(!Array.isArray(body.cart)||!body.cart.length)throw bad('empty_cart');
  return body.cart.map(x=>{
    const qty=Math.floor(n(x.qty));
    if(!x?.id||!x?.variant||qty<1||qty>50)throw bad('invalid_cart');
    return {id:String(x.id),variant:String(x.variant),qty};
  });
}
function deductStock(doc,prepared){
  const need={};
  for(const p of prepared){
    for(const [key,qty] of Object.entries(p.variant?.recipe?.items||{}))need[key]=n(need[key])+n(qty)*p.qty;
  }
  for(const [key,qty] of Object.entries(need)){
    const ing=doc.ingredients?.[key];
    if(!ing)throw bad('ingredient_missing',409);
    if(n(ing.qty)<qty)throw bad('stock_shortage:'+key,409);
  }
  for(const [key,qty] of Object.entries(need))doc.ingredients[key].qty=n(doc.ingredients[key].qty)-qty;
}
function restoreStock(doc,items){
  for(const item of items||[]){
    for(const [key,qty] of Object.entries(item.recipe?.items||{})){
      if(doc.ingredients?.[key])doc.ingredients[key].qty=n(doc.ingredients[key].qty)+(n(qty)*n(item.qty));
    }
  }
}
function cleanupExpiredPaymentSessions(doc,now){
  const transitions=[];
  for(const s of doc.paymentSessions||[]){
    if(s.status==='collecting'&&n(s.expiresAt)<=now){
      if((s.payments||[]).length){s.status='requires_resolution';s.resolutionRequiredAt=now;transitions.push({sessionId:s.id,status:s.status,stockRestored:false})}
      else{restoreStock(doc,s.items);s.status='expired';s.expiredAt=now;transitions.push({sessionId:s.id,status:s.status,stockRestored:true})}
    }
  }
  return transitions;
}
function prunePaymentSessions(doc){
  const active=new Set(['collecting','requires_resolution']);
  const inactive=(doc.paymentSessions||[]).filter(s=>!active.has(s.status)).sort((a,b)=>n(b.updatedAt||b.completedAt||b.createdAt)-n(a.updatedAt||a.completedAt||a.createdAt));
  const keep=new Set(inactive.slice(0,50).map(s=>s.id));
  doc.paymentSessions=(doc.paymentSessions||[]).filter(s=>active.has(s.status)||keep.has(s.id));
}
function splitSessionView(s){
  return {
    id:s.id,status:s.status,total:n(s.total),pager:n(s.pager),date:s.date,
    remainingQty:(s.remainingQty||[]).map(n),
    items:(s.items||[]).map(x=>({id:x.id,name:x.name,variant:x.variant,qty:n(x.qty),price:n(x.price)})),
    payments:(s.payments||[]).map(p=>({
      id:p.id,label:p.label,method:p.method,amount:n(p.amount),received:n(p.received),change:n(p.change),
      allocations:clone(p.allocations)
    })),
    remainingAmount:(s.items||[]).reduce((sum,item,i)=>sum+n(item.price)*n(s.remainingQty?.[i]),0),
    expiresAt:n(s.expiresAt),
    completedAt:n(s.completedAt)||null,
    orderId:s.orderId||null,
    queueNo:s.queueNo||null
  };
}
function validateSplitAllocations(session,allocations){
  if(!Array.isArray(allocations)||!allocations.length)throw bad('invalid_payment_allocations');
  let amount=0;
  const normalized=[];
  for(const a of allocations){
    const index=Math.floor(n(a.index)),qty=Math.floor(n(a.qty));
    if(index<0||index>=session.items.length||qty<1)throw bad('invalid_payment_allocation');
    if(qty>n(session.remainingQty[index]))throw bad('payment_allocation_exceeds_item',409);
    amount+=n(session.items[index].price)*qty;
    normalized.push({index,qty});
  }
  return {amount,allocations:normalized};
}
function normalizeSplitPayment(body,session){
  const {amount,allocations}=validateSplitAllocations(session,body.allocations);
  const method=String(body.method||'');
  if(!['cash','promptpay','other'].includes(method))throw bad('invalid_payment');
  const received=method==='cash'?n(body.received):amount;
  if(method==='cash'&&received<amount)throw bad('cash_insufficient',409);
  if(method==='promptpay'&&!body.paymentVerified)throw bad('promptpay_not_verified',409);
  if(method==='promptpay'&&(!Number.isFinite(Number(body.paymentProviderAmount))||Math.abs(Number(body.paymentProviderAmount)-amount)>0.001))throw bad('promptpay_amount_mismatch',409);
  return {
    id:'pay-'+randomUUID(),
    label:String(body.label||('คนที่ '+((session.payments?.length||0)+1))).slice(0,60),
    method,amount,received,
    change:method==='cash'?Math.max(0,received-amount):0,
    allocations,
    paymentReference:method==='promptpay'?(body.paymentReference||null):null,
    paymentVerified:method==='promptpay'?(body.paymentVerified||'manual'):true,
    paidAt:Date.now()
  };
}
function normalizePayments(body,items){
  const total=items.reduce((s,x)=>s+x.price*x.qty,0);
  if(body.payments!==undefined)throw bad('multi_payment_requires_split_session',409);
  {
    const method=String(body.payment||'cash');
    if(!['cash','promptpay','other'].includes(method))throw bad('invalid_payment');
    const received=method==='cash'?n(body.received):total;
    if(method==='cash'&&received<total)throw bad('cash_insufficient',409);
    if(method==='promptpay'&&!body.paymentVerified)throw bad('promptpay_not_verified',409);
    if(method==='promptpay'&&(!Number.isFinite(Number(body.paymentProviderAmount))||Math.abs(Number(body.paymentProviderAmount)-total)>0.001))throw bad('promptpay_amount_mismatch',409);
    return [{
      method,amount:total,received,change:method==='cash'?Math.max(0,received-total):0,
      paymentReference:method==='promptpay'?(body.paymentReference||null):null,
      paymentVerified:method==='promptpay'?(body.paymentVerified||'manual'):true,
      allocations:items.map((x,index)=>({index,qty:x.qty}))
    }];
  }
}

async function writeSaleAccounting(tx,{sale,orderId,doc,now}){
  for(const [itemIndex,item] of (sale.items||[]).entries()){
    for(const [ingredientId,qtyPerUnit] of Object.entries(item.recipe?.items||{})){
      const qty=n(qtyPerUnit)*n(item.qty);
      if(qty<=0)continue;
      await tx.execute({sql:'INSERT INTO field_stock_transactions(id,ingredient_id,tx_type,qty_delta,unit,reference_type,reference_id,request_key,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',args:[
        'stx_'+randomUUID(),ingredientId,'SALE',-qty,String(doc.ingredients?.[ingredientId]?.unit||'g'),'sale',sale.id,'sale:'+sale.id+':'+itemIndex+':'+ingredientId,'POS recipe deduction',sale.createdBy,now
      ]});
    }
    await tx.execute({sql:'INSERT INTO field_cost_snapshots(id,sale_id,order_id,order_item_id,menu_id,recipe_version,standard_cost,document,created_at) VALUES(?,?,?,?,?,?,?,?,?)',args:[
      'cost_'+randomUUID(),sale.id,orderId||null,null,item.id,item.recipeVersion||null,n(item.unitCost),JSON.stringify({
        menuId:item.id,name:item.name,variant:item.variant,qty:n(item.qty),unitCost:n(item.unitCost),
        lineCost:n(item.unitCost)*n(item.qty),recipe:clone(item.recipe)
      }),now
    ]});
  }
}

function buildItems(doc,cart){
  return cart.map(x=>{
    const {menu,variant}=findVariant(doc,x);
    return {
      id:menu.id,
      name:menu.name,
      variant:variant.label,
      qty:x.qty,
      price:n(menu.price),
      unitCost:costInfo(doc,variant),
      recipeVersion:n(variant.recipeVersion)||null,
      recipe:clone(variant.recipe)
    };
  });
}

export async function checkoutPos({db,user,body,now=Date.now()}){
  validateRequestKey(body.requestKey);
  const tx=await db.transaction('write');
  try{
    const row=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0];
    const doc=readStateRow(row);
    cleanupExpiredPaymentSessions(doc,now);
    const old=replay(doc,body.requestKey);
    if(old){await tx.rollback();return {...old,replayed:true}}

    const cart=normalizeCart(body),items=buildItems(doc,cart);
    deductStock(doc,items.map((x,i)=>({...x,variant:findVariant(doc,cart[i]).variant})));

    const target=body.targetOrderId?doc.orders.find(o=>o.id===body.targetOrderId&&o.status!=='returned'):null;
    if(body.targetOrderId&&!target)throw bad('target_order_unavailable',409);
    const pager=target?n(target.pagerNo):firstFreePager(doc,now);
    if(pager===null)throw bad('no_pager_available',409);

    const date=String(body.date||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw bad('invalid_date');
    if(body.serverDate&&String(body.serverDate)!==date)throw bad('business_date_changed',409);
    if((doc.closes||[]).some(x=>x.date===date))throw bad('day_closed',409);
    const seq=n(doc.billSeq[date])+1;
    const paymentGroupId='pg-'+randomUUID();
    const total=items.reduce((s,x)=>s+x.price*x.qty,0);
    const payments=normalizePayments(body,items);
    const salePayment=payments.length===1?payments[0].method:'split';
    const saleReceived=payments.reduce((s,p)=>s+n(p.received),0);
    const saleChange=payments.reduce((s,p)=>s+n(p.change),0);
    const sale={
      id:'s-'+randomUUID(),createdBy:user.id,
      billNo:'FIELD-'+date.replaceAll('-','')+'-'+String(seq).padStart(3,'0'),
      time:now,date,items,total,
      costTotal:items.reduce((s,x)=>s+x.unitCost*x.qty,0),
      payment:salePayment,received:saleReceived,change:saleChange,status:'paid',
      pagerNo:pager,customerId:body.customerId||null,
      pointsAwarded:0,paymentGroupId,parentOrderId:target?.id||null,
      paymentReference:payments.length===1?payments[0].paymentReference:null,
      paymentVerified:payments.every(p=>p.method!=='promptpay'||!!p.paymentVerified),
      payments:payments.map(p=>({
        method:p.method,amount:p.amount,received:p.received,change:p.change,
        paymentReference:p.paymentReference,paymentVerified:p.paymentVerified,
        label:p.label,
        items:p.allocations.map(a=>({
          id:items[a.index].id,name:items[a.index].name,variant:items[a.index].variant,
          qty:a.qty,price:items[a.index].price
        }))
      }))
    };
    const pointsSpend=Math.max(0,n(doc.settings?.pointsSpend));
    sale.pointsAwarded=body.customerId&&pointsSpend>0?Math.floor(total/pointsSpend):0;
    if(body.customerId){
      if(!Array.isArray(doc.customers))doc.customers=[];
      const customer=doc.customers.find(x=>x.id===body.customerId);
      if(customer){
        customer.points=n(customer.points)+sale.pointsAwarded;
        customer.visits=n(customer.visits)+1;
        customer.totalSpend=n(customer.totalSpend)+total;
        customer.lastVisit=now;
      }
    }
    const sales=[sale];
    doc.billSeq[date]=seq;

    let order;
    if(target){
      const added=items.map(x=>({id:x.id,name:x.name,variant:x.variant,qty:x.qty,readyQty:0,calledQty:0,addedAt:now,saleIds:[sale.id]}));
      target.items=[...(target.items||[]),...added];
      target.saleIds=[...(target.saleIds||[target.saleId]).filter(Boolean),...sales.map(s=>s.id)];
      target.total=n(target.total)+total;target.lastAddedAt=now;
      if(target.status==='ready')target.status='making';
      if(!target.status||target.status==='assigned')target.status='assigned';
      order=target;
    }else{
      const q=queueLabelFromSeq(seq);
      order={id:'o-'+randomUUID(),createdBy:user.id,saleId:sale.id,saleIds:[sale.id],
        billNo:sale.billNo,queueNo:q,items:items.map(x=>({id:x.id,name:x.name,variant:x.variant,qty:x.qty,readyQty:0,calledQty:0})),
        total,pagerNo:pager,status:'assigned',time:now,paymentGroupId};
      doc.orders.push(order);
    }
    sales.forEach(s=>s.queueNo=order.queueNo||queueLabelFromSeq(seq));
    doc.sales.push(...sales);
    for(const s of sales)await writeSaleAccounting(tx,{sale:s,orderId:order.id,doc,now});
    doc.cart=[];

    const response={ok:true,orderId:order.id,pager,queueNo:order.queueNo||queueLabelFromSeq(seq),saleIds:[sale.id]};
    remember(doc,body.requestKey,response);
    const revision=await saveState(tx,row,doc,user.id,'pos_checkout',{orderId:order.id,saleIds:response.saleIds,pager},now);
    await tx.commit();
    return {...response,revision,state:doc,replayed:false};
  }catch(e){await tx.rollback().catch(()=>{});throw e}
}


export async function voidSale({db,user,body,now=Date.now()}){
  validateRequestKey(body.requestKey);
  const saleId=String(body.saleId||'').trim(),reason=String(body.reason||'').trim().slice(0,240);
  if(!saleId)throw bad('sale_required');
  const tx=await db.transaction('write');
  try{
    const row=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0];
    const doc=readStateRow(row),sale=(doc.sales||[]).find(s=>s.id===saleId);
    if(!sale)throw bad('sale_not_found',404);
    if(sale.status==='void'){
      if(sale.voidRequestKey===body.requestKey){await tx.rollback();return {ok:true,replayed:true,saleId,orderId:sale.orderId||null}}
      throw bad('sale_already_void',409);
    }
    if(sale.status!=='paid')throw bad('sale_not_voidable',409);
    if(String(sale.payment||'')!=='cash')throw bad('non_cash_void_requires_refund',409);
    const order=(doc.orders||[]).find(o=>o.saleId===saleId||(o.saleIds||[]).includes(saleId));
    if(!order)throw bad('order_not_found',404);
    const saleIds=(order.saleIds||[order.saleId]).filter(Boolean);
    if(saleIds.length!==1)throw bad('void_multi_sale_order_not_supported',409);
    if((order.items||[]).some(i=>n(i.readyQty)>0||n(i.calledQty)>0))throw bad('void_after_production_started',409);
    for(const [itemIndex,item] of (sale.items||[]).entries()){
      for(const [ingredientId,qtyPerUnit] of Object.entries(item.recipe?.items||{})){
        const qty=n(qtyPerUnit)*n(item.qty);if(qty<=0)continue;
        const ingredient=doc.ingredients?.[ingredientId];if(!ingredient)throw bad('ingredient_missing',409);
        ingredient.qty=n(ingredient.qty)+qty;
        await tx.execute({sql:`INSERT INTO field_stock_transactions(
          id,ingredient_id,tx_type,qty_delta,unit,reference_type,reference_id,request_key,reason,actor_id,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,args:[
          'stx_void_'+randomUUID(),ingredientId,'VOID_REVERSAL',qty,ingredient.unit||'g',
          'void',saleId,body.requestKey+':'+itemIndex+':'+ingredientId,reason||'Cash sale void',user.id,now
        ]});
      }
    }
    sale.status='void';sale.voidedAt=now;sale.voidedBy=user.id;sale.voidReason=reason||'Cash sale void';sale.voidRequestKey=body.requestKey;sale.orderId=order.id;
    order.status='void';order.voidedAt=now;order.voidedBy=user.id;
    const revision=await saveState(tx,row,doc,user.id,'sale_void',{saleId,orderId:order.id,reason:sale.voidReason},now);
    await tx.commit();return {ok:true,replayed:false,saleId,orderId:order.id,revision};
  }catch(e){await tx.rollback().catch(()=>{});throw e}
}

export async function refundSale({db,user,body,now=Date.now()}){
  validateRequestKey(body.requestKey);
  const saleId=String(body.saleId||'').trim(),reason=String(body.reason||'').trim().slice(0,240),manualReference=String(body.manualReference||'').trim().slice(0,120);
  if(!saleId)throw bad('sale_required');
  const tx=await db.transaction('write');
  try{
    const row=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0];
    const doc=readStateRow(row),sale=(doc.sales||[]).find(s=>s.id===saleId);
    if(!sale)throw bad('sale_not_found',404);
    if(sale.status==='refunded'){
      if(sale.refundRequestKey===body.requestKey){await tx.rollback();return {ok:true,replayed:true,saleId,stockRestored:!!sale.refundStockRestored}}
      throw bad('sale_already_refunded',409);
    }
    if(sale.status!=='paid')throw bad('sale_not_refundable',409);
    if((doc.closes||[]).some(x=>x.date===sale.date))throw bad('refund_closed_day',409);
    if(!['cash','promptpay'].includes(String(sale.payment||'')))throw bad('refund_payment_not_supported',409);
    const order=(doc.orders||[]).find(o=>o.saleId===saleId||(o.saleIds||[]).includes(saleId));
    if(!order)throw bad('order_not_found',404);
    const saleIds=(order.saleIds||[order.saleId]).filter(Boolean);
    if(saleIds.length!==1)throw bad('refund_multi_sale_order_not_supported',409);
    const productionStarted=order.status==='returned'||(order.items||[]).some(i=>n(i.readyQty)>0||n(i.calledQty)>0);
    if(sale.payment==='cash'&&!productionStarted)throw bad('use_void_before_production',409);
    if(sale.payment==='promptpay'){
      if(body.manualConfirmed!==true)throw bad('promptpay_manual_refund_required',409);
      if(!manualReference)throw bad('manual_refund_reference_required');
    }
    let stockRestored=false;
    if(sale.payment==='promptpay'&&!productionStarted){
      for(const [itemIndex,item] of (sale.items||[]).entries()){
        for(const [ingredientId,qtyPerUnit] of Object.entries(item.recipe?.items||{})){
          const qty=n(qtyPerUnit)*n(item.qty);if(qty<=0)continue;
          const ingredient=doc.ingredients?.[ingredientId];if(!ingredient)throw bad('ingredient_missing',409);
          ingredient.qty=n(ingredient.qty)+qty;stockRestored=true;
          await tx.execute({sql:`INSERT INTO field_stock_transactions(
            id,ingredient_id,tx_type,qty_delta,unit,reference_type,reference_id,request_key,reason,actor_id,created_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,args:[
            'stx_refund_'+randomUUID(),ingredientId,'REFUND_REVERSAL',qty,ingredient.unit||'g',
            'refund',saleId,body.requestKey+':'+itemIndex+':'+ingredientId,reason||'PromptPay refund before production',user.id,now
          ]});
        }
      }
    }
    if(order.status!=='returned'){order.status='void';order.refundedAt=now;order.refundedBy=user.id}
    sale.status='refunded';sale.refundedAt=now;sale.refundedBy=user.id;sale.refundReason=reason||'Full refund';sale.refundRequestKey=body.requestKey;
    sale.refundMethod=sale.payment==='cash'?'cash':'manual_promptpay';sale.refundReference=sale.payment==='promptpay'?manualReference:null;sale.refundAmount=n(sale.total);sale.refundStockRestored=stockRestored;
    if(sale.customerId){
      const customer=(doc.customers||[]).find(x=>x.id===sale.customerId);
      if(customer){customer.totalSpend=Math.max(0,n(customer.totalSpend)-n(sale.total));customer.points=Math.max(0,n(customer.points)-n(sale.pointsAwarded))}
    }
    const revision=await saveState(tx,row,doc,user.id,'sale_refund',{saleId,amount:sale.refundAmount,method:sale.refundMethod,reason:sale.refundReason,reference:sale.refundReference,stockRestored},now);
    await tx.commit();return {ok:true,replayed:false,saleId,revision,refundAmount:sale.refundAmount,refundMethod:sale.refundMethod,stockRestored};
  }catch(e){await tx.rollback().catch(()=>{});throw e}
}

export async function startSplitPayment({db,user,body,now=Date.now()}){
  validateRequestKey(body.requestKey);
  const tx=await db.transaction('write');
  try{
    const row=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0];
    const doc=readStateRow(row);
    cleanupExpiredPaymentSessions(doc,now);
    const old=replay(doc,body.requestKey);
    if(old){await tx.rollback();return {...old,replayed:true}}
    if(body.targetOrderId)throw bad('split_existing_order_unsupported',409);

    const cart=normalizeCart(body),items=buildItems(doc,cart);
    deductStock(doc,items.map((x,i)=>({...x,variant:findVariant(doc,cart[i]).variant})));

    const pager=firstFreePager(doc,now);
    if(pager===null)throw bad('no_pager_available',409);
    const date=String(body.date||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw bad('invalid_date');
    if(body.serverDate&&String(body.serverDate)!==date)throw bad('business_date_changed',409);
    if((doc.closes||[]).some(x=>x.date===date))throw bad('day_closed',409);

    const session={
      id:'split-'+randomUUID(),createdBy:user.id,createdAt:now,updatedAt:now,
      expiresAt:now+(4*60*60*1000),status:'collecting',
      date,pager,customerId:body.customerId||null,
      items,remainingQty:items.map(x=>x.qty),payments:[],
      total:items.reduce((s,x)=>s+n(x.price)*n(x.qty),0)
    };
    doc.paymentSessions.push(session);
    const response={ok:true,session:splitSessionView(session)};
    remember(doc,body.requestKey,response);
    const revision=await saveState(tx,row,doc,user.id,'split_payment_start',{sessionId:session.id,pager,total:session.total},now);
    await tx.commit();
    return {...response,revision,state:doc,replayed:false};
  }catch(e){await tx.rollback().catch(()=>{});throw e}
}

export async function paySplitPayment({db,user,body,now=Date.now()}){
  validateRequestKey(body.requestKey);
  const tx=await db.transaction('write');
  try{
    const row=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0];
    const doc=readStateRow(row);
    cleanupExpiredPaymentSessions(doc,now);
    const old=replay(doc,body.requestKey);
    if(old){await tx.rollback();return {...old,replayed:true}}

    const session=(doc.paymentSessions||[]).find(s=>s.id===body.sessionId);
    if(!session||session.status!=='collecting')throw bad('split_session_unavailable',409);
    if(n(session.expiresAt)<=now)throw bad('split_session_expired',409);
    if((doc.closes||[]).some(x=>x.date===session.date))throw bad('day_closed',409);

    const payment=normalizeSplitPayment(body,session);
    for(const a of payment.allocations)session.remainingQty[a.index]=n(session.remainingQty[a.index])-a.qty;
    session.payments.push(payment);session.updatedAt=now;

    const remaining=session.remainingQty.reduce((s,q)=>s+n(q),0);
    let completed=false,order=null,sale=null;

    if(remaining===0){
      const date=session.date;
      const seq=n(doc.billSeq[date])+1;
      const paymentGroupId='pg-'+randomUUID();
      const payments=session.payments;
      const total=n(session.total);
      sale={
        id:'s-'+randomUUID(),createdBy:user.id,
        billNo:'FIELD-'+date.replaceAll('-','')+'-'+String(seq).padStart(3,'0'),
        time:now,date,items:session.items,total,
        costTotal:session.items.reduce((s,x)=>s+n(x.unitCost)*n(x.qty),0),
        payment:payments.length===1?payments[0].method:'split',
        received:payments.reduce((s,p)=>s+n(p.received),0),
        change:payments.reduce((s,p)=>s+n(p.change),0),
        status:'paid',pagerNo:session.pager,customerId:session.customerId||null,
        pointsAwarded:0,paymentGroupId,parentOrderId:null,
        paymentReference:payments.length===1?payments[0].paymentReference:null,
        paymentVerified:payments.every(p=>p.method!=='promptpay'||!!p.paymentVerified),
        payments:payments.map(p=>({
          id:p.id,label:p.label,method:p.method,amount:p.amount,received:p.received,change:p.change,
          paymentReference:p.paymentReference,paymentVerified:p.paymentVerified,paidAt:p.paidAt,
          items:p.allocations.map(a=>({
            id:session.items[a.index].id,name:session.items[a.index].name,variant:session.items[a.index].variant,
            qty:a.qty,price:session.items[a.index].price
          }))
        }))
      };
      const pointsSpend=Math.max(0,n(doc.settings?.pointsSpend));
      sale.pointsAwarded=session.customerId&&pointsSpend>0?Math.floor(total/pointsSpend):0;
      if(session.customerId){
        if(!Array.isArray(doc.customers))doc.customers=[];
        const customer=doc.customers.find(x=>x.id===session.customerId);
        if(customer){
          customer.points=n(customer.points)+sale.pointsAwarded;
          customer.visits=n(customer.visits)+1;
          customer.totalSpend=n(customer.totalSpend)+total;
          customer.lastVisit=now;
        }
      }

      const q=queueLabelFromSeq(seq);
      order={id:'o-'+randomUUID(),createdBy:user.id,saleId:sale.id,saleIds:[sale.id],
        billNo:sale.billNo,queueNo:q,
        items:session.items.map(x=>({id:x.id,name:x.name,variant:x.variant,qty:x.qty,readyQty:0,calledQty:0})),
        total,pagerNo:session.pager,status:'assigned',time:now,paymentGroupId};
      sale.queueNo=q;
      doc.billSeq[date]=seq;
      doc.sales.push(sale);doc.orders.push(order);
      await writeSaleAccounting(tx,{sale,orderId:order.id,doc,now});
      session.status='completed';session.completedAt=now;session.orderId=order.id;session.saleId=sale.id;session.queueNo=q;
      completed=true;
    }

    const response={
      ok:true,completed,
      session:splitSessionView(session),
      orderId:order?.id||null,pager:session.pager,queueNo:order?.queueNo||null,saleId:sale?.id||null
    };
    remember(doc,body.requestKey,response);
    const revision=await saveState(tx,row,doc,user.id,completed?'split_payment_complete':'split_payment_part',
      {sessionId:session.id,paymentId:payment.id,amount:payment.amount,completed},now);
    await tx.commit();
    return {...response,revision,state:doc,replayed:false};
  }catch(e){await tx.rollback().catch(()=>{});throw e}
}

export async function listSplitPaymentSessions({db,now=Date.now()}){
  const tx=await db.transaction('write');
  try{
  const row=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0];
  const doc=readStateRow(row),transitions=cleanupExpiredPaymentSessions(doc,now);
  let revision=n(row.revision);
  if(transitions.length){revision=await saveState(tx,row,doc,null,'split_payment_expiry_reconcile',{transitions},now);await tx.commit()}else await tx.rollback();
  const sessions=(doc.paymentSessions||[])
    .filter(s=>['collecting','requires_resolution'].includes(s.status))
    .sort((a,b)=>n(a.createdAt)-n(b.createdAt))
    .map(splitSessionView);
  return {ok:true,revision,sessions};
  }catch(e){await tx.rollback().catch(()=>{});throw e}
}

export async function getSplitPaymentStatus({db,body,now=Date.now()}){
  const row=(await db.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0];
  const doc=readStateRow(row);
  const session=(doc.paymentSessions||[]).find(s=>s.id===body.sessionId);
  if(!session)throw bad('split_session_not_found',404);
  return {ok:true,revision:n(row.revision),session:splitSessionView(session)};
}

export async function cancelSplitPayment({db,user,body,now=Date.now()}){
  validateRequestKey(body.requestKey);
  const tx=await db.transaction('write');
  try{
    const row=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0];
    const doc=readStateRow(row);
    const old=replay(doc,body.requestKey);
    if(old){await tx.rollback();return {...old,replayed:true}}
    const session=(doc.paymentSessions||[]).find(s=>s.id===body.sessionId);
    if(!session||session.status!=='collecting')throw bad('split_session_unavailable',409);
    if((session.payments||[]).length)throw bad('split_session_has_payments',409);
    restoreStock(doc,session.items);
    session.status='cancelled';session.cancelledAt=now;
    const response={ok:true,session:splitSessionView(session)};
    remember(doc,body.requestKey,response);
    const revision=await saveState(tx,row,doc,user.id,'split_payment_cancel',{sessionId:session.id},now);
    await tx.commit();
    return {...response,revision,state:doc,replayed:false};
  }catch(e){await tx.rollback().catch(()=>{});throw e}
}

export async function resolveSplitPayment({db,user,body,now=Date.now()}){
  validateRequestKey(body.requestKey);
  const tx=await db.transaction('write');
  try{
    const row=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=readStateRow(row);
    const old=replay(doc,body.requestKey);if(old){await tx.rollback();return {...old,replayed:true}}
    const session=(doc.paymentSessions||[]).find(s=>s.id===body.sessionId);
    if(!session||session.status!=='requires_resolution')throw bad('split_resolution_unavailable',409);
    session.status='collecting';session.expiresAt=now+(4*60*60*1000);session.resolvedAt=now;session.resolvedBy=user.id;session.updatedAt=now;
    const response={ok:true,session:splitSessionView(session)};remember(doc,body.requestKey,response);
    const revision=await saveState(tx,row,doc,user.id,'split_payment_resolution',{sessionId:session.id,action:'RESUME',payments:(session.payments||[]).length},now);
    await tx.commit();return {...response,revision,replayed:false};
  }catch(e){await tx.rollback().catch(()=>{});throw e}
}

export async function queuePosAction({db,user,body,now=Date.now()}){
  validateRequestKey(body.requestKey);
  const action=String(body.action||'');
  if(!['start','finish','return','select'].includes(action))throw bad('invalid_queue_action');
  const tx=await db.transaction('write');
  try{
    const row=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0];
    const doc=readStateRow(row);
    const old=replay(doc,body.requestKey);
    if(old){await tx.rollback();return {...old,replayed:true}}
    const order=doc.orders.find(o=>o.id===body.orderId&&o.status!=='returned');
    if(!order)throw bad('order_not_found',404);
    const idx=Math.floor(n(body.itemIndex)),item=order.items?.[idx];

    if(action==='select'){
      if(!item)throw bad('item_not_found',404);
      for(const o of doc.orders)for(const x of o.items||[])x.prepSelected=false;
      item.prepSelected=!!body.selected;
    }else if(action==='start'){
      if(!item)throw bad('item_not_found',404);
      const unit=Math.floor(n(body.unit));
      const ready=n(item.readyQty);
      if(unit!==ready+1||unit>n(item.qty))throw bad('queue_state_changed',409);
      item.readyQty=unit;order.status='making';
    }else if(action==='finish'){
      if(!item)throw bad('item_not_found',404);
      const unit=Math.floor(n(body.unit)),ready=n(item.readyQty),called=n(item.calledQty);
      if(unit>ready||unit!==called+1)throw bad('queue_state_changed',409);
      item.calledQty=unit;
      if(item.calledQty>=n(item.qty))item.prepSelected=false;
      order.status=(order.items||[]).every(x=>n(x.calledQty)>=n(x.qty))?'ready':'making';
    }else if(action==='return'){
      const active=activeOrders(doc).sort((a,b)=>n(a.time)-n(b.time));
      if(active[0]?.id!==order.id)throw bad('fifo_violation',409);
      if(!(order.items||[]).every(x=>n(x.calledQty)>=n(x.qty)))throw bad('order_not_complete',409);
      order.status='returned';order.deliveredAt=now;
    }

    const response={ok:true,orderId:order.id,action};
    remember(doc,body.requestKey,response);
    const revision=await saveState(tx,row,doc,user.id,'queue_'+action,{orderId:order.id,itemIndex:idx,unit:body.unit},now);
    await tx.commit();
    return {...response,revision,state:doc,replayed:false};
  }catch(e){await tx.rollback().catch(()=>{});throw e}
}
