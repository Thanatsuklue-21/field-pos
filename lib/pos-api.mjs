import {beginWriteTransaction} from './transactions.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {operationalUnitCost} from './domain/costing.mjs';
import {getMenuStructure,prepBaseState} from './domain/menu-structure.mjs';
import {resolveLoyalty,applyLoyaltyToCustomer,reverseLoyaltyFromCustomer} from './domain/loyalty.mjs';
import {deliverySettlement} from './domain/delivery.mjs';

const clone = value => JSON.parse(JSON.stringify(value ?? {}));
const n = value => Number(value) || 0;
const bad = (message,status=400) => Object.assign(new Error(message),{status});
async function txBatch(tx,statements){
  if(!statements.length)return [];
  if(typeof tx.batch==='function')return tx.batch(statements);
  const out=[];
  for(const statement of statements)out.push(await tx.execute(statement));
  return out;
}

function findVariant(doc,item){
  const menu=(doc.menu||[]).find(m=>m.id===item.id);
  if(!menu||!menu.enabled||menu.archived||!Number.isFinite(Number(menu.price))||n(menu.price)<=0)throw bad('menu_unavailable',409);
  const variant=(menu.variants||[]).find(v=>v.label===item.variant);
  if(!variant)throw bad('variant_unavailable',409);
  const recipe=variant.recipe?.items;
  if(!recipe||typeof recipe!=='object'||Array.isArray(recipe)||!Object.keys(recipe).length||Object.values(recipe).some(q=>!Number.isFinite(Number(q))||Number(q)<0)||!Object.values(recipe).some(q=>Number(q)>0))throw bad('recipe_unavailable',409);
  return {menu,variant};
}
function queueLabelFromSeq(seq){return 'A'+String(seq).padStart(3,'0')}
function costInfo(doc,variant){
  let cost=0;const missingCost=[],pendingCost=[];
  for(const [key,qty] of Object.entries(variant?.recipe?.items||{})){
    const ing=doc.ingredients?.[key],rawUnit=n(ing?.unitCost),unit=operationalUnitCost(ing,key),status=String(ing?.costStatus||(rawUnit>0?'CONFIRMED':'MISSING')).toUpperCase();
    if(unit>0)cost+=n(qty)*unit;
    if(n(qty)>0&&(rawUnit<=0||status==='MISSING'))missingCost.push(key);
    else if(n(qty)>0&&status==='PROVISIONAL')pendingCost.push(key);
  }
  return {cost,missingCost,pendingCost,costStatus:missingCost.length?'MISSING':pendingCost.length?'PROVISIONAL':'CONFIRMED'};
}
function ensureRequestStore(doc){
  if(!doc.posRequestKeys||typeof doc.posRequestKeys!=='object'||Array.isArray(doc.posRequestKeys))doc.posRequestKeys={};
  return doc.posRequestKeys;
}
function requestHash(context){
  const omitted=new Set(['requestKey','serverDate','paymentVerified','paymentProviderAmount']);
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).filter(k=>!omitted.has(k)).sort().map(k=>[k,canonical(value[k])])):value;
  return createHash('sha256').update(JSON.stringify(canonical(context))).digest('hex');
}
function rememberStatement(doc,key,response,context,at=Date.now()){
  const stored={...response};delete stored.orders;
  const hash=requestHash(context),store=ensureRequestStore(doc);
  store[key]={at,response:stored,requestHash:hash};
  const keys=Object.keys(store).sort((a,b)=>n(store[a]?.at)-n(store[b]?.at));
  while(keys.length>100){delete store[keys.shift()]}
  return {sql:'INSERT INTO field_pos_requests(request_key,response,created_at,request_hash) VALUES(?,?,?,?)',args:[key,JSON.stringify(stored),at,hash]};
}
async function remember(db,doc,key,response,context){return db.execute(rememberStatement(doc,key,response,context))}
function replayFromRow(doc,row,key,context){
  if(!key)return null;
  const cached=ensureRequestStore(doc)[key];
  if(row&&context&&row.request_hash!==requestHash(context))throw bad('request_key_conflict',409);
  if(!row&&cached?.requestHash&&context&&cached.requestHash!==requestHash(context))throw bad('request_key_conflict',409);
  const response=row?JSON.parse(row.response):cached?.response||null;
  return response?.action&&response?.orderId?{...response,orders:queueOrdersView(doc)}:response;
}
async function replay(db,doc,key,context){
  if(!key)return null;
  const row=(await db.execute({sql:'SELECT response,request_hash FROM field_pos_requests WHERE request_key=?',args:[key]})).rows[0];
  return replayFromRow(doc,row,key,context);
}
export async function getPosRequestReplay({db,requestKey,user,body}){
  if(typeof requestKey!=='string'||requestKey.length<8||requestKey.length>120)return null;
  const row=(await db.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0];
  if(!row)return null;
  const response=await replay(db,readStateRow(row),requestKey,user&&body?{operation:'checkoutPos',userId:user.id,body}:undefined);
  return response?{...response,revision:n(row.revision),replayed:true}:null;
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
  for(const cached of Object.values(doc.posRequestKeys||{}))if(cached?.response)delete cached.response.orders;
  return doc;
}

function reverseCustomerSaleEffects(doc,sale,now){
  if(!sale?.customerId||sale.customerEffectsReversed===true)return false;
  const customer=(doc.customers||[]).find(x=>x.id===sale.customerId);
  if(customer){
    reverseLoyaltyFromCustomer(customer,sale);
    const latest=(doc.sales||[])
      .filter(x=>x.id!==sale.id&&x.customerId===sale.customerId&&String(x.status||'paid')==='paid')
      .sort((a,b)=>n(b.time)-n(a.time))[0];
    customer.lastVisit=n(latest?.time);
  }
  sale.customerEffectsReversed=true;
  sale.customerEffectsReversedAt=now;
  return true;
}
function stateSaveStatements(row,doc,actorId,action,details,now){
  prunePaymentSessions(doc);
  const revision=n(row.revision)+1;
  return {revision,statements:[
    {sql:'UPDATE field_state SET revision=?,document=?,updated_at=? WHERE singleton=1',args:[revision,JSON.stringify(doc),now]},
    {sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[actorId,action,JSON.stringify(details||{}),now]}
  ]};
}
async function saveState(tx,row,doc,actorId,action,details,now){
  const prepared=stateSaveStatements(row,doc,actorId,action,details,now);
  await txBatch(tx,prepared.statements);
  return prepared.revision;
}
function activeOrders(doc){return doc.orders.filter(o=>!['returned','void','refunded','cancelled'].includes(String(o.status||'')))}
function waitingPickup(order){return (order.items||[]).length>0&&(order.items||[]).every(x=>n(x.calledQty)>=n(x.qty))}
function buildQueueLookup(doc){
  const structure=getMenuStructure(doc);
  return {
    menuById:new Map((doc.menu||[]).map(m=>[m.id,m])),
    saleById:new Map((doc.sales||[]).map(s=>[s.id,s])),
    prepBaseById:new Map(structure.prepBases.map((base,rank)=>[base.id,{...base,rank}]))
  };
}
function saleTimeItemPrice(doc,order,item,lookup){
  if(item?.price!==undefined&&item?.price!==null&&Number.isFinite(Number(item.price)))return Number(item.price);
  const saleIds=(Array.isArray(item?.saleIds)&&item.saleIds.length?item.saleIds:(order?.saleIds||[order?.saleId])).filter(Boolean);
  const prices=[];
  for(const saleId of saleIds){
    const sale=lookup?.saleById?.get(saleId)||(doc.sales||[]).find(s=>s.id===saleId);
    for(const sold of sale?.items||[]){
      if(sold.id===item.id&&String(sold.variant||'')===String(item.variant||'')&&Number.isFinite(Number(sold.price)))prices.push(Number(sold.price));
    }
  }
  const unique=[...new Set(prices.map(v=>v.toFixed(6)))];
  return unique.length===1?Number(unique[0]):null;
}
function saleTimeItemRecipe(doc,order,item,lookup){
  if(item?.recipe?.items&&Object.keys(item.recipe.items).length)return clone(item.recipe);
  const saleIds=(Array.isArray(item?.saleIds)&&item.saleIds.length?item.saleIds:(order?.saleIds||[order?.saleId])).filter(Boolean);
  for(const saleId of saleIds){
    const sale=lookup?.saleById?.get(saleId)||(doc.sales||[]).find(s=>s.id===saleId);
    const sold=(sale?.items||[]).find(x=>x.id===item.id&&String(x.variant||'')===String(item.variant||'')&&x.recipe?.items);
    if(sold)return clone(sold.recipe);
  }
  return null;
}
const PREP_FAMILIES=[
  {id:'MATCHA',label:'MATCHA BASE',rank:10,re:/matcha|มัทฉะ/i,batchMode:'SEQUENTIAL'},
  {id:'COFFEE',label:'COFFEE BASE',rank:20,re:/espresso|coffee|กาแฟ|เมล็ดกาแฟ/i,batchMode:'SEQUENTIAL'},
  {id:'THAI_TEA',label:'THAI TEA BASE',rank:30,re:/thai\s*tea|ชาไทย|ชาดำ|รินชา/i,batchMode:'SEQUENTIAL'},
  {id:'GREEN_TEA',label:'GREEN TEA BASE',rank:40,re:/green\s*tea|ชาเขียว/i,batchMode:'SEQUENTIAL'},
  {id:'COCOA',label:'COCOA BASE',rank:50,re:/cocoa|chocolate|โกโก้|ช็อกโกแลต/i,batchMode:'SEQUENTIAL'},
  {id:'FRUIT',label:'FRUIT BASE',rank:60,re:/orange|strawberry|coconut|ส้ม|สตรอ|มะพร้าว/i,batchMode:'NONE'},
  {id:'SODA',label:'SODA',rank:70,re:/soda|โซดา/i,batchMode:'NONE'}
];
function prepFamily(doc,item,recipe,lookup){
  const menu=lookup?.menuById?.get(item.id)||(doc.menu||[]).find(m=>m.id===item.id);
  if(menu?.prepBaseId){
    const configured=lookup?.prepBaseById?.get(menu.prepBaseId)||prepBaseState(doc,menu.prepBaseId);
    if(configured){
      if(!configured.enabled)return {id:'OTHER',label:'OTHER PREP',rank:90,re:null,ingredientIds:[],batchMode:'NONE'};
      const fallback=PREP_FAMILIES.find(x=>x.id===configured.id);
      return {id:configured.id,label:configured.label,rank:configured.rank,re:fallback?.re||null,ingredientIds:configured.ingredientIds||[],batchMode:configured.batchMode||fallback?.batchMode||'SEQUENTIAL'};
    }
  }
  const ingredientText=Object.keys(recipe?.items||{}).map(id=>id+' '+String(doc.ingredients?.[id]?.name||'')).join(' ');
  const text=[menu?.category,menu?.name,item.name,item.id,ingredientText].filter(Boolean).join(' ');
  const found=PREP_FAMILIES.find(x=>x.re.test(text));
  if(found)return {...found,ingredientIds:[]};
  const category=String(menu?.category||'OTHER').trim().toUpperCase().replace(/\s+/g,'_')||'OTHER';
  return {id:category,label:category==='OTHER'?'OTHER PREP':category.replaceAll('_',' ')+' BASE',rank:90,re:null,ingredientIds:[],batchMode:'NONE'};
}
function queueRecipeSignature(recipe){return JSON.stringify(Object.entries(recipe?.items||{}).sort(([a],[b])=>a.localeCompare(b)))}
function prepBaseEntries(doc,family,recipe){
  const configuredIds=Array.isArray(family.ingredientIds)?family.ingredientIds:[];
  return Object.entries(recipe?.items||{}).filter(([ingredientId,perCup])=>{
    if(!(n(perCup)>0))return false;
    const ingredient=doc.ingredients?.[ingredientId],text=ingredientId+' '+String(ingredient?.name||'');
    if(configuredIds.length)return configuredIds.includes(ingredientId);
    return !!family.re&&family.re.test(text);
  }).map(([ingredientId,perCup])=>[ingredientId,n(perCup)]).sort(([a],[b])=>a.localeCompare(b));
}
function prepCompatibilityKey(doc,family,recipe){
  const base=prepBaseEntries(doc,family,recipe);
  const signature=base.length?JSON.stringify(base):queueRecipeSignature(recipe);
  return family.id+'|'+signature;
}
function normalizeQueueItems(doc,order,lookup){
  const merged=[],byKey=new Map();
  for(const raw of order?.items||[]){
    const recipe=saleTimeItemRecipe(doc,order,raw,lookup),price=saleTimeItemPrice(doc,order,raw,lookup);
    const recipeVersion=n(raw.recipeVersion)||null;
    const key=[raw.id,String(raw.variant||''),price===null?'?':Number(price).toFixed(6),recipeVersion||'',queueRecipeSignature(recipe)].join('|');
    const current=byKey.get(key);
    const saleIds=(raw.saleIds||[]).filter(Boolean);
    if(current){
      current.qty=n(current.qty)+n(raw.qty);
      current.readyQty=n(current.readyQty)+n(raw.readyQty);
      current.calledQty=n(current.calledQty)+n(raw.calledQty);
      current.prepSelected=!!current.prepSelected||!!raw.prepSelected;
      current.saleIds=[...new Set([...(current.saleIds||[]),...saleIds])];
      current.addedAt=Math.min(n(current.addedAt)||Number.MAX_SAFE_INTEGER,n(raw.addedAt)||Number.MAX_SAFE_INTEGER);
    }else{
      const next={...raw,price,recipe,recipeVersion,qty:n(raw.qty),readyQty:n(raw.readyQty),calledQty:n(raw.calledQty),prepSelected:!!raw.prepSelected,saleIds:[...new Set(saleIds)]};
      merged.push(next);byKey.set(key,next);
    }
  }
  return merged.map((item,index)=>{const family=prepFamily(doc,item,item.recipe,lookup);return {item,index,family,compatibilityKey:prepCompatibilityKey(doc,family,item.recipe)}})
    .sort((a,b)=>a.family.rank-b.family.rank||a.compatibilityKey.localeCompare(b.compatibilityKey)||a.index-b.index)
    .map(x=>x.item);
}
function recipeUsageView(doc,recipe){
  return Object.entries(recipe?.items||{}).filter(([,qty])=>n(qty)>0).map(([ingredientId,perCup])=>{
    const ingredient=doc.ingredients?.[ingredientId];
    return {id:ingredientId,name:String(ingredient?.name||ingredientId),perCup:n(perCup),unit:String(ingredient?.unit||'g')};
  });
}
function prepGroupsView(doc,items,lookup){
  const groups=new Map();
  for(const item of items||[]){
    const total=n(item.qty),pending=Math.max(0,total-n(item.readyQty));if(!total)continue;
    const family=prepFamily(doc,item,item.recipe,lookup),compatibilityKey=prepCompatibilityKey(doc,family,item.recipe);
    let group=groups.get(family.id);
    if(!group){
      group={id:family.id,label:family.label,rank:family.rank,batchMode:family.batchMode||'NONE',qty:0,pendingQty:0,items:[],baseUsage:{},compatibilityKeys:new Set()};
      groups.set(family.id,group);
    }
    group.compatibilityKeys.add(compatibilityKey);
    group.qty+=total;group.pendingQty+=pending;
    const menuBaseUsage=[];
    for(const [ingredientId,perCup] of prepBaseEntries(doc,family,item.recipe)){
      const ingredient=doc.ingredients?.[ingredientId],name=String(ingredient?.name||ingredientId),unit=String(ingredient?.unit||'g');
      menuBaseUsage.push({id:ingredientId,name,perCup:n(perCup),qty:n(perCup)*total,pendingQty:n(perCup)*pending,unit});
      const row=group.baseUsage[ingredientId]||(group.baseUsage[ingredientId]={id:ingredientId,name,qty:0,pendingQty:0,unit});
      row.qty+=n(perCup)*total;row.pendingQty+=n(perCup)*pending;
    }
    group.items.push({id:item.id,name:item.name,variant:item.variant,qty:total,pendingQty:pending,compatibilityKey,baseUsage:menuBaseUsage,recipeUsage:recipeUsageView(doc,item.recipe)});
  }
  return [...groups.values()].sort((a,b)=>a.rank-b.rank).map(g=>({
    id:g.id,label:g.label,batchMode:g.batchMode,qty:g.qty,pendingQty:g.pendingQty,items:g.items,
    compatibilityKeys:[...g.compatibilityKeys],baseUsage:Object.values(g.baseUsage)
  }));
}
function queueOrdersView(doc){const lookup=buildQueueLookup(doc);return activeOrders(doc).map(o=>{const items=normalizeQueueItems(doc,o,lookup);return {id:o.id,queueNo:o.queueNo,pagerNo:o.pagerNo,status:o.status,time:o.time,total:o.total,billNo:o.billNo||null,saleId:o.saleId||null,saleIds:(o.saleIds||[o.saleId]).filter(Boolean),items:items.map(x=>{const family=prepFamily(doc,x,x.recipe,lookup);return {id:x.id,name:x.name,variant:x.variant,qty:x.qty,price:x.price,readyQty:x.readyQty,calledQty:x.calledQty,prepSelected:!!x.prepSelected,wasteCount:n(x.wasteCount),prepGroup:{id:family.id,label:family.label,batchMode:family.batchMode||'NONE',compatibilityKey:prepCompatibilityKey(doc,family,x.recipe)},saleIds:x.saleIds||[]}}),prepGroups:prepGroupsView(doc,items,lookup)}})}
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
    const qty=Number(x?.qty);
    if(!x?.id||!x?.variant||!Number.isInteger(qty)||qty<1||qty>50)throw bad('invalid_cart');
    return {id:String(x.id),variant:String(x.variant),qty};
  });
}
function deductStock(doc,prepared,{allowNegative=false}={}){
  const need={},shortages=[];
  for(const p of prepared){
    for(const [key,qty] of Object.entries(p.variant?.recipe?.items||{}))need[key]=n(need[key])+n(qty)*p.qty;
  }
  for(const [key,qty] of Object.entries(need)){
    const ing=doc.ingredients?.[key];
    if(!ing)throw bad('ingredient_missing',409);
    if(!Number.isFinite(Number(ing.qty)))throw bad('stock_invalid:'+key,409);
    if(n(ing.qty)<qty){
      if(!allowNegative)throw bad('stock_shortage:'+key,409);
      shortages.push({ingredientId:key,available:n(ing.qty),required:n(qty),deficit:n(qty)-n(ing.qty)});
    }
  }
  for(const [key,qty] of Object.entries(need))doc.ingredients[key].qty=n(doc.ingredients[key].qty)-qty;
  return shortages;
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
    id:s.id,status:s.status,total:n(s.total),subtotal:n(s.subtotal??s.total),discountTotal:n(s.discountTotal),pointsRedeemed:n(s.pointsRedeemed),pointsAwarded:n(s.pointsAwarded),pager:n(s.pager),date:s.date,
    remainingQty:(s.remainingQty||[]).map(n),
    items:(s.items||[]).map(x=>({id:x.id,name:x.name,variant:x.variant,qty:n(x.qty),price:n(x.price)})),
    payments:(s.payments||[]).map(p=>({
      id:p.id,label:p.label,method:p.method,amount:n(p.amount),received:n(p.received),change:n(p.change),
      allocations:clone(p.allocations)
    })),
    remainingAmount:s.mode==='promptpay_full'?((s.remainingQty||[]).some(q=>n(q)>0)?n(s.total):0):(s.items||[]).reduce((sum,item,i)=>sum+n(item.price)*n(s.remainingQty?.[i]),0),
    expiresAt:n(s.expiresAt),
    completedAt:n(s.completedAt)||null,
    orderId:s.orderId||null,
    queueNo:s.queueNo||null,
    targetOrderId:s.targetOrderId||null,
    paymentGroupId:s.paymentGroupId||null,
    providerCharge:s.providerCharge?{
      chargeId:String(s.providerCharge.chargeId||""),
      provider:String(s.providerCharge.provider||""),
      amount:n(s.providerCharge.amount),
      currency:String(s.providerCharge.currency||""),
      status:String(s.providerCharge.status||""),
      expiresAt:s.providerCharge.expiresAt||null,
      referenceId:String(s.providerCharge.referenceId||s.id||"")
    }:null
  };
}
function validateSplitAllocations(session,allocations){
  if(!Array.isArray(allocations)||!allocations.length)throw bad('invalid_payment_allocations');
  let amount=0;
  const normalized=[],seen=new Set();
  for(const a of allocations){
    const index=Number(a?.index),qty=Number(a?.qty);
    if(!Number.isInteger(index)||!Number.isInteger(qty)||index<0||index>=session.items.length||qty<1)throw bad('invalid_payment_allocation');
    if(seen.has(index))throw bad('duplicate_payment_allocation');
    seen.add(index);
    if(qty>n(session.remainingQty[index]))throw bad('payment_allocation_exceeds_item',409);
    amount+=n(session.items[index].price)*qty;
    normalized.push({index,qty});
  }
  return {amount,allocations:normalized};
}
function normalizeSplitPayment(body,session){
  const checked=validateSplitAllocations(session,body.allocations);
  let amount=checked.amount;const allocations=checked.allocations;
  if(session.mode==='promptpay_full'){
    if((session.payments||[]).length)throw bad('promptpay_full_already_paid',409);
    const full=allocations.length===session.items.length&&allocations.every(a=>a.qty===n(session.remainingQty[a.index]));
    if(!full)throw bad('promptpay_full_requires_full_allocation',409);
    amount=n(session.total);
  }
  const method=String(body.method||'');
  if(!['cash','promptpay','bank','card','other'].includes(method))throw bad('invalid_payment');
  const received=method==='cash'?n(body.received):amount;
  if(method==='cash'&&(!Number.isFinite(Number(body.received))||received<amount))throw bad('cash_insufficient',409);
  if(method==='promptpay'&&!body.paymentVerified)throw bad('promptpay_not_verified',409);
  if(method==='promptpay'&&(!Number.isFinite(Number(body.paymentProviderAmount))||Math.abs(Number(body.paymentProviderAmount)-amount)>0.001))throw bad('promptpay_amount_mismatch',409);
  return {
    id:'pay-'+randomUUID(),
    label:String(body.label||('คนที่ '+((session.payments?.length||0)+1))).slice(0,60),
    method,amount,received,
    change:method==='cash'?Math.max(0,received-amount):0,
    allocations,
    paymentReference:['promptpay','bank','card'].includes(method)?(body.paymentReference||null):null,
    paymentVerified:method==='promptpay'?(body.paymentVerified||'manual'):['bank','card'].includes(method)?'manual':true,
    paidAt:Date.now()
  };
}
function claimPromptPayCharge(doc,payment){
  if(payment.method!=='promptpay'||!payment.paymentReference)return;
  const id=String(payment.paymentReference);
  const existing=[...(doc.sales||[]),...(doc.paymentSessions||[])];
  if(Object.prototype.hasOwnProperty.call(doc.promptpayChargeClaims||{},id)||existing.some(record=>
    (record.payments||[record]).some(p=>String(p.method||p.payment)==='promptpay'&&String(p.paymentReference||'')===id)
  ))throw bad('promptpay_charge_already_used',409);
  // Retain the claim independently of sale/session pruning and trial-sales resets.
  doc.promptpayChargeClaims={...(doc.promptpayChargeClaims||{}),[id]:true};
}
function normalizePayments(body,items,paymentTotal){
  const grossTotal=items.reduce((s,x)=>s+x.price*x.qty,0);
  const total=paymentTotal===undefined?grossTotal:n(paymentTotal);
  if(body.payments!==undefined)throw bad('multi_payment_requires_split_session',409);
  {
    const method=String(body.payment||'cash');
    if(!['cash','promptpay','bank','card','other'].includes(method))throw bad('invalid_payment');
    const received=method==='cash'?n(body.received):total;
    if(method==='cash'&&(!Number.isFinite(Number(body.received))||received<total))throw bad('cash_insufficient',409);
    if(method==='promptpay'&&!body.paymentVerified)throw bad('promptpay_not_verified',409);
    if(method==='promptpay'&&(!Number.isFinite(Number(body.paymentProviderAmount))||Math.abs(Number(body.paymentProviderAmount)-total)>0.001))throw bad('promptpay_amount_mismatch',409);
    return [{
      method,amount:total,received,change:method==='cash'?Math.max(0,received-total):0,
      paymentReference:['promptpay','bank','card'].includes(method)?(body.paymentReference||null):null,
      paymentVerified:method==='promptpay'?(body.paymentVerified||'manual'):['bank','card'].includes(method)?'manual':true,
      allocations:items.map((x,index)=>({index,qty:x.qty}))
    }];
  }
}

function saleAccountingStatements({sale,orderId,doc,now}){
  const statements=[];
  for(const [itemIndex,item] of (sale.items||[]).entries()){
    for(const [ingredientId,qtyPerUnit] of Object.entries(item.recipe?.items||{})){
      const qty=n(qtyPerUnit)*n(item.qty);
      if(qty<=0)continue;
      statements.push({sql:'INSERT INTO field_stock_transactions(id,ingredient_id,tx_type,qty_delta,unit,reference_type,reference_id,request_key,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',args:[
        'stx_'+randomUUID(),ingredientId,'SALE',-qty,String(doc.ingredients?.[ingredientId]?.unit||'g'),'sale',sale.id,'sale:'+sale.id+':'+itemIndex+':'+ingredientId,'POS recipe deduction',sale.createdBy,now
      ]});
    }
    statements.push({sql:'INSERT INTO field_cost_snapshots(id,sale_id,order_id,order_item_id,menu_id,recipe_version,standard_cost,document,created_at) VALUES(?,?,?,?,?,?,?,?,?)',args:[
      'cost_'+randomUUID(),sale.id,orderId||null,null,item.id,item.recipeVersion||null,n(item.unitCost),JSON.stringify({
        menuId:item.id,name:item.name,variant:item.variant,qty:n(item.qty),unitCost:n(item.unitCost),
        lineCost:n(item.unitCost)*n(item.qty),costStatus:item.costStatus,missingCost:clone(item.missingCost),pendingCost:clone(item.pendingCost),recipe:clone(item.recipe)
      }),now
    ]});
  }
  return statements;
}
async function writeSaleAccounting(tx,ctx){return txBatch(tx,saleAccountingStatements(ctx))}

function buildItems(doc,cart){
  return cart.map(x=>{
    const {menu,variant}=findVariant(doc,x);
    const costing=costInfo(doc,variant);
    return {
      id:menu.id,
      name:menu.name,
      variant:variant.label,
      qty:x.qty,
      price:n(menu.price),
      unitCost:costing.cost,
      costStatus:costing.costStatus,
      missingCost:costing.missingCost,
      pendingCost:costing.pendingCost,
      recipeVersion:n(variant.recipeVersion)||null,
      recipe:clone(variant.recipe)
    };
  });
}

export async function checkoutPos({db,user,body,now=Date.now()}){
  validateRequestKey(body.requestKey);
  const context={operation:'checkoutPos',userId:user.id,body};
  const tx=await beginWriteTransaction(db);
  try{
    const reads=await txBatch(tx,[
      {sql:'SELECT revision,document FROM field_state WHERE singleton=1',args:[]},
      {sql:'SELECT response,request_hash FROM field_pos_requests WHERE request_key=?',args:[body.requestKey]}
    ]);
    const row=reads[0].rows[0],requestRow=reads[1].rows[0];
    const doc=readStateRow(row);
    cleanupExpiredPaymentSessions(doc,now);
    const old=replayFromRow(doc,requestRow,body.requestKey,context);
    if(old){await tx.rollback();return {...old,revision:n(row.revision),replayed:true}}

    const offlineFulfilled=body.offlineFulfilled===true;
    if(offlineFulfilled){
      const offlineCreatedAt=Number(body.offlineCreatedAt);
      if(String(body.payment||'cash')!=='cash')throw bad('offline_cash_only',409);
      if(body.targetOrderId||String(body.checkoutMode||'full')!=='full')throw bad('offline_split_not_supported',409);
      if(body.customerId||n(body.pointsRedeemed)>0)throw bad('offline_loyalty_not_supported',409);
      if(!Number.isFinite(offlineCreatedAt)||offlineCreatedAt<=0||offlineCreatedAt>now+(5*60*1000)||now-offlineCreatedAt>(36*60*60*1000))throw bad('invalid_offline_timestamp',409);
    }

    const cart=normalizeCart(body),items=buildItems(doc,cart);
    const stockShortages=deductStock(doc,items.map((x,i)=>({...x,variant:findVariant(doc,cart[i]).variant})),{allowNegative:offlineFulfilled});

    const target=body.targetOrderId?activeOrders(doc).find(o=>o.id===body.targetOrderId):null;
    if(body.targetOrderId&&!target)throw bad('target_order_unavailable',409);
    const pager=offlineFulfilled?0:(target?n(target.pagerNo):firstFreePager(doc,now));
    if(pager===null)throw bad('no_pager_available',409);

    const date=String(body.date||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw bad('invalid_date');
    if(body.serverDate&&String(body.serverDate)!==date)throw bad('business_date_changed',409);
    if((doc.closes||[]).some(x=>x.date===date))throw bad('day_closed',409);
    const seq=n(doc.billSeq[date])+1;
    const paymentGroupId=target?.paymentGroupId||'pg-'+randomUUID();
    const grossTotal=items.reduce((s,x)=>s+x.price*x.qty,0);
    const customer=body.customerId?(doc.customers||[]).find(x=>x.id===body.customerId):null;
    let loyalty;try{loyalty=resolveLoyalty({customer,grossTotal,requestedPoints:body.pointsRedeemed,settings:doc.settings||{}})}catch(e){throw bad(e.message,409)}
    const total=loyalty.netTotal;
    let settlement;try{settlement=deliverySettlement({salesChannel:body.salesChannel||'store',total,settings:doc.settings||{}})}catch(e){throw bad(e.message,400)}
    if(settlement.delivery&&String(body.payment||'')!=='other')throw bad('delivery_payment_must_be_platform',409);
    if(settlement.delivery&&String(body.checkoutMode||'full')!=='full')throw bad('delivery_split_not_supported',409);
    if(offlineFulfilled&&settlement.delivery)throw bad('delivery_offline_not_supported',409);
    if(offlineFulfilled&&body.total!==undefined&&Math.abs(n(body.total)-total)>0.001)throw bad('offline_price_changed',409);
    if(String(body.payment||'cash')==='promptpay'&&total<=0)throw bad('promptpay_zero_total',409);
    const payments=normalizePayments(body,items,total);
    for(const payment of payments)claimPromptPayCharge(doc,payment);
    const salePayment=payments.length===1?payments[0].method:'split';
    const saleReceived=payments.reduce((s,p)=>s+n(p.received),0);
    const saleChange=payments.reduce((s,p)=>s+n(p.change),0);
    const sale={
      id:'s-'+randomUUID(),createdBy:user.id,
      billNo:'FIELD-'+date.replaceAll('-','')+'-'+String(seq).padStart(3,'0'),
      time:now,date,items,subtotal:loyalty.subtotal,discountTotal:loyalty.discountTotal,crmDiscount:loyalty.crmDiscount,total,
      pointsRedeemed:loyalty.pointsRedeemed,pointsRedeemValue:loyalty.pointsRedeemValue,pointsAwarded:loyalty.pointsAwarded,
      costTotal:items.reduce((s,x)=>s+x.unitCost*x.qty,0),
      costStatus:items.some(x=>x.costStatus==='MISSING')?'MISSING':items.some(x=>x.costStatus==='PROVISIONAL')?'PROVISIONAL':'CONFIRMED',
      payment:salePayment,received:saleReceived,change:saleChange,status:'paid',
      salesChannel:settlement.salesChannel,deliveryPlatform:settlement.platform,gpRate:settlement.gpRate,gpFee:settlement.gpFee,netSettlement:settlement.netSettlement,
      pagerNo:pager,customerId:body.customerId||null,
      offlineFulfilled,offlineCreatedAt:offlineFulfilled?Number(body.offlineCreatedAt):null,offlineMenuRevision:offlineFulfilled?n(body.offlineMenuRevision):null,
      paymentGroupId,parentOrderId:target?.id||null,
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
    if(customer)applyLoyaltyToCustomer(customer,loyalty,now);
    const sales=[sale];
    doc.billSeq[date]=seq;

    let order;
    if(target){
      const added=items.map(x=>({id:x.id,name:x.name,variant:x.variant,qty:x.qty,price:x.price,recipeVersion:x.recipeVersion||null,recipe:clone(x.recipe),readyQty:0,calledQty:0,addedAt:now,saleIds:[sale.id]}));
      target.items=normalizeQueueItems(doc,{...target,items:[...(target.items||[]),...added]});
      target.saleIds=[...(target.saleIds||[target.saleId]).filter(Boolean),...sales.map(s=>s.id)];
      target.subtotal=n(target.subtotal??target.total)+loyalty.subtotal;target.discountTotal=n(target.discountTotal)+loyalty.discountTotal;target.total=n(target.total)+total;target.lastAddedAt=now;
      if(target.status==='ready')target.status='making';
      if(!target.status||target.status==='assigned')target.status='assigned';
      order=target;
    }else{
      const q=queueLabelFromSeq(seq);
      order={id:'o-'+randomUUID(),createdBy:user.id,saleId:sale.id,saleIds:[sale.id],
        billNo:sale.billNo,queueNo:q,items:normalizeQueueItems(doc,{saleId:sale.id,saleIds:[sale.id],items:items.map(x=>({id:x.id,name:x.name,variant:x.variant,qty:x.qty,price:x.price,recipeVersion:x.recipeVersion||null,recipe:clone(x.recipe),readyQty:offlineFulfilled?x.qty:0,calledQty:offlineFulfilled?x.qty:0,saleIds:[sale.id]}))}),
        subtotal:loyalty.subtotal,discountTotal:loyalty.discountTotal,total,pagerNo:pager,status:offlineFulfilled?'returned':'assigned',time:now,paymentGroupId,
        offlineFulfilled,offlineCreatedAt:offlineFulfilled?Number(body.offlineCreatedAt):null,deliveredAt:offlineFulfilled?now:undefined};
      doc.orders.push(order);
    }
    sales.forEach(s=>s.queueNo=order.queueNo||queueLabelFromSeq(seq));
    doc.sales.push(...sales);
    doc.cart=[];

    const response={ok:true,orderId:order.id,pager,queueNo:order.queueNo||queueLabelFromSeq(seq),saleIds:[sale.id],billNo:sale.billNo,subtotal:sale.subtotal,discountTotal:sale.discountTotal,pointsRedeemed:sale.pointsRedeemed,pointsAwarded:sale.pointsAwarded,total:sale.total,received:sale.received,change:sale.change,salesChannel:sale.salesChannel,gpRate:sale.gpRate,gpFee:sale.gpFee,netSettlement:sale.netSettlement,offlineFulfilled,stockReconciliationRequired:stockShortages.length>0,stockShortages};
    const writes=sales.flatMap(s=>saleAccountingStatements({sale:s,orderId:order.id,doc,now}));
    writes.push(rememberStatement(doc,body.requestKey,response,context,now));
    const stateWrite=stateSaveStatements(row,doc,user.id,offlineFulfilled?'pos_checkout_offline_sync':'pos_checkout',{orderId:order.id,saleIds:response.saleIds,pager,offlineFulfilled,stockShortages},now);
    writes.push(...stateWrite.statements);
    await txBatch(tx,writes);
    const revision=stateWrite.revision;
    await tx.commit();
    return {...response,revision,replayed:false};
  }catch(e){await tx.rollback().catch(()=>{});throw e}
}


export async function voidSale({db,user,body,now=Date.now()}){
  validateRequestKey(body.requestKey);
  const saleId=String(body.saleId||'').trim(),reason=String(body.reason||'').trim().slice(0,240);
  if(!saleId)throw bad('sale_required');
  const tx=await beginWriteTransaction(db);
  try{
    const row=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0];
    const doc=readStateRow(row),sale=(doc.sales||[]).find(s=>s.id===saleId);
    if(!sale)throw bad('sale_not_found',404);
    if(sale.status==='void'){
      if(sale.voidRequestKey===body.requestKey){
        await tx.rollback();
        const saleIds=Array.isArray(sale.voidGroupSaleIds)&&sale.voidGroupSaleIds.length?sale.voidGroupSaleIds:[saleId];
        return {ok:true,replayed:true,saleId,saleIds,orderId:sale.voidOrderId||sale.orderId||null,voidAmount:n(sale.voidGroupAmount??sale.total)};
      }
      throw bad('sale_already_void',409);
    }
    if(sale.status!=='paid')throw bad('sale_not_voidable',409);

    const order=(doc.orders||[]).find(o=>o.saleId===saleId||(o.saleIds||[]).includes(saleId));
    if(!order)throw bad('order_not_found',404);
    const orderSaleIds=[...new Set((order.saleIds||[order.saleId]).filter(Boolean))];
    const orderSales=orderSaleIds.map(id=>(doc.sales||[]).find(s=>s.id===id));
    if(orderSales.some(s=>!s))throw bad('order_sale_missing',409);
    if(orderSales.some(s=>s.status!=='paid'))throw bad('void_order_mixed_status',409);
    if(orderSales.some(s=>(doc.closes||[]).some(x=>x.date===s.date)))throw bad('void_closed_day',409);
    if(orderSales.some(s=>String(s.payment||'')!=='cash'))throw bad('non_cash_void_requires_refund',409);
    if((order.items||[]).some(i=>n(i.readyQty)>0||n(i.calledQty)>0))throw bad('void_after_production_started',409);

    for(const groupSale of orderSales){
      for(const [itemIndex,item] of (groupSale.items||[]).entries()){
        for(const [ingredientId,qtyPerUnit] of Object.entries(item.recipe?.items||{})){
          const qty=n(qtyPerUnit)*n(item.qty);if(qty<=0)continue;
          const ingredient=doc.ingredients?.[ingredientId];if(!ingredient)throw bad('ingredient_missing',409);
          ingredient.qty=n(ingredient.qty)+qty;
          await tx.execute({sql:`INSERT INTO field_stock_transactions(
            id,ingredient_id,tx_type,qty_delta,unit,reference_type,reference_id,request_key,reason,actor_id,created_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,args:[
            'stx_void_'+randomUUID(),ingredientId,'VOID_REVERSAL',qty,ingredient.unit||'g',
            'void',groupSale.id,body.requestKey+':'+groupSale.id+':'+itemIndex+':'+ingredientId,reason||(orderSales.length>1?'Cash order void':'Cash sale void'),user.id,now
          ]});
        }
      }
    }

    const groupSaleIds=orderSales.map(s=>s.id),groupVoidAmount=orderSales.reduce((sum,s)=>sum+n(s.total),0);
    for(const groupSale of orderSales){
      reverseCustomerSaleEffects(doc,groupSale,now);
      groupSale.status='void';groupSale.voidedAt=now;groupSale.voidedBy=user.id;groupSale.voidReason=reason||(orderSales.length>1?'Cash order void':'Cash sale void');groupSale.voidRequestKey=body.requestKey;groupSale.orderId=order.id;
      groupSale.voidGroupSaleIds=groupSaleIds;groupSale.voidGroupAmount=groupVoidAmount;groupSale.voidOrderId=order.id;
    }
    order.status='void';order.voidedAt=now;order.voidedBy=user.id;order.voidRequestKey=body.requestKey;order.voidSaleIds=groupSaleIds;order.voidAmount=groupVoidAmount;
    const revision=await saveState(tx,row,doc,user.id,orderSales.length>1?'order_void':'sale_void',{saleId,saleIds:groupSaleIds,orderId:order.id,amount:groupVoidAmount,reason:reason||(orderSales.length>1?'Cash order void':'Cash sale void')},now);
    await tx.commit();return {ok:true,replayed:false,saleId,saleIds:groupSaleIds,orderId:order.id,voidAmount:groupVoidAmount,revision};
  }catch(e){await tx.rollback().catch(()=>{});throw e}
}

export async function refundSale({db,user,body,now=Date.now()}){
  validateRequestKey(body.requestKey);
  const saleId=String(body.saleId||'').trim(),reason=String(body.reason||'').trim().slice(0,240),manualReference=String(body.manualReference||'').trim().slice(0,120);
  if(!saleId)throw bad('sale_required');
  const tx=await beginWriteTransaction(db);
  try{
    const row=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0];
    const doc=readStateRow(row),sale=(doc.sales||[]).find(s=>s.id===saleId);
    if(!sale)throw bad('sale_not_found',404);
    if(sale.status==='refunded'){
      if(sale.refundRequestKey===body.requestKey){
        await tx.rollback();
        const saleIds=Array.isArray(sale.refundGroupSaleIds)&&sale.refundGroupSaleIds.length?sale.refundGroupSaleIds:[saleId];
        return {ok:true,replayed:true,saleId,saleIds,orderId:sale.refundOrderId||sale.parentOrderId||null,refundAmount:n(sale.refundGroupAmount??sale.refundAmount),refundMethod:sale.refundMethod,stockRestored:!!sale.refundStockRestored};
      }
      throw bad('sale_already_refunded',409);
    }
    if(sale.status!=='paid')throw bad('sale_not_refundable',409);

    const order=(doc.orders||[]).find(o=>o.saleId===saleId||(o.saleIds||[]).includes(saleId));
    if(!order)throw bad('order_not_found',404);
    const orderSaleIds=[...new Set((order.saleIds||[order.saleId]).filter(Boolean))];
    const orderSales=orderSaleIds.map(id=>(doc.sales||[]).find(s=>s.id===id));
    if(orderSales.some(s=>!s))throw bad('order_sale_missing',409);
    const refundableSales=orderSales.filter(s=>s.status==='paid');
    if(!refundableSales.some(s=>s.id===saleId))throw bad('sale_not_refundable',409);
    if(refundableSales.some(s=>(doc.closes||[]).some(x=>x.date===s.date)))throw bad('refund_closed_day',409);

    const paymentInfo=s=>{
      const paymentType=String(s.payment||'');
      const splitMethods=paymentType==='split'?[...new Set((s.payments||[]).map(p=>String(p.method||'')).filter(Boolean))]:[];
      if(!['cash','promptpay','bank','card','split'].includes(paymentType))throw bad('refund_payment_not_supported',409);
      if(paymentType==='split'&&(!splitMethods.length||splitMethods.some(method=>!['cash','promptpay','bank','card'].includes(method))))throw bad('refund_payment_not_supported',409);
      const hasPromptPay=paymentType==='promptpay'||(paymentType==='split'&&splitMethods.includes('promptpay'));
      const hasManualExternal=['promptpay','bank','card'].includes(paymentType)||(paymentType==='split'&&splitMethods.some(method=>['promptpay','bank','card'].includes(method)));
      return {sale:s,paymentType,splitMethods,hasPromptPay,hasManualExternal};
    };
    const infos=refundableSales.map(paymentInfo);
    const multiOrder=orderSaleIds.length>1;
    const productionStarted=order.status==='returned'||(order.items||[]).some(i=>n(i.readyQty)>0||n(i.calledQty)>0);
    if(!multiOrder&&infos.length===1&&infos[0].paymentType==='cash'&&!productionStarted)throw bad('use_void_before_production',409);

    const hasPromptPay=infos.some(x=>x.hasPromptPay),hasManualExternal=infos.some(x=>x.hasManualExternal);
    if(hasManualExternal){
      if(body.manualConfirmed!==true)throw bad(hasPromptPay?'promptpay_manual_refund_required':'external_manual_refund_required',409);
      if(!manualReference)throw bad('manual_refund_reference_required');
    }

    let stockRestored=false;
    if(!productionStarted&&(multiOrder||infos.some(x=>x.paymentType!=='cash'))){
      for(const info of infos){
        for(const [itemIndex,item] of (info.sale.items||[]).entries()){
          for(const [ingredientId,qtyPerUnit] of Object.entries(item.recipe?.items||{})){
            const qty=n(qtyPerUnit)*n(item.qty);if(qty<=0)continue;
            const ingredient=doc.ingredients?.[ingredientId];if(!ingredient)throw bad('ingredient_missing',409);
            ingredient.qty=n(ingredient.qty)+qty;stockRestored=true;
            await tx.execute({sql:`INSERT INTO field_stock_transactions(
              id,ingredient_id,tx_type,qty_delta,unit,reference_type,reference_id,request_key,reason,actor_id,created_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,args:[
              'stx_refund_'+randomUUID(),ingredientId,'REFUND_REVERSAL',qty,ingredient.unit||'g',
              'refund',info.sale.id,body.requestKey+':'+info.sale.id+':'+itemIndex+':'+ingredientId,reason||(multiOrder?'Full order refund before production':'Refund before production'),user.id,now
            ]});
          }
        }
      }
    }

    const groupSaleIds=infos.map(x=>x.sale.id),groupRefundAmount=infos.reduce((sum,x)=>sum+n(x.sale.total),0);
    if(order.status!=='returned')order.status='void';
    order.refundedAt=now;order.refundedBy=user.id;order.refundRequestKey=body.requestKey;order.refundSaleIds=groupSaleIds;order.refundAmount=groupRefundAmount;

    for(const info of infos){
      const s=info.sale;
      s.status='refunded';s.refundedAt=now;s.refundedBy=user.id;s.refundReason=reason||'Full refund';s.refundRequestKey=body.requestKey;
      s.refundMethod=info.paymentType==='cash'?'cash':info.paymentType==='promptpay'?'manual_promptpay':info.paymentType==='bank'?'manual_bank':info.paymentType==='card'?'manual_card':info.hasManualExternal?'split_manual':'split_cash';
      s.refundReference=info.hasManualExternal?manualReference:null;s.refundAmount=n(s.total);s.refundStockRestored=stockRestored;
      s.refundGroupSaleIds=groupSaleIds;s.refundGroupAmount=groupRefundAmount;s.refundOrderId=order.id;
      if(info.paymentType==='split')s.refundPayments=(s.payments||[]).map(p=>({method:String(p.method||''),amount:n(p.amount),paymentReference:p.paymentReference||null}));
      if(!stockRestored&&n(s.costTotal)>0){
        if(!Array.isArray(doc.expenses))doc.expenses=[];
        const expenseId='exp_refund_'+s.id;
        if(!doc.expenses.some(e=>e.id===expenseId)){
          doc.expenses.push({
            id:expenseId,date:String(s.date||''),time:now,category:'WASTE',
            description:'Refund loss '+String(s.billNo||s.id)+(reason?' · '+reason:''),
            amount:n(s.costTotal),paymentMethod:'noncash',sourceType:'STOCK_REFUND_LOSS',
            referenceId:s.id,costStatus:String(s.costStatus||'CONFIRMED'),createdBy:user.id
          });
        }
        s.refundLossExpenseId=expenseId;
        s.refundLossCost=n(s.costTotal);
      }
      reverseCustomerSaleEffects(doc,s,now);
    }

    const refundMethods=[...new Set(infos.map(x=>x.sale.refundMethod))];
    const revision=await saveState(tx,row,doc,user.id,multiOrder?'order_refund':'sale_refund',{
      orderId:order.id,saleId,saleIds:groupSaleIds,amount:groupRefundAmount,methods:refundMethods,reason:reason||'Full refund',
      reference:hasManualExternal?manualReference:null,stockRestored
    },now);
    await tx.commit();
    return {ok:true,replayed:false,saleId,saleIds:groupSaleIds,orderId:order.id,revision,refundAmount:groupRefundAmount,refundMethod:multiOrder?'multi_sale':infos[0].sale.refundMethod,refundMethods,stockRestored};
  }catch(e){await tx.rollback().catch(()=>{});throw e}
}

export async function startSplitPayment({db,user,body,now=Date.now()}){
  validateRequestKey(body.requestKey);
  const context={operation:'startSplitPayment',userId:user.id,body};
  const tx=await beginWriteTransaction(db);
  try{
    const row=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0];
    const doc=readStateRow(row);
    cleanupExpiredPaymentSessions(doc,now);
    const old=await replay(tx,doc,body.requestKey,context);
    if(old){await tx.rollback();return {...old,revision:n(row.revision),replayed:true}}

    const target=body.targetOrderId?activeOrders(doc).find(o=>o.id===body.targetOrderId):null;
    if(body.targetOrderId&&!target)throw bad('target_order_unavailable',409);

    const cart=normalizeCart(body),items=buildItems(doc,cart);
    deductStock(doc,items.map((x,i)=>({...x,variant:findVariant(doc,cart[i]).variant})));

    const pager=target?n(target.pagerNo):firstFreePager(doc,now);
    if(pager===null)throw bad('no_pager_available',409);
    const date=String(body.date||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw bad('invalid_date');
    if(body.serverDate&&String(body.serverDate)!==date)throw bad('business_date_changed',409);
    if((doc.closes||[]).some(x=>x.date===date))throw bad('day_closed',409);

    const promptPayFull=String(body.mode||'')==='promptpay_full';
    if(!promptPayFull&&n(body.pointsRedeemed)>0)throw bad('points_redemption_split_not_supported',409);
    const grossTotal=items.reduce((s,x)=>s+n(x.price)*n(x.qty),0);
    const customer=body.customerId?(doc.customers||[]).find(x=>x.id===body.customerId):null;
    let loyalty;try{loyalty=resolveLoyalty({customer,grossTotal,requestedPoints:body.pointsRedeemed,settings:doc.settings||{}})}catch(e){throw bad(e.message,409)}
    if(promptPayFull&&loyalty.netTotal<=0)throw bad('promptpay_zero_total',409);
    const session={
      id:'split-'+randomUUID(),createdBy:user.id,createdAt:now,updatedAt:now,
      expiresAt:now+(promptPayFull?20*60*1000:4*60*60*1000),status:'collecting',
      mode:promptPayFull?'promptpay_full':'split',
      date,pager,customerId:body.customerId||null,
      targetOrderId:target?.id||null,
      paymentGroupId:target?.paymentGroupId||null,
      items,remainingQty:items.map(x=>x.qty),payments:[],
      subtotal:loyalty.subtotal,discountTotal:loyalty.discountTotal,crmDiscount:loyalty.crmDiscount,
      pointsRedeemed:loyalty.pointsRedeemed,pointsRedeemValue:loyalty.pointsRedeemValue,pointsAwarded:loyalty.pointsAwarded,
      total:loyalty.netTotal
    };
    doc.paymentSessions.push(session);
    const response={ok:true,session:splitSessionView(session)};
    await remember(tx,doc,body.requestKey,response,context);
    const revision=await saveState(tx,row,doc,user.id,'split_payment_start',{sessionId:session.id,pager,total:session.total,targetOrderId:session.targetOrderId||null},now);
    await tx.commit();
    return {...response,revision,state:doc,replayed:false};
  }catch(e){await tx.rollback().catch(()=>{});throw e}
}

export async function paySplitPayment({db,user,body,now=Date.now()}){
  validateRequestKey(body.requestKey);
  const context={operation:'paySplitPayment',userId:user.id,body};
  const tx=await beginWriteTransaction(db);
  try{
    const row=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0];
    const doc=readStateRow(row);
    cleanupExpiredPaymentSessions(doc,now);
    const old=await replay(tx,doc,body.requestKey,context);
    if(old){await tx.rollback();return {...old,revision:n(row.revision),replayed:true}}

    const session=(doc.paymentSessions||[]).find(s=>s.id===body.sessionId);
    if(!session||session.status!=='collecting')throw bad('split_session_unavailable',409);
    if(n(session.expiresAt)<=now)throw bad('split_session_expired',409);
    if((doc.closes||[]).some(x=>x.date===session.date))throw bad('day_closed',409);

    const payment=normalizeSplitPayment(body,session);
    claimPromptPayCharge(doc,payment);
    for(const a of payment.allocations)session.remainingQty[a.index]=n(session.remainingQty[a.index])-a.qty;
    session.payments.push(payment);session.updatedAt=now;

    const remaining=session.remainingQty.reduce((s,q)=>s+n(q),0);
    let completed=false,order=null,sale=null;

    if(remaining===0){
      const date=session.date;
      const seq=n(doc.billSeq[date])+1;
      const target=session.targetOrderId?activeOrders(doc).find(o=>o.id===session.targetOrderId):null;
      if(session.targetOrderId&&!target)throw bad('target_order_unavailable',409);
      const paymentGroupId=target?.paymentGroupId||session.paymentGroupId||'pg-'+randomUUID();
      const payments=session.payments;
      const total=n(session.total);
      sale={
        id:'s-'+randomUUID(),createdBy:user.id,
        billNo:'FIELD-'+date.replaceAll('-','')+'-'+String(seq).padStart(3,'0'),
        time:now,date,items:session.items,subtotal:n(session.subtotal??session.total),discountTotal:n(session.discountTotal),crmDiscount:n(session.crmDiscount),total,
        pointsRedeemed:n(session.pointsRedeemed),pointsRedeemValue:n(session.pointsRedeemValue),pointsAwarded:n(session.pointsAwarded),
        costTotal:session.items.reduce((s,x)=>s+n(x.unitCost)*n(x.qty),0),
        costStatus:session.items.some(x=>x.costStatus==='MISSING')?'MISSING':session.items.some(x=>x.costStatus==='PROVISIONAL')?'PROVISIONAL':'CONFIRMED',
        payment:payments.length===1?payments[0].method:'split',
        received:payments.reduce((s,p)=>s+n(p.received),0),
        change:payments.reduce((s,p)=>s+n(p.change),0),
        status:'paid',pagerNo:session.pager,customerId:session.customerId||null,
        paymentGroupId,parentOrderId:target?.id||null,
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
      const saleCustomer=session.customerId?(doc.customers||[]).find(x=>x.id===session.customerId):null;
      if(saleCustomer)applyLoyaltyToCustomer(saleCustomer,{pointsRedeemed:sale.pointsRedeemed,pointsAwarded:sale.pointsAwarded,netTotal:sale.total},now);

      if(target){
        const added=session.items.map(x=>({id:x.id,name:x.name,variant:x.variant,qty:x.qty,price:x.price,readyQty:0,calledQty:0,addedAt:now,saleIds:[sale.id]}));
        target.items=[...(target.items||[]),...added];
        target.saleIds=[...(target.saleIds||[target.saleId]).filter(Boolean),sale.id];
        target.subtotal=n(target.subtotal??target.total)+n(session.subtotal??session.total);target.discountTotal=n(target.discountTotal)+n(session.discountTotal);target.total=n(target.total)+total;target.lastAddedAt=now;
        if(target.status==='ready')target.status='making';
        if(!target.status||target.status==='assigned')target.status='assigned';
        order=target;
      }else{
        const q=queueLabelFromSeq(seq);
        order={id:'o-'+randomUUID(),createdBy:user.id,saleId:sale.id,saleIds:[sale.id],
          billNo:sale.billNo,queueNo:q,
          items:session.items.map(x=>({id:x.id,name:x.name,variant:x.variant,qty:x.qty,price:x.price,readyQty:0,calledQty:0})),
          subtotal:n(session.subtotal??session.total),discountTotal:n(session.discountTotal),total,pagerNo:session.pager,status:'assigned',time:now,paymentGroupId};
        doc.orders.push(order);
      }
      sale.queueNo=order.queueNo||queueLabelFromSeq(seq);
      doc.billSeq[date]=seq;
      doc.sales.push(sale);
      await writeSaleAccounting(tx,{sale,orderId:order.id,doc,now});
      session.status='completed';session.completedAt=now;session.orderId=order.id;session.saleId=sale.id;session.queueNo=sale.queueNo;session.paymentGroupId=paymentGroupId;
      completed=true;
    }

    const response={
      ok:true,completed,
      session:splitSessionView(session),
      orderId:order?.id||null,pager:session.pager,queueNo:order?.queueNo||null,saleId:sale?.id||null
    };
    await remember(tx,doc,body.requestKey,response,context);
    const revision=await saveState(tx,row,doc,user.id,completed?'split_payment_complete':'split_payment_part',
      {sessionId:session.id,paymentId:payment.id,amount:payment.amount,completed},now);
    await tx.commit();
    return {...response,revision,state:doc,replayed:false};
  }catch(e){await tx.rollback().catch(()=>{});throw e}
}

export async function listSplitPaymentSessions({db,now=Date.now()}){
  const tx=await beginWriteTransaction(db);
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

export async function getSplitPaymentProviderContext({db,sessionId}){
  const row=(await db.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0];
  const doc=readStateRow(row);
  const session=(doc.paymentSessions||[]).find(s=>s.id===sessionId);
  if(!session)throw bad('split_session_not_found',404);
  return {
    id:session.id,
    status:session.status,
    mode:session.mode||'split',
    createdBy:session.createdBy,
    total:n(session.total),
    pager:n(session.pager),
    queueNo:session.queueNo||null,
    orderId:session.orderId||null,
    remainingQty:(session.remainingQty||[]).map(n),
    allocations:(session.remainingQty||[]).map((qty,index)=>({index,qty:n(qty)})).filter(x=>x.qty>0),
    providerCharge:session.providerCharge?clone(session.providerCharge):null
  };
}

export async function attachSplitPaymentProviderCharge({db,user,body,now=Date.now()}){
  const sessionId=String(body.sessionId||''),chargeId=String(body.chargeId||'');
  if(!sessionId||!chargeId)throw bad('invalid_payment_reference');
  const tx=await beginWriteTransaction(db);
  try{
    const row=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0];
    const doc=readStateRow(row);
    const session=(doc.paymentSessions||[]).find(s=>s.id===sessionId);
    if(!session)throw bad('split_session_not_found',404);
    if(session.status!=='collecting')throw bad('split_session_unavailable',409);
    if(session.mode!=='promptpay_full')throw bad('promptpay_session_required',409);
    if(session.providerCharge?.chargeId){
      if(String(session.providerCharge.chargeId)!==chargeId)throw bad('promptpay_charge_already_attached',409);
      await tx.rollback();
      return {ok:true,revision:n(row.revision),session:splitSessionView(session),replayed:true};
    }
    const amount=n(body.amount),expected=n(session.total);
    if(!Number.isFinite(amount)||Math.abs(amount-expected)>0.009)throw bad('promptpay_amount_mismatch',409);
    const referenceId=String(body.referenceId||session.id);
    if(referenceId!==session.id)throw bad('promptpay_reference_mismatch',409);
    session.providerCharge={
      chargeId,
      provider:String(body.provider||''),
      amount:expected,
      currency:String(body.currency||'THB').toUpperCase(),
      status:String(body.status||'pending').toLowerCase(),
      expiresAt:body.expiresAt||null,
      referenceId:session.id,
      attachedAt:now,
      updatedAt:now
    };
    session.updatedAt=now;
    const revision=await saveState(tx,row,doc,user.id,'promptpay_charge_attach',{sessionId,chargeId,provider:session.providerCharge.provider,amount:expected},now);
    await tx.commit();
    return {ok:true,revision,session:splitSessionView(session),replayed:false};
  }catch(e){await tx.rollback().catch(()=>{});throw e}
}

export async function cancelSplitPayment({db,user,body,now=Date.now()}){
  validateRequestKey(body.requestKey);
  const context={operation:'cancelSplitPayment',userId:user.id,body};
  const tx=await beginWriteTransaction(db);
  try{
    const row=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0];
    const doc=readStateRow(row);
    const old=await replay(tx,doc,body.requestKey,context);
    if(old){await tx.rollback();return {...old,revision:n(row.revision),replayed:true}}
    const session=(doc.paymentSessions||[]).find(s=>s.id===body.sessionId);
    if(!session||session.status!=='collecting')throw bad('split_session_unavailable',409);
    if((session.payments||[]).length)throw bad('split_session_has_payments',409);
    restoreStock(doc,session.items);
    session.status='cancelled';session.cancelledAt=now;
    const response={ok:true,session:splitSessionView(session)};
    await remember(tx,doc,body.requestKey,response,context);
    const revision=await saveState(tx,row,doc,user.id,'split_payment_cancel',{sessionId:session.id},now);
    await tx.commit();
    return {...response,revision,state:doc,replayed:false};
  }catch(e){await tx.rollback().catch(()=>{});throw e}
}

export async function resolveSplitPayment({db,user,body,now=Date.now()}){
  validateRequestKey(body.requestKey);
  const context={operation:'resolveSplitPayment',userId:user.id,body};
  const tx=await beginWriteTransaction(db);
  try{
    const row=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=readStateRow(row);
    const old=await replay(tx,doc,body.requestKey,context);if(old){await tx.rollback();return {...old,revision:n(row.revision),replayed:true}}
    const session=(doc.paymentSessions||[]).find(s=>s.id===body.sessionId);
    if(!session||session.status!=='requires_resolution')throw bad('split_resolution_unavailable',409);
    session.status='collecting';session.expiresAt=now+(4*60*60*1000);session.resolvedAt=now;session.resolvedBy=user.id;session.updatedAt=now;
    const response={ok:true,session:splitSessionView(session)};await remember(tx,doc,body.requestKey,response,context);
    const revision=await saveState(tx,row,doc,user.id,'split_payment_resolution',{sessionId:session.id,action:'RESUME',payments:(session.payments||[]).length},now);
    await tx.commit();return {...response,revision,replayed:false};
  }catch(e){await tx.rollback().catch(()=>{});throw e}
}

export async function getQueueSnapshot({db,sinceRevision}){
  const requested=Number(sinceRevision),hasRevision=Number.isSafeInteger(requested)&&requested>=0;
  const row=hasRevision
    ?(await db.execute({sql:'SELECT revision,CASE WHEN revision=? THEN NULL ELSE document END AS document FROM field_state WHERE singleton=1',args:[requested]})).rows[0]
    :(await db.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0];
  if(!row)return {revision:0,orders:[]};
  const revision=n(row.revision);
  if(hasRevision&&revision===requested&&row.document==null)return {revision,unchanged:true};
  const doc=readStateRow(row);
  return {revision,orders:queueOrdersView(doc)};
}

export async function queuePosAction({db,user,body,now=Date.now()}){
  validateRequestKey(body.requestKey);
  const context={operation:'queuePosAction',userId:user.id,body};
  const action=String(body.action||'');
  if(!['start','finish','call','call_item','return','select','complete_item','waste_remake'].includes(action))throw bad('invalid_queue_action');
  const tx=await beginWriteTransaction(db);
  try{
    const row=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0];
    const doc=readStateRow(row);
    const old=await replay(tx,doc,body.requestKey,context);
    if(old){await tx.rollback();return {...old,revision:n(row.revision),replayed:true}}
    const active=activeOrders(doc).sort((a,b)=>n(a.time)-n(b.time));
    const order=active.find(o=>o.id===body.orderId);
    if(!order)throw bad('order_not_found',404);
    if(action==='waste_remake'&&waitingPickup(order))throw bad('waste_after_call_not_supported',409);
    const productionHead=active.find(o=>!waitingPickup(o));
    if(['select','complete_item','start','waste_remake'].includes(action)&&productionHead?.id!==order.id)throw bad('fifo_violation',409);
    const queueLookup=buildQueueLookup(doc);
    order.items=normalizeQueueItems(doc,order,queueLookup);
    const idx=Number(body.itemIndex),item=Number.isInteger(idx)?order.items?.[idx]:undefined;
    let actionWasteCost,actionWasteUsage;

    if(action==='select'){
      if(!item)throw bad('item_not_found',404);
      if(body.selected&&n(item.readyQty)>=n(item.qty))throw bad('queue_state_changed',409);
      for(const o of activeOrders(doc))for(const x of o.items||[])x.prepSelected=false;
      item.prepSelected=!!body.selected;
    }else if(action==='complete_item'){
      if(!item)throw bad('item_not_found',404);
      if(Number(body.expectedReadyQty)!==n(item.readyQty)||n(item.readyQty)>=n(item.qty))throw bad('queue_state_changed',409);
      item.readyQty=n(item.qty);item.prepSelected=false;order.status='making';
    }else if(action==='start'){
      if(!item)throw bad('item_not_found',404);
      const unit=Number(body.unit);
      const ready=n(item.readyQty);
      if(!Number.isInteger(unit)||unit!==ready+1||unit>n(item.qty))throw bad('queue_state_changed',409);
      item.readyQty=unit;if(item.readyQty>=n(item.qty))item.prepSelected=false;order.status='making';
    }else if(action==='finish'){
      // Legacy per-item finish action kept for compatibility with existing data/tests.
      // The current UI uses the order-level "call" action once every drink is ready.
      if(!item)throw bad('item_not_found',404);
      const unit=Number(body.unit),ready=n(item.readyQty),called=n(item.calledQty);
      if(!Number.isInteger(unit)||unit>ready||unit!==called+1)throw bad('queue_state_changed',409);
      const fifo=activeOrders(doc).filter(o=>!waitingPickup(o)).sort((a,b)=>n(a.time)-n(b.time));
      if(fifo[0]?.id!==order.id)throw bad('fifo_violation',409);
      item.calledQty=unit;
      if(item.calledQty>=n(item.qty))item.prepSelected=false;
      order.status=(order.items||[]).every(x=>n(x.calledQty)>=n(x.qty))?'ready':'making';
    }else if(action==='call'){
      const items=order.items||[];
      if(!items.length)throw bad('order_not_found',404);
      if(!items.every(x=>n(x.readyQty)>=n(x.qty)))throw bad('order_not_ready',409);
      if(items.every(x=>n(x.calledQty)>=n(x.qty)))throw bad('pager_already_called',409);
      const fifo=activeOrders(doc)
        .filter(o=>!waitingPickup(o))
        .sort((a,b)=>n(a.time)-n(b.time));
      if(fifo[0]?.id!==order.id)throw bad('fifo_violation',409);
      for(const x of items){x.calledQty=n(x.qty);x.prepSelected=false}
      order.status='ready';
      order.calledAt=now;
    }else if(action==='call_item'){
      if(!item)throw bad('item_not_found',404);
      const ready=n(item.readyQty),called=n(item.calledQty);
      if(ready<=called)throw bad('item_not_ready_for_call',409);
      const fifo=activeOrders(doc)
        .filter(o=>!['refunded','cancelled'].includes(String(o.status||'')))
        .sort((a,b)=>n(a.time)-n(b.time));
      if(fifo[0]?.id!==order.id)throw bad('fifo_violation',409);
      item.calledQty=ready;
      item.lastCalledAt=now;
      order.status=(order.items||[]).every(x=>n(x.calledQty)>=n(x.qty))?'ready':'making';
      if(order.status==='ready')order.calledAt=now;
    }else if(action==='waste_remake'){
      if(!item)throw bad('item_not_found',404);
      if(n(item.calledQty)>=n(item.qty))throw bad('waste_after_call_not_supported',409);
      const recipe=saleTimeItemRecipe(doc,order,item,queueLookup);
      if(!recipe?.items||!Object.keys(recipe.items).length)throw bad('recipe_unavailable',409);
      const usage=[];
      let wasteCost=0,costStatus='CONFIRMED';
      for(const [ingredientId,rawQty] of Object.entries(recipe.items)){
        const qty=n(rawQty);if(qty<=0)continue;
        const ingredient=doc.ingredients?.[ingredientId];
        if(!ingredient)throw bad('ingredient_missing:'+ingredientId,409);
        if(n(ingredient.qty)<qty)throw bad('stock_shortage:'+ingredientId,409);
        const unitCost=Math.max(0,n(ingredient.unitCost));
        wasteCost+=qty*unitCost;
        const status=String(ingredient.costStatus||(unitCost>0?'CONFIRMED':'MISSING'));
        if(status==='MISSING')costStatus='MISSING';else if(status==='PROVISIONAL'&&costStatus!=='MISSING')costStatus='PROVISIONAL';
        usage.push({ingredientId,qty,unit:String(ingredient.unit||'g'),name:String(ingredient.name||ingredientId),unitCost});
      }
      if(!usage.length)throw bad('recipe_unavailable',409);
      for(const row of usage)doc.ingredients[row.ingredientId].qty=n(doc.ingredients[row.ingredientId].qty)-row.qty;
      const reason=String(body.reason||'ชงเสีย / ทำใหม่').trim().slice(0,200)||'ชงเสีย / ทำใหม่';
      if(!Array.isArray(doc.expenses))doc.expenses=[];
      const expenseId='exp_remake_'+randomUUID();
      doc.expenses.push({
        id:expenseId,date:String((doc.sales||[]).find(s=>(order.saleIds||[order.saleId]).includes(s.id))?.date||''),
        time:now,category:'WASTE',description:'Remake waste '+String(order.queueNo||order.id)+' · '+String(item.name||item.id)+' · '+reason,
        amount:Math.round(wasteCost*1000000)/1000000,paymentMethod:'noncash',sourceType:'STOCK_REMAKE_WASTE',
        referenceId:body.requestKey,orderId:order.id,menuId:item.id,variant:item.variant,itemIndex:idx,costStatus,createdBy:user.id
      });
      const ledger=usage.map(row=>({sql:'INSERT INTO field_stock_transactions(id,ingredient_id,tx_type,qty_delta,unit,reference_type,reference_id,request_key,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',args:[
        'stx_'+randomUUID(),row.ingredientId,'WASTE',-row.qty,row.unit,'queue_remake',order.id,body.requestKey+':'+row.ingredientId,reason,user.id,now
      ]}));
      await txBatch(tx,ledger);
      if(n(item.readyQty)>n(item.calledQty))item.readyQty=n(item.readyQty)-1;
      item.prepSelected=true;
      item.wasteCount=n(item.wasteCount)+1;
      item.lastWasteAt=now;
      order.status='making';
      actionWasteCost=Math.round(wasteCost*1000000)/1000000;
      actionWasteUsage=usage.map(x=>({ingredientId:x.ingredientId,qty:x.qty,unit:x.unit}));
    }else if(action==='return'){
      if(!waitingPickup(order))throw bad('order_not_complete',409);
      order.status='returned';order.deliveredAt=now;
    }

    const response={ok:true,orderId:order.id,action,wasteCost:action==='waste_remake'?n(actionWasteCost):undefined,orders:queueOrdersView(doc)};
    const remembered=rememberStatement(doc,body.requestKey,response,context,now);
    const saved=stateSaveStatements(row,doc,user.id,'queue_'+action,{orderId:order.id,itemIndex:idx,unit:body.unit,wasteCost:action==='waste_remake'?n(actionWasteCost):undefined,wasteUsage:action==='waste_remake'?actionWasteUsage:undefined},now);
    await txBatch(tx,[remembered,...saved.statements]);
    const revision=saved.revision;
    await tx.commit();
    return {...response,revision,replayed:false};
  }catch(e){await tx.rollback().catch(()=>{});throw e}
}
