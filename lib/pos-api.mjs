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
  return doc;
}
async function saveState(tx,row,doc,actorId,action,details,now){
  const nextRevision=n(row.revision)+1;
  await tx.execute({sql:'UPDATE field_state SET revision=?,document=?,updated_at=? WHERE singleton=1',args:[nextRevision,JSON.stringify(doc),now]});
  await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[actorId,action,JSON.stringify(details||{}),now]});
  return nextRevision;
}
function activeOrders(doc){return doc.orders.filter(o=>o.status!=='returned')}
function firstFreePager(doc){
  const max=Math.max(1,n(doc.settings?.pagerCount)||10),used=new Set(activeOrders(doc).map(o=>n(o.pagerNo)));
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
    const old=replay(doc,body.requestKey);
    if(old){await tx.rollback();return {...old,replayed:true}}

    const cart=normalizeCart(body),items=buildItems(doc,cart);
    deductStock(doc,items.map((x,i)=>({...x,variant:findVariant(doc,cart[i]).variant})));

    const target=body.targetOrderId?doc.orders.find(o=>o.id===body.targetOrderId&&o.status!=='returned'):null;
    if(body.targetOrderId&&!target)throw bad('target_order_unavailable',409);
    const pager=target?n(target.pagerNo):firstFreePager(doc);
    if(pager===null)throw bad('no_pager_available',409);

    const date=String(body.date||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw bad('invalid_date');
    const seq=n(doc.billSeq[date])+1;
    const paymentGroupId='pg-'+randomUUID();
    const payment=String(body.payment||'cash');
    if(!['cash','promptpay','other'].includes(payment))throw bad('invalid_payment');
    const total=items.reduce((s,x)=>s+x.price*x.qty,0);
    const received=payment==='cash'?n(body.received):total;
    if(payment==='cash'&&received<total)throw bad('cash_insufficient',409);

    const groups=body.billMode==='split-row'?items.map(x=>[x]):[items];
    const sales=[];
    const pointsSpend=Math.max(0,n(doc.settings?.pointsSpend));
    const pointsAwarded=body.customerId&&pointsSpend>0?Math.floor(total/pointsSpend):0;
    groups.forEach((group,idx)=>{
      const billSeq=seq+idx;
      const subTotal=group.reduce((s,x)=>s+x.price*x.qty,0);
      const subCost=group.reduce((s,x)=>s+x.unitCost*x.qty,0);
      sales.push({
        id:'s-'+randomUUID(),createdBy:user.id,
        billNo:'FIELD-'+date.replaceAll('-','')+'-'+String(billSeq).padStart(3,'0'),
        time:now+idx,date,items:group,total:subTotal,costTotal:subCost,payment,
        received:idx===0?received:0,change:idx===0&&payment==='cash'?received-total:0,
        status:'paid',pagerNo:pager,customerId:body.customerId||null,
        pointsAwarded:idx===0?pointsAwarded:0,paymentGroupId,parentOrderId:target?.id||null,
        paymentReference:payment==='promptpay'?(body.paymentReference||null):null,
        paymentVerified:payment==='promptpay'?(body.paymentVerified||'manual'):true
      });
    });
    doc.billSeq[date]=seq+groups.length-1;

    let order;
    if(target){
      const added=items.map(x=>({id:x.id,name:x.name,variant:x.variant,qty:x.qty,readyQty:0,calledQty:0,addedAt:now,saleIds:sales.map(s=>s.id)}));
      target.items=[...(target.items||[]),...added];
      target.saleIds=[...(target.saleIds||[target.saleId]).filter(Boolean),...sales.map(s=>s.id)];
      target.total=n(target.total)+total;target.lastAddedAt=now;
      if(target.status==='ready')target.status='making';
      if(!target.status||target.status==='assigned')target.status='assigned';
      order=target;
    }else{
      const q=queueLabelFromSeq(seq);
      order={id:'o-'+randomUUID(),createdBy:user.id,saleId:sales[0].id,saleIds:sales.map(s=>s.id),
        billNo:sales[0].billNo,queueNo:q,items:items.map(x=>({id:x.id,name:x.name,variant:x.variant,qty:x.qty,readyQty:0,calledQty:0})),
        total,pagerNo:pager,status:'assigned',time:now,paymentGroupId};
      doc.orders.push(order);
    }
    sales.forEach(s=>s.queueNo=order.queueNo||queueLabelFromSeq(seq));
    doc.sales.push(...sales);
    doc.cart=[];

    const response={ok:true,orderId:order.id,pager,queueNo:order.queueNo||queueLabelFromSeq(seq),saleIds:sales.map(s=>s.id)};
    remember(doc,body.requestKey,response);
    const revision=await saveState(tx,row,doc,user.id,'pos_checkout',{orderId:order.id,saleIds:response.saleIds,pager},now);
    await tx.commit();
    return {...response,revision,state:doc,replayed:false};
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
