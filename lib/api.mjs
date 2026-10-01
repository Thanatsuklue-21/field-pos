import {randomUUID} from 'node:crypto';
import {digest,newToken,hashPassword,verifyPassword,validUsername,validPassword,normalizePermissions,mayView} from './security.mjs';
import {previewSnapshot,expectedRevision} from './migration.mjs';
import {handleStockApi} from './stock-api.mjs';
import {checkoutPos,queuePosAction,startSplitPayment,paySplitPayment,getSplitPaymentStatus,listSplitPaymentSessions,cancelSplitPayment} from './pos-api.mjs';
import {promptPayConfig,createPromptPayCharge,getPromptPayCharge,verifyPromptPayWebhook} from './payment-opn.mjs';
const SESSION_MS=12*60*60*1000;
const reply=(res,status,body,extra={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra});res.end(JSON.stringify(body))};
const one=async(db,sql,args=[])=>{const r=await db.execute({sql,args});return r.rows[0]};
const asUser=row=>({id:row.id,username:row.username,role:row.role,permissions:JSON.parse(row.permissions||'{}')});
const cookie=req=>String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('field_session='))?.slice(14)||'';
const writeMethods=new Set(['POST','PATCH','PUT','DELETE']);
function bodyOf(req){const b=req.body;if(!b||typeof b!=='object'||Array.isArray(b))throw Object.assign(new Error('invalid_json'),{status:400});return b}
function pathOf(req){const route=req.query?.route;return '/api/'+(Array.isArray(route)?route.join('/'):String(route||'').replace(/^\/+/,''))}
export function createApi({db,origin}){
  return async(req,res)=>{
    try{
      const path=pathOf(req),method=req.method,now=Date.now();
      if(path==='/api/health'&&method==='GET'){await one(db,'SELECT 1 AS ok');return reply(res,200,{ok:true,storage:'turso'})}
      if(writeMethods.has(method)&&req.headers.origin!==origin)return reply(res,403,{error:'origin_denied'});
      if(path==='/api/auth/login'&&method==='POST'){
        const b=bodyOf(req),username=String(b.username||'').trim().toLowerCase(),password=String(b.password||'');
        if(!validUsername(username)||!password||password.length>128)return reply(res,401,{error:'invalid_credentials'});
        const row=await one(db,'SELECT * FROM field_users WHERE username=?',[username]);
        if(!row||!row.active||Number(row.locked_until)>now||!await verifyPassword(password,row.password_hash)){
          if(row?.active)await db.execute({sql:'UPDATE field_users SET failed_count=failed_count+1,locked_until=CASE WHEN failed_count>=4 THEN ? ELSE locked_until END WHERE id=?',args:[now+5*60*1000,row.id]});
          return reply(res,401,{error:'invalid_credentials'});
        }
        await db.execute({sql:'UPDATE field_users SET failed_count=0,locked_until=0 WHERE id=?',args:[row.id]});
        const token=newToken(),csrf=newToken();
        await db.execute({sql:'INSERT INTO field_sessions(token_hash,user_id,csrf_token,expires_at) VALUES(?,?,?,?)',args:[digest(token),row.id,csrf,now+SESSION_MS]});
        return reply(res,200,{user:asUser(row),csrf},{'Set-Cookie':`field_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${SESSION_MS/1000}`});
      }
      if(path==='/api/payments/promptpay/webhook'&&method==='POST'){
        try{return reply(res,200,await verifyPromptPayWebhook(bodyOf(req)))}
        catch(e){return reply(res,e.status||500,{error:e.status?e.message:'server_error'})}
      }
      const sessionToken=cookie(req);if(!sessionToken)return reply(res,401,{error:'login_required'});
      const row=await one(db,'SELECT s.token_hash,s.csrf_token,u.id,u.username,u.role,u.permissions,u.active FROM field_sessions s JOIN field_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?',[digest(sessionToken),now]);
      if(!row?.active)return reply(res,401,{error:'login_required'});
      if(writeMethods.has(method)&&req.headers['x-csrf-token']!==row.csrf_token)return reply(res,403,{error:'csrf_denied'});
      const user=asUser(row);
      if(path==='/api/auth/session'&&method==='GET')return reply(res,200,{user,csrf:row.csrf_token});
      if(path==='/api/auth/logout'&&method==='POST'){
        await db.execute({sql:'DELETE FROM field_sessions WHERE token_hash=?',args:[row.token_hash]});
        return reply(res,200,{ok:true},{'Set-Cookie':'field_session=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0'});
      }
      if(path==='/api/me/views'&&method==='GET')return reply(res,200,{views:Object.fromEntries(['order','queue','stock','report','crm','menu','settings'].map(v=>[v,!!mayView({...user,active:true},v)]))});
      if(path==='/api/stock/overview'&&method==='GET'){
        if(user.role!=='admin'&&!mayView({...user,active:true},'stock'))return reply(res,403,{error:'stock_permission_required'});
        const state=await one(db,'SELECT revision,document FROM field_state WHERE singleton=1');
        const doc=JSON.parse(state.document||'{}');
        const ingredients=Object.entries(doc.ingredients||{}).map(([id,x])=>({
          id,name:String(x.name||id),qty:Number(x.qty)||0,unit:String(x.unit||'g'),
          safetyStock:Number(x.safetyStock??x.minQty??0)||0,unitCost:Number(x.unitCost)||0
        })).sort((a,b)=>a.name.localeCompare(b.name));
        const recent=await db.execute('SELECT id,ingredient_id,tx_type,qty_delta,unit,reference_type,reference_id,reason,actor_id,created_at FROM field_stock_transactions ORDER BY created_at DESC LIMIT 100');
        return reply(res,200,{revision:Number(state.revision)||0,ingredients:ingredients.map(x=>({...x,lowStock:x.safetyStock>0&&x.qty<=x.safetyStock})),transactions:recent.rows.map(x=>({
          id:String(x.id),ingredientId:String(x.ingredient_id),type:String(x.tx_type),qtyDelta:Number(x.qty_delta),unit:String(x.unit),referenceType:x.reference_type||null,referenceId:x.reference_id||null,reason:String(x.reason||''),createdBy:x.actor_id||null,createdAt:Number(x.created_at)
        }))});
      }
      const stockIngredientMatch=path.match(/^\/api\/stock\/ingredients\/([^/]+)$/);
      if(stockIngredientMatch&&method==='PATCH'){
        if(path==='/api/expenses'&&method==='GET'){
        if(user.role!=='admin'&&!mayView({...user,active:true},'report'))return reply(res,403,{error:'report_permission_required'});
        const state=await one(db,'SELECT revision,document FROM field_state WHERE singleton=1'),doc=JSON.parse(state.document||'{}');
        return reply(res,200,{revision:Number(state.revision)||0,expenses:(Array.isArray(doc.expenses)?doc.expenses:[]).slice().sort((a,b)=>Number(b.time||0)-Number(a.time||0)).slice(0,500)});
      }
      if(path==='/api/expenses'&&method==='POST'){
        if(user.role!=='admin'&&!mayView({...user,active:true},'report'))return reply(res,403,{error:'report_permission_required'});
        const b=bodyOf(req),amount=Number(b.amount),date=String(b.date||new Date(now).toISOString().slice(0,10)),category=String(b.category||'OTHER').trim().slice(0,60),description=String(b.description||'').trim().slice(0,240);
        if(!Number.isFinite(amount)||amount<=0||amount>1e7||!/^\d{4}-\d{2}-\d{2}$/.test(date))return reply(res,400,{error:'invalid_expense'});
        const tx=await db.transaction('write');
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}');
          if(!Array.isArray(doc.expenses))doc.expenses=[];
          const expense={id:'exp_'+randomUUID(),date,time:now,category,description,amount,createdBy:user.id};
          doc.expenses.push(expense);
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'expense_create',JSON.stringify({id:expense.id,amount,category}),now]});
          await tx.commit();return reply(res,201,{ok:true,expense});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      const expenseMatch=path.match(/^\/api\/expenses\/([^/]+)$/);
      if(expenseMatch&&method==='DELETE'){
        if(user.role!=='admin')return reply(res,403,{error:'admin_required'});
        const id=decodeURIComponent(expenseMatch[1]),tx=await db.transaction('write');
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}'),idx=(doc.expenses||[]).findIndex(x=>x.id===id);
          if(idx<0){await tx.rollback();return reply(res,404,{error:'expense_not_found'})}
          const [removed]=doc.expenses.splice(idx,1);
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'expense_delete',JSON.stringify({id,amount:removed.amount}),now]});
          await tx.commit();return reply(res,200,{ok:true});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      if(path==='/api/customers'&&method==='GET'){
        if(user.role!=='admin'&&!mayView({...user,active:true},'crm'))return reply(res,403,{error:'crm_permission_required'});
        const state=await one(db,'SELECT revision,document FROM field_state WHERE singleton=1'),doc=JSON.parse(state.document||'{}');
        return reply(res,200,{revision:Number(state.revision)||0,customers:(Array.isArray(doc.customers)?doc.customers:[]).slice().sort((a,b)=>Number(b.lastVisit||0)-Number(a.lastVisit||0))});
      }
      if(path==='/api/customers'&&method==='POST'){
        if(user.role!=='admin'&&!mayView({...user,active:true},'crm'))return reply(res,403,{error:'crm_permission_required'});
        const b=bodyOf(req),name=String(b.name||'').trim().slice(0,120),phone=String(b.phone||'').trim().slice(0,30),lineId=String(b.lineId||'').trim().slice(0,80);
        if(name.length<1)return reply(res,400,{error:'invalid_customer'});
        const tx=await db.transaction('write');
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}');
          if(!Array.isArray(doc.customers))doc.customers=[];
          if(phone&&doc.customers.some(x=>String(x.phone||'')===phone)){await tx.rollback();return reply(res,409,{error:'customer_phone_exists'})}
          const customer={id:'cus_'+randomUUID(),name,phone,lineId,points:0,visits:0,totalSpend:0,lastVisit:0,createdAt:now,createdBy:user.id};
          doc.customers.push(customer);
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'customer_create',JSON.stringify({id:customer.id,name}),now]});
          await tx.commit();return reply(res,201,{ok:true,customer});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      const customerMatch=path.match(/^\/api\/customers\/([^/]+)$/);
      if(customerMatch&&method==='PATCH'){
        if(user.role!=='admin'&&!mayView({...user,active:true},'crm'))return reply(res,403,{error:'crm_permission_required'});
        const id=decodeURIComponent(customerMatch[1]),b=bodyOf(req),tx=await db.transaction('write');
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}'),customer=(doc.customers||[]).find(x=>x.id===id);
          if(!customer){await tx.rollback();return reply(res,404,{error:'customer_not_found'})}
          if(b.name!==undefined){const v=String(b.name).trim().slice(0,120);if(!v)throw Object.assign(new Error('invalid_customer'),{status:400});customer.name=v}
          if(b.phone!==undefined)customer.phone=String(b.phone||'').trim().slice(0,30);
          if(b.lineId!==undefined)customer.lineId=String(b.lineId||'').trim().slice(0,80);
          if(b.pointsDelta!==undefined){const d=Number(b.pointsDelta);if(!Number.isFinite(d)||Math.abs(d)>1e6)throw Object.assign(new Error('invalid_points'),{status:400});customer.points=Math.max(0,Number(customer.points||0)+Math.trunc(d))}
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'customer_update',JSON.stringify({id,pointsDelta:b.pointsDelta}),now]});
          await tx.commit();return reply(res,200,{ok:true,customer});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      if(path==='/api/close-day'&&method==='GET'){
        if(user.role!=='admin'&&!mayView({...user,active:true},'report'))return reply(res,403,{error:'report_permission_required'});
        const state=await one(db,'SELECT revision,document FROM field_state WHERE singleton=1'),doc=JSON.parse(state.document||'{}');
        return reply(res,200,{revision:Number(state.revision)||0,closes:(Array.isArray(doc.closes)?doc.closes:[]).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,120)});
      }
      if(path==='/api/close-day'&&method==='POST'){
        if(user.role!=='admin')return reply(res,403,{error:'admin_required'});
        const b=bodyOf(req),date=String(b.date||new Date(now).toISOString().slice(0,10));
        if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return reply(res,400,{error:'invalid_date'});
        const tx=await db.transaction('write');
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}');
          if(!Array.isArray(doc.closes))doc.closes=[];
          if(doc.closes.some(x=>x.date===date)){await tx.rollback();return reply(res,409,{error:'day_already_closed'})}
          const sales=(doc.sales||[]).filter(s=>s.date===date&&s.status!=='void'),expenses=(doc.expenses||[]).filter(e=>e.date===date);
          const revenue=sales.reduce((s,x)=>s+Number(x.total||0),0),cogs=sales.reduce((s,x)=>s+Number(x.costTotal||0),0),expenseTotal=expenses.reduce((s,x)=>s+Number(x.amount||0),0);
          let cash=0,promptpay=0,other=0;
          for(const sale of sales)for(const p of (sale.payments||[{method:sale.payment,amount:sale.total}])){const amount=Number(p.amount||0);if(p.method==='cash')cash+=amount;else if(p.method==='promptpay')promptpay+=amount;else other+=amount}
          const close={id:'close_'+randomUUID(),date,time:now,revenue,cogs,expenses:expenseTotal,grossProfit:revenue-cogs,operatingProfit:revenue-cogs-expenseTotal,cash,promptpay,other,orders:sales.length,cups:sales.reduce((s,x)=>s+(x.items||[]).reduce((n,i)=>n+Number(i.qty||0),0),0),closedBy:user.id};
          doc.closes.push(close);
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'close_day',JSON.stringify({id:close.id,date,revenue}),now]});
          await tx.commit();return reply(res,201,{ok:true,close});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      if(path==='/api/management/dashboard'&&method==='GET'){
        if(user.role!=='admin'&&!mayView({...user,active:true},'report'))return reply(res,403,{error:'report_permission_required'});
        const state=await one(db,'SELECT revision,document FROM field_state WHERE singleton=1'),doc=JSON.parse(state.document||'{}');
        const sales=(doc.sales||[]).filter(s=>s.status!=='void'),expenses=doc.expenses||[],ingredients=doc.ingredients||{},today=new Date(now).toISOString().slice(0,10),month=today.slice(0,7);
        const monthSales=sales.filter(s=>String(s.date||'').startsWith(month)),monthExpenses=expenses.filter(e=>String(e.date||'').startsWith(month));
        const revenue=monthSales.reduce((s,x)=>s+Number(x.total||0),0),cogs=monthSales.reduce((s,x)=>s+Number(x.costTotal||0),0),expenseTotal=monthExpenses.reduce((s,x)=>s+Number(x.amount||0),0);
        const itemMap={};for(const sale of monthSales)for(const i of sale.items||[]){const k=i.name||i.id;itemMap[k]=(itemMap[k]||0)+Number(i.qty||0)}
        const topItems=Object.entries(itemMap).map(([name,qty])=>({name,qty})).sort((a,b)=>b.qty-a.qty).slice(0,5);
        const lowStock=Object.entries(ingredients).map(([id,x])=>({id,name:x.name||id,qty:Number(x.qty)||0,safetyStock:Number(x.safetyStock??x.minQty??0)||0,unit:x.unit||'g'})).filter(x=>x.safetyStock>0&&x.qty<=x.safetyStock);
        const todaySales=sales.filter(s=>s.date===today),todayRevenue=todaySales.reduce((s,x)=>s+Number(x.total||0),0);
        const recommendations=[];
        if(lowStock.length)recommendations.push({level:'warning',title:'สต็อกต่ำ',detail:lowStock.slice(0,3).map(x=>x.name).join(', ')+' ควรวางแผนสั่งซื้อ'});
        const margin=revenue?((revenue-cogs)/revenue)*100:0;if(revenue&&margin<55)recommendations.push({level:'warning',title:'Gross Margin ต่ำ',detail:'เดือนนี้ '+margin.toFixed(1)+'% ควรตรวจราคาวัตถุดิบ/ราคาขาย'});
        if(monthSales.length&&topItems.length)recommendations.push({level:'info',title:'เมนูขายดี',detail:topItems[0].name+' ขาย '+topItems[0].qty+' แก้วในเดือนนี้'});
        if(!recommendations.length)recommendations.push({level:'ok',title:'สถานะปกติ',detail:'ยังไม่พบประเด็นเร่งด่วนจากยอดขาย ต้นทุน และสต็อก'});
        return reply(res,200,{revision:Number(state.revision)||0,today,month,todayRevenue,todayOrders:todaySales.length,revenue,cogs,expenses:expenseTotal,operatingProfit:revenue-cogs-expenseTotal,grossMargin:margin,topItems,lowStock,recommendations,customers:(doc.customers||[]).length});
      }
      if(user.role!=='admin')return reply(res,403,{error:'admin_required'});
        const id=decodeURIComponent(stockIngredientMatch[1]),b=bodyOf(req);
        const safetyStock=b.safetyStock===undefined?undefined:Number(b.safetyStock);
        const unitCost=b.unitCost===undefined?undefined:Number(b.unitCost);
        if(safetyStock!==undefined&&(!Number.isFinite(safetyStock)||safetyStock<0||safetyStock>1e9))return reply(res,400,{error:'invalid_safety_stock'});
        if(unitCost!==undefined&&(!Number.isFinite(unitCost)||unitCost<0||unitCost>1e6))return reply(res,400,{error:'invalid_unit_cost'});
        if(safetyStock===undefined&&unitCost===undefined)return reply(res,400,{error:'no_stock_fields'});
        const tx=await db.transaction('write');
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}'),ingredient=doc.ingredients?.[id];
          if(!ingredient){await tx.rollback();return reply(res,404,{error:'ingredient_missing'})}
          if(safetyStock!==undefined)ingredient.safetyStock=safetyStock;
          if(unitCost!==undefined)ingredient.unitCost=unitCost;
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'stock_ingredient_update',JSON.stringify({id,safetyStock,unitCost}),now]});
          await tx.commit();return reply(res,200,{ok:true});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      if(path==='/api/stock/transactions'&&method==='POST'){
        const stockResponse=await handleStockApi({path,method,user,db,body:bodyOf(req),now});
        return reply(res,stockResponse.status,stockResponse.body);
      }
      if(path==='/api/pos/checkout'&&method==='POST'){
        if(!mayView({...user,active:true},'order'))return reply(res,403,{error:'order_permission_required'});
        try{return reply(res,200,await checkoutPos({db,user,body:bodyOf(req),now}))}
        catch(e){return reply(res,e.status||500,{error:e.status?e.message:'server_error'})}
      }
      if(path==='/api/pos/queue'&&method==='POST'){
        if(!mayView({...user,active:true},'queue'))return reply(res,403,{error:'queue_permission_required'});
        try{return reply(res,200,await queuePosAction({db,user,body:bodyOf(req),now}))}
        catch(e){return reply(res,e.status||500,{error:e.status?e.message:'server_error'})}
      }
      if(path==='/api/pos/split/start'&&method==='POST'){
        if(!mayView({...user,active:true},'order'))return reply(res,403,{error:'order_permission_required'});
        try{return reply(res,200,await startSplitPayment({db,user,body:bodyOf(req),now}))}
        catch(e){return reply(res,e.status||500,{error:e.status?e.message:'server_error'})}
      }
      if(path==='/api/pos/split/pay'&&method==='POST'){
        if(!mayView({...user,active:true},'order'))return reply(res,403,{error:'order_permission_required'});
        try{return reply(res,200,await paySplitPayment({db,user,body:bodyOf(req),now}))}
        catch(e){return reply(res,e.status||500,{error:e.status?e.message:'server_error'})}
      }
      if(path==='/api/pos/split/status'&&method==='POST'){
        if(!mayView({...user,active:true},'order'))return reply(res,403,{error:'order_permission_required'});
        try{return reply(res,200,await getSplitPaymentStatus({db,body:bodyOf(req),now}))}
        catch(e){return reply(res,e.status||500,{error:e.status?e.message:'server_error'})}
      }
      if(path==='/api/pos/split/list'&&method==='GET'){
        if(!mayView({...user,active:true},'order'))return reply(res,403,{error:'order_permission_required'});
        try{return reply(res,200,await listSplitPaymentSessions({db,now}))}
        catch(e){return reply(res,e.status||500,{error:e.status?e.message:'server_error'})}
      }
      if(path==='/api/pos/bootstrap'&&method==='GET'){
        if(!mayView({...user,active:true},'order')&&!mayView({...user,active:true},'queue'))return reply(res,403,{error:'pos_permission_required'});
        const state=await one(db,'SELECT revision,document FROM field_state WHERE singleton=1');
        const doc=JSON.parse(state.document||'{}');
        const menu=(Array.isArray(doc.menu)?doc.menu:[]).filter(m=>!m.archived).map(m=>({
          id:String(m.id||''),name:String(m.name||''),category:String(m.category||''),
          price:Number(m.price)||0,enabled:!!m.enabled,
          variants:(Array.isArray(m.variants)?m.variants:[]).map(v=>({label:String(v.label||'')}))
        }));
        const orders=(Array.isArray(doc.orders)?doc.orders:[]).filter(o=>o.status!=='returned').map(o=>({
          id:o.id,queueNo:o.queueNo,pagerNo:o.pagerNo,status:o.status,time:o.time,total:o.total,
          items:(o.items||[]).map(x=>({id:x.id,name:x.name,variant:x.variant,qty:x.qty,readyQty:x.readyQty,calledQty:x.calledQty}))
        }));
        return reply(res,200,{revision:Number(state.revision)||0,menu,orders,settings:{pagerCount:Number(doc.settings?.pagerCount)||10}});
      }
      if(path==='/api/pos/history'&&method==='GET'){
        if(!mayView({...user,active:true},'order'))return reply(res,403,{error:'order_permission_required'});
        const state=await one(db,'SELECT revision,document FROM field_state WHERE singleton=1');
        const doc=JSON.parse(state.document||'{}');
        const sales=(Array.isArray(doc.sales)?doc.sales:[]).slice(-300).reverse().map(s=>({
          id:s.id,billNo:s.billNo,date:s.date,time:Number(s.time)||0,total:Number(s.total)||0,
          payment:s.payment||'',status:s.status||'',queueNo:s.queueNo||'',itemCount:(s.items||[]).reduce((n,x)=>n+(Number(x.qty)||0),0),
          items:(s.items||[]).map(x=>({name:x.name,variant:x.variant,qty:Number(x.qty)||0,price:Number(x.price)||0}))
        }));
        return reply(res,200,{revision:Number(state.revision)||0,sales});
      }
      if(path==='/api/reports/summary'&&method==='GET'){
        if(user.role!=='admin'&&!mayView({...user,active:true},'report'))return reply(res,403,{error:'report_permission_required'});
        const state=await one(db,'SELECT revision,document FROM field_state WHERE singleton=1');
        const doc=JSON.parse(state.document||'{}'),sales=(Array.isArray(doc.sales)?doc.sales:[]).filter(s=>s.status!=='void');
        const byDate={};let revenue=0,cost=0,cups=0;
        for(const s of sales){const d=String(s.date||'');const total=Number(s.total)||0;byDate[d]=(byDate[d]||0)+total;revenue+=total;cost+=Number(s.costTotal)||0;cups+=(s.items||[]).reduce((n,x)=>n+(Number(x.qty)||0),0)}
        const dates=Object.keys(byDate).sort().slice(-7),daily=dates.map(date=>({date,revenue:byDate[date]}));
        const today=dates.at(-1)||'',todayRevenue=Number(byDate[today])||0;
        return reply(res,200,{revision:Number(state.revision)||0,today,todayRevenue,totalRevenue:revenue,grossProfit:revenue-cost,grossMargin:revenue?((revenue-cost)/revenue)*100:0,cups,daily});
      }
      if(path==='/api/pos/split/cancel'&&method==='POST'){
        if(!mayView({...user,active:true},'order'))return reply(res,403,{error:'order_permission_required'});
        try{return reply(res,200,await cancelSplitPayment({db,user,body:bodyOf(req),now}))}
        catch(e){return reply(res,e.status||500,{error:e.status?e.message:'server_error'})}
      }
      if(path==='/api/payments/promptpay/config'&&method==='GET'){
        if(!mayView({...user,active:true},'order'))return reply(res,403,{error:'order_permission_required'});
        return reply(res,200,promptPayConfig());
      }
      if(path==='/api/payments/promptpay/create'&&method==='POST'){
        if(!mayView({...user,active:true},'order'))return reply(res,403,{error:'order_permission_required'});
        const b=bodyOf(req);
        try{return reply(res,200,await createPromptPayCharge({amount:b.amount,reference:b.reference}))}
        catch(e){return reply(res,e.status||500,{error:e.status?e.message:'server_error'})}
      }
      if(path==='/api/payments/promptpay/status'&&method==='POST'){
        if(!mayView({...user,active:true},'order'))return reply(res,403,{error:'order_permission_required'});
        const b=bodyOf(req);
        try{return reply(res,200,await getPromptPayCharge(b.chargeId))}
        catch(e){return reply(res,e.status||500,{error:e.status?e.message:'server_error'})}
      }
      if(user.role!=='admin')return reply(res,403,{error:'admin_required'});
      if(path==='/api/admin/business-settings'&&method==='GET'){
        const state=await one(db,'SELECT revision,document FROM field_state WHERE singleton=1'),doc=JSON.parse(state.document||'{}');
        return reply(res,200,{revision:Number(state.revision)||0,settings:{pointsSpend:Number(doc.settings?.pointsSpend)||0,pagerCount:Number(doc.settings?.pagerCount)||10}});
      }
      if(path==='/api/admin/business-settings'&&method==='PATCH'){
        const b=bodyOf(req),pointsSpend=b.pointsSpend===undefined?undefined:Number(b.pointsSpend),pagerCount=b.pagerCount===undefined?undefined:Number(b.pagerCount);
        if(pointsSpend!==undefined&&(!Number.isFinite(pointsSpend)||pointsSpend<0||pointsSpend>1e6))return reply(res,400,{error:'invalid_points_spend'});
        if(pagerCount!==undefined&&(!Number.isFinite(pagerCount)||pagerCount<1||pagerCount>100))return reply(res,400,{error:'invalid_pager_count'});
        const tx=await db.transaction('write');
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}');
          if(!doc.settings||typeof doc.settings!=='object')doc.settings={};
          if(pointsSpend!==undefined)doc.settings.pointsSpend=pointsSpend;
          if(pagerCount!==undefined)doc.settings.pagerCount=Math.floor(pagerCount);
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'business_settings_update',JSON.stringify({pointsSpend,pagerCount}),now]});
          await tx.commit();return reply(res,200,{ok:true,settings:doc.settings});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      if(path==='/api/admin/recipes'&&method==='GET'){
        const state=await one(db,'SELECT revision,document FROM field_state WHERE singleton=1'),doc=JSON.parse(state.document||'{}');
        const versions=await db.execute('SELECT id,menu_id,version,status,document,created_by,created_at FROM field_recipe_versions ORDER BY created_at DESC LIMIT 200');
        return reply(res,200,{revision:Number(state.revision)||0,
          ingredients:Object.entries(doc.ingredients||{}).map(([id,x])=>({id,name:x.name||id,unit:x.unit||'g',qty:Number(x.qty)||0,unitCost:Number(x.unitCost)||0})),
          menus:(doc.menu||[]).filter(m=>!m.archived).map(m=>({id:m.id,name:m.name,enabled:!!m.enabled,variants:(m.variants||[]).map(v=>({label:v.label||'Standard',recipeVersion:Number(v.recipeVersion)||null,recipe:v.recipe||{items:{}}}))})),
          versions:versions.rows.map(x=>({id:String(x.id),menuId:String(x.menu_id),version:Number(x.version),status:String(x.status),document:JSON.parse(x.document||'{}'),createdBy:x.created_by||null,createdAt:Number(x.created_at)})
        });
      }
      if(path==='/api/admin/recipes/publish'&&method==='POST'){
        const b=bodyOf(req),menuId=String(b.menuId||''),variantLabel=String(b.variant||'').trim(),items=b.items;
        if(!menuId||!variantLabel||!items||typeof items!=='object'||Array.isArray(items))return reply(res,400,{error:'invalid_recipe'});
        const tx=await db.transaction('write');
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}'),menu=(doc.menu||[]).find(m=>m.id===menuId&&!m.archived);
          if(!menu){await tx.rollback();return reply(res,404,{error:'menu_not_found'})}
          const variant=(menu.variants||[]).find(v=>v.label===variantLabel);if(!variant){await tx.rollback();return reply(res,404,{error:'variant_not_found'})}
          const normalized={};
          for(const [ingredientId,rawQty] of Object.entries(items)){
            const qty=Number(rawQty);if(!doc.ingredients?.[ingredientId])throw Object.assign(new Error('ingredient_missing'),{status:400});
            if(!Number.isFinite(qty)||qty<=0||qty>1e6)throw Object.assign(new Error('invalid_recipe_qty'),{status:400});
            normalized[ingredientId]=qty;
          }
          if(!Object.keys(normalized).length)throw Object.assign(new Error('empty_recipe'),{status:400});
          const vr=(await tx.execute({sql:'SELECT COALESCE(MAX(version),0) AS v FROM field_recipe_versions WHERE menu_id=?',args:[menuId]})).rows[0],version=Number(vr?.v||0)+1;
          const versionId='rv_'+randomUUID(),document={menuId,menuName:menu.name,variant:variantLabel,items:normalized};
          await tx.execute({sql:'INSERT INTO field_recipe_versions(id,menu_id,version,status,document,created_by,created_at) VALUES(?,?,?,?,?,?,?)',args:[versionId,menuId,version,'active',JSON.stringify(document),user.id,now]});
          variant.recipe={items:normalized};variant.recipeVersion=version;
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'recipe_publish',JSON.stringify({menuId,variant:variantLabel,version}),now]});
          await tx.commit();return reply(res,201,{ok:true,version,id:versionId});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      if(path==='/api/admin/products'&&method==='GET'){
        const state=await one(db,'SELECT revision,document FROM field_state WHERE singleton=1');
        const doc=JSON.parse(state.document||'{}');
        return reply(res,200,{revision:Number(state.revision)||0,products:(Array.isArray(doc.menu)?doc.menu:[]).filter(m=>!m.archived).map(m=>({
          id:m.id,name:m.name,category:m.category||'',price:Number(m.price)||0,enabled:!!m.enabled,image:m.image||'',
          variants:(Array.isArray(m.variants)?m.variants:[]).map(v=>({label:v.label||''}))
        }))});
      }
      if(path==='/api/admin/products'&&method==='POST'){
        const b=bodyOf(req),name=String(b.name||'').trim(),category=String(b.category||'').trim(),price=Number(b.price);
        if(name.length<2||name.length>120||category.length>80||!Number.isFinite(price)||price<0||price>100000)return reply(res,400,{error:'invalid_product'});
        const tx=await db.transaction('write');
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}');
          if(!Array.isArray(doc.menu))doc.menu=[];
          const id='menu-'+randomUUID(),product={id,name,category:category||'OTHER',price,enabled:false,image:String(b.image||'').slice(0,500),variants:[{label:'Standard',recipe:{items:{}}}]};
          doc.menu.push(product);
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'product_create',JSON.stringify({id,name}),now]});
          await tx.commit();return reply(res,201,{ok:true,product:{id,name,category:product.category,price,enabled:false,image:product.image,variants:[{label:'Standard'}]}});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      const productMatch=path.match(/^\/api\/admin\/products\/([^/]+)$/);
      if(productMatch&&method==='PATCH'){
        const id=decodeURIComponent(productMatch[1]),b=bodyOf(req),tx=await db.transaction('write');
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}'),product=(doc.menu||[]).find(m=>m.id===id&&!m.archived);
          if(!product){await tx.rollback();return reply(res,404,{error:'product_not_found'})}
          if(b.name!==undefined){const v=String(b.name).trim();if(v.length<2||v.length>120)throw Object.assign(new Error('invalid_product'),{status:400});product.name=v}
          if(b.category!==undefined){const v=String(b.category).trim();if(v.length>80)throw Object.assign(new Error('invalid_product'),{status:400});product.category=v||'OTHER'}
          if(b.price!==undefined){const v=Number(b.price);if(!Number.isFinite(v)||v<0||v>100000)throw Object.assign(new Error('invalid_product'),{status:400});product.price=v}
          if(b.enabled!==undefined){if(typeof b.enabled!=='boolean')throw Object.assign(new Error('invalid_product'),{status:400});if(b.enabled&&(product.variants||[]).some(v=>!v.recipe?.items||!Object.keys(v.recipe.items).length))throw Object.assign(new Error('recipe_required_before_enable'),{status:409});product.enabled=b.enabled}
          if(b.image!==undefined)product.image=String(b.image||'').slice(0,500);
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'product_update',JSON.stringify({id}),now]});
          await tx.commit();return reply(res,200,{ok:true});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      if(productMatch&&method==='DELETE'){
        const id=decodeURIComponent(productMatch[1]),tx=await db.transaction('write');
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}'),product=(doc.menu||[]).find(m=>m.id===id&&!m.archived);
          if(!product){await tx.rollback();return reply(res,404,{error:'product_not_found'})}
          product.enabled=false;product.archived=true;product.archivedAt=now;
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'product_archive',JSON.stringify({id}),now]});
          await tx.commit();return reply(res,200,{ok:true});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      if(path==='/api/admin/users'&&method==='GET'){
        const list=await db.execute('SELECT id,username,role,permissions,active,created_at FROM field_users ORDER BY created_at');
        return reply(res,200,{users:list.rows.map(x=>({...x,permissions:JSON.parse(x.permissions),active:!!x.active}))});
      }
      if(path==='/api/admin/users'&&method==='POST'){
        const b=bodyOf(req),username=String(b.username||'').trim().toLowerCase(),role=b.role;
        if(!validUsername(username)||!validPassword(b.password)||!['admin','staff'].includes(role))return reply(res,400,{error:'invalid_user'});
        const permissions=role==='staff'?normalizePermissions(b.permissions??{order:true,queue:true}):{};
        if(role==='staff'&&!permissions.order&&!permissions.queue)return reply(res,400,{error:'staff_needs_order_or_queue'});
        const id=randomUUID(),hash=await hashPassword(b.password);
        try{await db.execute({sql:'INSERT INTO field_users(id,username,password_hash,role,permissions,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',args:[id,username,hash,role,JSON.stringify(permissions),now,now]})}
        catch(e){if(/UNIQUE/i.test(e.message))return reply(res,409,{error:'username_exists'});throw e}
        await db.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'user_create',JSON.stringify({id,username,role}),now]});
        return reply(res,201,{id,username,role});
      }
      const match=path.match(/^\/api\/admin\/users\/([0-9a-f-]{36})$/);
      if(match&&method==='PATCH'){
        const id=match[1],b=bodyOf(req),target=await one(db,'SELECT id,role,active FROM field_users WHERE id=?',[id]);
        if(!target)return reply(res,404,{error:'user_not_found'});
        if(b.active===false&&id===user.id)return reply(res,400,{error:'cannot_disable_self'});
        if(b.active===false&&target.role==='admin'){
          const count=await one(db,"SELECT COUNT(*) AS n FROM field_users WHERE role='admin' AND active=1");
          if(Number(count.n)<=1)return reply(res,400,{error:'last_admin'});
        }
        if(b.active!==undefined&&typeof b.active!=='boolean')return reply(res,400,{error:'invalid_active'});
        if(b.password!==undefined&&!validPassword(b.password))return reply(res,400,{error:'invalid_password'});
        if(b.permissions!==undefined&&target.role!=='staff')return reply(res,400,{error:'admin_permissions_fixed'});
        const permissions=b.permissions!==undefined?normalizePermissions(b.permissions):null;
        if(permissions&&!permissions.order&&!permissions.queue)return reply(res,400,{error:'staff_needs_order_or_queue'});
        const tx=await db.transaction('write');
        try{
          await tx.execute({sql:'UPDATE field_users SET password_hash=COALESCE(?,password_hash),permissions=COALESCE(?,permissions),active=COALESCE(?,active),updated_at=? WHERE id=?',args:[b.password===undefined?null:await hashPassword(b.password),permissions?JSON.stringify(permissions):null,b.active===undefined?null:Number(b.active),now,id]});
          if(b.password!==undefined||b.active===false)await tx.execute({sql:'DELETE FROM field_sessions WHERE user_id=?',args:[id]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'user_update',JSON.stringify({id,passwordReset:b.password!==undefined,active:b.active}),now]});
          await tx.commit();
        }catch(e){await tx.rollback();throw e}
        return reply(res,200,{ok:true});
      }
      if(path==='/api/state/meta'&&method==='GET'){
        const state=await one(db,'SELECT revision,updated_at FROM field_state WHERE singleton=1');
        return reply(res,200,{revision:Number(state.revision),updatedAt:Number(state.updated_at)});
      }
      if(path==='/api/state'&&method==='GET'){
        const state=await one(db,'SELECT revision,document,updated_at FROM field_state WHERE singleton=1');
        return reply(res,200,{revision:Number(state.revision),state:JSON.parse(state.document),updatedAt:Number(state.updated_at)});
      }
      if(path==='/api/import/preview'&&method==='POST'){
        const p=previewSnapshot(bodyOf(req).state);return reply(res,200,{counts:p.counts,dataVersion:p.dataVersion});
      }
      if(path==='/api/import/commit'&&method==='POST'){
        const b=bodyOf(req),revision=expectedRevision(b.expectedRevision),p=previewSnapshot(b.state),tx=await db.transaction('write');
        try{
          const current=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0];
          if(Number(current.revision)!==revision){await tx.rollback();return reply(res,409,{error:'revision_conflict',currentRevision:Number(current.revision)})}
          if(revision>0&&b.replace!==true){await tx.rollback();return reply(res,409,{error:'replacement_requires_explicit_choice'})}
          await tx.execute({sql:'INSERT INTO field_state_versions(revision,document,action,actor_id,created_at) VALUES(?,?,?,?,?)',args:[revision,current.document,'before_import',user.id,now]});
          const changed=await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1 AND revision=?',args:[JSON.stringify(p.document),now,revision]});
          if(Number(changed.rowsAffected)!==1)throw new Error('revision_conflict');
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'state_import',JSON.stringify({previousRevision:revision,counts:p.counts}),now]});
          await tx.commit();return reply(res,200,{revision:revision+1,counts:p.counts});
        }catch(e){await tx.rollback().catch(()=>{});if(e.message==='revision_conflict')return reply(res,409,{error:'revision_conflict'});throw e}
      }
      return reply(res,404,{error:'not_found'});
    }catch(e){const input=String(e.message||'').startsWith('invalid_');return reply(res,e.status||(input?400:500),{error:e.status||input?e.message:'server_error'})}
  };
}
