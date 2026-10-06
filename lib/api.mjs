import {notifyKitchenPayment} from './line-kitchen.mjs';
import {beginWriteTransaction} from './transactions.mjs';
import {randomUUID} from 'node:crypto';
import {digest,newToken,hashPassword,verifyPassword,validUsername,validPassword,normalizePermissions,mayView} from './security.mjs';
import {previewSnapshot,expectedRevision} from './migration.mjs';
import {handleStockApi} from './stock-api.mjs';
import {normalizePurchaseUrl} from './stock-service.mjs';
import {calculateReceivedQuantity} from './domain/stock-units.mjs';
import {checkoutPos,queuePosAction,getQueueSnapshot,startSplitPayment,paySplitPayment,getSplitPaymentStatus,getSplitPaymentProviderContext,listSplitPaymentSessions,cancelSplitPayment,resolveSplitPayment,voidSale,refundSale,getPosRequestReplay} from './pos-api.mjs';
import {promptPayConfig,createPromptPayCharge,getPromptPayCharge,verifyPromptPayWebhook} from './payment-promptpay.mjs';
import {bangkokDate} from './time.mjs';
import {expenseBreakdown,profitSummary,cashExpenseTotal,inventoryValuation} from './domain/finance.mjs';
import {reconcileCash} from './domain/cash-reconciliation.mjs';
import {safeAuditDetails} from './domain/audit.mjs';
import {buildOperationalAnalytics} from './domain/operational-analytics.mjs';
import {buildPosAvailability} from './domain/availability.mjs';
import {normalizeMenuImageUpload} from './domain/menu-image.mjs';
import {buildMenuCostRows,comparePurchaseSources,assessSalesCostQuality} from './domain/cost-center.mjs';
import {ingredientCostPolicy} from './domain/costing.mjs';
import {findApprovedRecipeDrift,applyApprovedRecipeUpdate} from './domain/approved-recipes.mjs';
import {getMenuStructure,validateMenuStructure,applyMenuStructure,prepBaseState} from './domain/menu-structure.mjs';
import {applyPurchaseReversal} from './domain/purchase-reversal.mjs';
import {findPurchaseExpense,removePurchaseExpense} from './domain/purchase-expense-link.mjs';
import {buildFullBackup,validateFullBackup,FULL_BACKUP_TABLES} from './full-backup.mjs';
const SESSION_MS=12*60*60*1000;
const reply=(res,status,body,extra={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra});res.end(JSON.stringify(body))};
const binaryReply=(res,status,body,mimeType)=>{res.writeHead(status,{'Content-Type':mimeType,'Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff'});res.end(body)};
const one=async(db,sql,args=[])=>{const r=await db.execute({sql,args});return r.rows[0]};
const asUser=row=>({id:row.id,username:row.username,role:row.role,permissions:JSON.parse(row.permissions||'{}')});
const cookie=req=>String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('field_session='))?.slice(14)||'';
const writeMethods=new Set(['POST','PATCH','PUT','DELETE']);
const BACKUP_COLUMNS=Object.freeze({
  posRequests:['request_key','response','created_at','request_hash'],
  stockTransactions:['id','ingredient_id','tx_type','qty_delta','unit','reference_type','reference_id','request_key','reason','actor_id','created_at'],
  purchaseRecords:['id','stock_transaction_id','ingredient_id','supplier','purchased_at','package_qty','package_unit','quantity_received','usage_unit','total_cost','unit_cost','source_url','image_url','note','created_by','created_at','pack_size','pack_size_unit','conversion_approximate','payment_method'],
  costSnapshots:['id','sale_id','order_id','order_item_id','menu_id','recipe_version','standard_cost','document','created_at'],
  recipeVersions:['id','menu_id','version','status','document','created_by','created_at'],
  costHistory:['id','ingredient_id','purchase_record_id','unit_cost','cost_status','effective_date','source_type','supplier','package_qty','package_unit','confirmed_by','confirmed_at','created_at'],
  menuImages:['menu_id','mime_type','data_url','updated_by','updated_at']
});
async function insertBackupRows(tx,key,rows){const table=FULL_BACKUP_TABLES[key],columns=BACKUP_COLUMNS[key];for(const row of rows){await tx.execute({sql:`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`,args:columns.map(c=>row[c]??null)})}}
function bodyOf(req){const b=req.body;if(!b||typeof b!=='object'||Array.isArray(b))throw Object.assign(new Error('invalid_json'),{status:400});return b}
function pathOf(req){const route=req.query?.route;return '/api/'+(Array.isArray(route)?route.join('/'):String(route||'').replace(/^\/+/,''))}
export function createApi({db,origin}){
  return async(req,res)=>{
    try{
      const path=pathOf(req),method=req.method,now=Date.now();
      if(path==='/api/health'&&method==='GET'){await one(db,'SELECT 1 AS ok');return reply(res,200,{ok:true,storage:'turso'})}
      const signedPaymentWebhook=path==='/api/payments/promptpay/webhook';
      if(writeMethods.has(method)&&!signedPaymentWebhook&&req.headers.origin!==origin)return reply(res,403,{error:'origin_denied'});
      if(path==='/api/auth/login'&&method==='POST'){
        const b=bodyOf(req),username=String(b.username||'').trim().toLowerCase(),password=String(b.password||'');
        if(!validUsername(username)||!password||password.length>128)return reply(res,401,{error:'invalid_credentials'});
        const row=await one(db,'SELECT * FROM field_users WHERE username=?',[username]);
        if(!row||!row.active)return reply(res,401,{error:'invalid_credentials'});
        if(Number(row.locked_until)>now)return reply(res,401,{error:'invalid_credentials'});
        if(!await verifyPassword(password,row.password_hash)){
          await db.execute({sql:'UPDATE field_users SET failed_count=failed_count+1,locked_until=CASE WHEN failed_count>=4 THEN ? ELSE locked_until END WHERE id=?',args:[now+5*60*1000,row.id]});
          return reply(res,401,{error:'invalid_credentials'});
        }
        await db.execute({sql:'UPDATE field_users SET failed_count=0,locked_until=0 WHERE id=?',args:[row.id]});
        const token=newToken(),csrf=newToken();
        await db.execute({sql:'INSERT INTO field_sessions(token_hash,user_id,csrf_token,expires_at) VALUES(?,?,?,?)',args:[digest(token),row.id,csrf,now+SESSION_MS]});
        return reply(res,200,{user:asUser(row),csrf},{'Set-Cookie':`field_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${SESSION_MS/1000}`});
      }
      if(path==='/api/payments/promptpay/webhook'&&method==='POST'){
        try{
          const verified=await verifyPromptPayWebhook(bodyOf(req),{rawBody:req.rawBody||'',headers:req.headers||{}});
          const charge=verified?.charge;
          if(!charge?.chargeId||!charge?.referenceId||!String(charge.referenceId).startsWith('split-'))return reply(res,200,verified);
          const live=await getPromptPayCharge(charge.chargeId);
          if(String(live.referenceId||'')!==String(charge.referenceId))return reply(res,409,{error:'promptpay_reference_mismatch'});
          const ctx=await getSplitPaymentProviderContext({db,sessionId:String(charge.referenceId)});
          if(ctx.status==='completed'){
            if(!live.paid||live.currency!=='THB'||Math.round(Number(live.amount)*100)!==Math.round(Number(ctx.total)*100))return reply(res,409,{error:'promptpay_amount_mismatch'});
            await notifyKitchenPayment(db,{sessionId:ctx.id,orderId:ctx.orderId,queueNo:ctx.queueNo,total:ctx.total});
            return reply(res,200,{ok:true,eventType:verified.eventType,alreadyCompleted:true,sessionId:ctx.id,orderId:ctx.orderId,queueNo:ctx.queueNo});
          }
          if(verified.eventType==='charge.succeeded'){
            if(!live.paid)return reply(res,409,{error:'promptpay_not_verified'});
            if(live.currency!=='THB'||Math.round(Number(live.amount)*100)!==Math.round(Number(ctx.total)*100))return reply(res,409,{error:'promptpay_amount_mismatch'});
            if(ctx.status!=='collecting')return reply(res,409,{error:'split_session_unavailable'});
            const result=await paySplitPayment({
              db,user:{id:ctx.createdBy},
              body:{
                requestKey:'provider:'+String(live.provider||'beam')+':'+String(live.chargeId),
                sessionId:ctx.id,method:'promptpay',allocations:ctx.allocations,
                paymentReference:live.chargeId,paymentVerified:live.chargeId,paymentProviderAmount:live.amount,
                label:'PromptPay'
              },now
            });
            if(result.completed)await notifyKitchenPayment(db,{sessionId:ctx.id,orderId:result.orderId,queueNo:result.queueNo,total:ctx.total});
            return reply(res,200,{ok:true,eventType:verified.eventType,finalized:!!result.completed,sessionId:ctx.id,orderId:result.orderId||null,queueNo:result.queueNo||null});
          }
          if(verified.eventType==='charge.failed'&&ctx.status==='collecting'){
            try{
              await cancelSplitPayment({db,user:{id:ctx.createdBy},body:{requestKey:'provider-fail:'+String(charge.chargeId),sessionId:ctx.id},now});
              return reply(res,200,{ok:true,eventType:verified.eventType,released:true,sessionId:ctx.id});
            }catch(e){
              if(e?.message==='split_session_unavailable')return reply(res,200,{ok:true,eventType:verified.eventType,released:false,sessionId:ctx.id});
              throw e;
            }
          }
          return reply(res,200,verified);
        }
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
        const purchases=await db.execute('SELECT id,stock_transaction_id,ingredient_id,supplier,purchased_at,package_qty,package_unit,quantity_received,usage_unit,total_cost,unit_cost,source_url,image_url,note,created_at,pack_size,pack_size_unit,conversion_approximate,payment_method FROM field_purchase_records ORDER BY created_at DESC LIMIT 500');
        const byIngredient={},cancelledPurchases=doc.cancelledPurchases&&typeof doc.cancelledPurchases==='object'?doc.cancelledPurchases:{};
        for(const p of purchases.rows){
          const id=String(p.ingredient_id),ingredient=doc.ingredients?.[id],resetAt=Number(ingredient?.historyResetAt)||0;
          if(Number(p.created_at)<resetAt)continue;
          if(!byIngredient[id])byIngredient[id]=[];
          if(byIngredient[id].length<8){const cancel=cancelledPurchases[String(p.id)]||null;byIngredient[id].push({
            id:String(p.id),stockTransactionId:String(p.stock_transaction_id),supplier:String(p.supplier||''),purchaseDate:String(p.purchased_at||''),
            packageQty:p.package_qty==null?null:Number(p.package_qty),packageUnit:String(p.package_unit||''),packSize:p.pack_size==null?null:Number(p.pack_size),packSizeUnit:String(p.pack_size_unit||''),
            quantityReceived:Number(p.quantity_received)||0,usageUnit:String(p.usage_unit||ingredient?.unit||'g'),totalCost:Number(p.total_cost)||0,unitCost:Number(p.unit_cost)||0,
            sourceUrl:String(p.source_url||''),imageUrl:String(p.image_url||''),note:String(p.note||''),createdAt:Number(p.created_at)||0,conversionApproximate:!!Number(p.conversion_approximate||0),paymentMethod:String(p.payment_method||'bank'),
            cancelled:!!cancel,cancelledAt:Number(cancel?.cancelledAt)||null,cancelReason:String(cancel?.reason||'')
          })}
        }
        const ingredients=Object.entries(doc.ingredients||{}).map(([id,x])=>{const policy=ingredientCostPolicy(x,id);return {
          id,name:String(x.name||id),qty:Number(x.qty)||0,unit:String(x.unit||'g'),archived:!!x.archived,archivedAt:Number(x.archivedAt)||null,
          safetyStock:Number(x.safetyStock??x.minQty??0)||0,unitCost:Number(x.unitCost)||0,costStatus:String(x.costStatus||(Number(x.unitCost)>0?'CONFIRMED':'MISSING')),
          costKind:policy.kind,wasteMargin:policy.wasteMargin,historyResetAt:Number(x.historyResetAt)||0,
          purchaseProfile:x.purchaseProfile&&typeof x.purchaseProfile==='object'?x.purchaseProfile:null,recentPurchases:byIngredient[id]||[]
        }}).sort((a,b)=>Number(a.archived)-Number(b.archived)||a.name.localeCompare(b.name));
        const recent=await db.execute('SELECT id,ingredient_id,tx_type,qty_delta,unit,reference_type,reference_id,reason,actor_id,created_at FROM field_stock_transactions ORDER BY created_at DESC LIMIT 100');
        return reply(res,200,{revision:Number(state.revision)||0,ingredients:ingredients.map(x=>({...x,lowStock:!x.archived&&x.safetyStock>0&&x.qty<=x.safetyStock})),transactions:recent.rows.map(x=>({
          id:String(x.id),ingredientId:String(x.ingredient_id),type:String(x.tx_type),qtyDelta:Number(x.qty_delta),unit:String(x.unit),referenceType:x.reference_type||null,referenceId:x.reference_id||null,reason:String(x.reason||''),createdBy:x.actor_id||null,createdAt:Number(x.created_at)
        }))});
      }
      if(path==='/api/stock/ingredients'&&method==='POST'){
        if(user.role!=='admin')return reply(res,403,{error:'admin_required'});
        const b=bodyOf(req),name=String(b.name||'').trim(),unit=String(b.unit||'').trim().toLowerCase(),safetyStock=Number(b.safetyStock||0);
        if(name.length<2||name.length>120||!['g','ml','piece','serve'].includes(unit)||!Number.isFinite(safetyStock)||safetyStock<0||safetyStock>1e9)return reply(res,400,{error:'invalid_ingredient'});
        const tx=await beginWriteTransaction(db);
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}');
          if(!doc.ingredients||typeof doc.ingredients!=='object')doc.ingredients={};
          const id='ing-'+randomUUID(),ingredient={name,unit,qty:0,safetyStock,unitCost:0,costStatus:'MISSING',costKind:String(b.costKind||'other'),wasteMargin:0,archived:false,createdAt:now,createdBy:user.id};
          doc.ingredients[id]=ingredient;
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'stock_ingredient_create',JSON.stringify({id,name,unit}),now]});
          await tx.commit();return reply(res,201,{ok:true,ingredient:{id,...ingredient,recentPurchases:[]}});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      const stockIngredientMatch=path.match(/^\/api\/stock\/ingredients\/([^/]+)$/);
      const stockIngredientActionMatch=path.match(/^\/api\/stock\/ingredients\/([^/]+)\/(archive|restore|reset)$/);
      const stockIngredientPurgeMatch=path.match(/^\/api\/stock\/ingredients\/([^/]+)\/purge$/);
      if(stockIngredientMatch&&method==='PATCH'){
        if(user.role!=='admin')return reply(res,403,{error:'admin_required'});
        const id=decodeURIComponent(stockIngredientMatch[1]),b=bodyOf(req);
        const safetyStock=b.safetyStock===undefined?undefined:Number(b.safetyStock),name=b.name===undefined?undefined:String(b.name||'').trim(),unit=b.unit===undefined?undefined:String(b.unit||'').trim().toLowerCase();
        const costKind=b.costKind===undefined?undefined:String(b.costKind||'').trim().toLowerCase(),wasteMargin=b.wasteMargin===undefined?undefined:Number(b.wasteMargin);
        if(name!==undefined&&(name.length<2||name.length>120))return reply(res,400,{error:'invalid_ingredient_name'});
        if(unit!==undefined&&!['g','ml','piece','serve'].includes(unit))return reply(res,400,{error:'invalid_ingredient_unit'});
        if(safetyStock!==undefined&&(!Number.isFinite(safetyStock)||safetyStock<0||safetyStock>1e9))return reply(res,400,{error:'invalid_safety_stock'});
        if(costKind!==undefined&&!['other','powder','milk','water','syrup','concentrate'].includes(costKind))return reply(res,400,{error:'invalid_cost_kind'});
        if(wasteMargin!==undefined&&(!Number.isFinite(wasteMargin)||wasteMargin<0||wasteMargin>.5))return reply(res,400,{error:'invalid_waste_margin'});
        if(b.unitCost!==undefined)return reply(res,409,{error:'cost_update_requires_purchase_record'});
        if(name===undefined&&unit===undefined&&safetyStock===undefined&&costKind===undefined&&wasteMargin===undefined)return reply(res,400,{error:'no_stock_fields'});
        const tx=await beginWriteTransaction(db);
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}'),ingredient=doc.ingredients?.[id];
          if(!ingredient){await tx.rollback();return reply(res,404,{error:'ingredient_missing'})}
          if(name!==undefined)ingredient.name=name;
          if(unit!==undefined&&unit!==String(ingredient.unit||'g')){
            const referenced=(doc.menu||[]).some(m=>!m.archived&&(m.variants||[]).some(v=>Number(v.recipe?.items?.[id])>0));
            if(Number(ingredient.qty||0)!==0){await tx.rollback();return reply(res,409,{error:'unit_change_requires_zero_stock'})}
            if(referenced){await tx.rollback();return reply(res,409,{error:'unit_change_recipe_in_use'})}
            ingredient.unit=unit;ingredient.purchaseProfile=null;
          }
          if(safetyStock!==undefined)ingredient.safetyStock=safetyStock;
          if(costKind!==undefined)ingredient.costKind=costKind;
          if(wasteMargin!==undefined)ingredient.wasteMargin=['syrup','concentrate'].includes(String((costKind??ingredient.costKind)||''))?wasteMargin:0;
          if(costKind!==undefined&&!['syrup','concentrate'].includes(costKind))ingredient.wasteMargin=0;
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'stock_ingredient_update',JSON.stringify({id,name,unit,safetyStock,costKind,wasteMargin:ingredient.wasteMargin}),now]});
          await tx.commit();return reply(res,200,{ok:true});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      if(stockIngredientActionMatch&&method==='POST'){
        if(user.role!=='admin')return reply(res,403,{error:'admin_required'});
        const id=decodeURIComponent(stockIngredientActionMatch[1]),action=stockIngredientActionMatch[2],b=bodyOf(req),tx=await beginWriteTransaction(db);
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}'),ingredient=doc.ingredients?.[id];
          if(!ingredient){await tx.rollback();return reply(res,404,{error:'ingredient_missing'})}
          if(action==='archive'){
            const refs=(doc.menu||[]).filter(m=>!m.archived).flatMap(m=>(m.variants||[]).filter(v=>Number(v.recipe?.items?.[id])>0).map(v=>m.name+' · '+(v.label||'Standard')));
            if(refs.length){await tx.rollback();return reply(res,409,{error:'ingredient_in_use',references:refs.slice(0,20)})}
            ingredient.archived=true;ingredient.archivedAt=now;ingredient.archivedBy=user.id;
          }else if(action==='restore'){
            ingredient.archived=false;ingredient.archivedAt=null;ingredient.restoredAt=now;ingredient.restoredBy=user.id;
          }else{
            if(String(b.confirm||'')!=='RESET'){await tx.rollback();return reply(res,400,{error:'reset_confirmation_required'})}
            const oldQty=Number(ingredient.qty)||0;
            await tx.execute({sql:'INSERT INTO field_state_versions(revision,document,action,actor_id,created_at) VALUES(?,?,?,?,?)',args:[Number(state.revision)||0,state.document,'before_ingredient_test_reset',user.id,now]});
            if(oldQty!==0)await tx.execute({sql:'INSERT INTO field_stock_transactions(id,ingredient_id,tx_type,qty_delta,unit,reference_type,reference_id,request_key,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',args:['stx_'+randomUUID(),id,'ADJUSTMENT',-oldQty,String(ingredient.unit||'g'),'TEST_RESET',id,'reset:'+id+':'+now,'Reset experimental stock balance',user.id,now]});
            ingredient.qty=0;ingredient.unitCost=0;ingredient.costStatus='MISSING';ingredient.purchaseProfile=null;ingredient.historyResetAt=now;
          }
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'stock_ingredient_'+action,JSON.stringify({id}),now]});
          await tx.commit();return reply(res,200,{ok:true,action});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      if(stockIngredientPurgeMatch&&method==='DELETE'){
        if(user.role!=='admin')return reply(res,403,{error:'admin_required'});
        const id=decodeURIComponent(stockIngredientPurgeMatch[1]),b=bodyOf(req),detachRecipes=b.detachRecipes===true;
        if(String(b.confirm||'')!=='DELETE INGREDIENT')return reply(res,400,{error:'ingredient_purge_confirmation_required'});
        const tx=await beginWriteTransaction(db);
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}'),ingredient=doc.ingredients?.[id];
          if(!ingredient){await tx.rollback();return reply(res,404,{error:'ingredient_missing'})}
          if(Math.abs(Number(ingredient.qty||0))>1e-9){await tx.rollback();return reply(res,409,{error:'ingredient_purge_requires_zero_stock',qty:Number(ingredient.qty)||0,unit:String(ingredient.unit||'')})}
          const purchaseRows=(await tx.execute({sql:'SELECT id FROM field_purchase_records WHERE ingredient_id=? ORDER BY created_at DESC LIMIT 500',args:[id]})).rows;
          const activePurchases=purchaseRows.filter(x=>!doc.cancelledPurchases?.[String(x.id)]);
          if(activePurchases.length){await tx.rollback();return reply(res,409,{error:'ingredient_purge_active_purchase',count:activePurchases.length})}
          const refs=[];
          for(const menu of doc.menu||[])for(const variant of menu.variants||[])if(Number(variant.recipe?.items?.[id])>0)refs.push({menu,variant});
          if(refs.length&&!detachRecipes){await tx.rollback();return reply(res,409,{error:'ingredient_in_use',references:refs.slice(0,20).map(x=>x.menu.name+' · '+(x.variant.label||'Standard'))})}
          if(detachRecipes){
            for(const {menu,variant} of refs){
              const items={...(variant.recipe?.items||{})};delete items[id];
              if(!Object.keys(items).length){await tx.rollback();return reply(res,409,{error:'ingredient_purge_would_empty_recipe',menuId:menu.id,menuName:menu.name,variant:variant.label||'Standard'})}
            }
          }
          await tx.execute({sql:'INSERT INTO field_state_versions(revision,document,action,actor_id,created_at) VALUES(?,?,?,?,?)',args:[Number(state.revision)||0,state.document,'before_ingredient_purge',user.id,now]});
          const detached=[];
          if(detachRecipes){
            const nextVersionByMenu=new Map();
            for(const {menu,variant} of refs){
              let next=nextVersionByMenu.get(menu.id);
              if(next===undefined){const row=(await tx.execute({sql:'SELECT COALESCE(MAX(version),0) AS v FROM field_recipe_versions WHERE menu_id=?',args:[menu.id]})).rows[0];next=Number(row?.v||0)+1}
              const items={...(variant.recipe?.items||{})};delete items[id];
              const version=next;nextVersionByMenu.set(menu.id,version+1);
              const versionId='rv_'+randomUUID(),variantLabel=String(variant.label||'Standard');
              const document={menuId:menu.id,menuName:menu.name,variant:variantLabel,items,changeReason:'ingredient_purge',removedIngredient:{id,name:String(ingredient.name||id)}};
              await tx.execute({sql:'INSERT INTO field_recipe_versions(id,menu_id,version,status,document,created_by,created_at) VALUES(?,?,?,?,?,?,?)',args:[versionId,menu.id,version,'active',JSON.stringify(document),user.id,now]});
              variant.recipe={items};variant.recipeVersion=version;
              detached.push({menuId:menu.id,menuName:menu.name,variant:variantLabel,version});
            }
          }
          const name=String(ingredient.name||id);delete doc.ingredients[id];
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'stock_ingredient_purge',JSON.stringify({id,name,detachedRecipes:detached,historyPreserved:true}),now]});
          await tx.commit();return reply(res,200,{ok:true,id,name,detachedRecipes:detached,historyPreserved:true});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      const purchaseEditMatch=path.match(/^\/api\/stock\/purchases\/([^/]+)$/);
      if(purchaseEditMatch&&method==='PATCH'){
        if(user.role!=='admin')return reply(res,403,{error:'admin_required'});
        const id=decodeURIComponent(purchaseEditMatch[1]),b=bodyOf(req),tx=await beginWriteTransaction(db);
        try{
          const p=(await tx.execute({sql:'SELECT * FROM field_purchase_records WHERE id=?',args:[id]})).rows[0];
          if(!p){await tx.rollback();return reply(res,404,{error:'purchase_not_found'})}
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}'),ingredient=doc.ingredients?.[String(p.ingredient_id)];
          if(doc.cancelledPurchases?.[id]){await tx.rollback();return reply(res,409,{error:'purchase_already_cancelled'})}
          if(!ingredient){await tx.rollback();return reply(res,404,{error:'ingredient_missing'})}
          if(Number(p.created_at)<Number(ingredient.historyResetAt||0)){await tx.rollback();return reply(res,409,{error:'purchase_before_reset_read_only'})}
          const supplier=b.supplier===undefined?String(p.supplier||''):String(b.supplier||'').trim().slice(0,120);
          const purchaseDate=b.purchaseDate===undefined?String(p.purchased_at):String(b.purchaseDate||'').trim();
          const parsed=Date.parse(purchaseDate+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)||!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,10)!==purchaseDate)return reply(res,400,{error:'invalid_purchase_date'});
          if(purchaseDate>bangkokDate(now))return reply(res,409,{error:'future_purchase_date'});
          if((doc.closes||[]).some(x=>x.date===purchaseDate)){await tx.rollback();return reply(res,409,{error:'purchase_date_closed'})}
          const totalCost=b.totalCost===undefined?Number(p.total_cost):Number(b.totalCost);if(!Number.isFinite(totalCost)||totalCost<0){await tx.rollback();return reply(res,400,{error:'invalid_purchase_cost'})}
          const packageQty=b.packageQty===undefined?(p.package_qty==null?null:Number(p.package_qty)):Number(b.packageQty);
          const packageUnit=b.packageUnit===undefined?String(p.package_unit||''):String(b.packageUnit||'').trim().slice(0,30);
          const packSize=b.packSize===undefined?(p.pack_size==null?null:Number(p.pack_size)):Number(b.packSize);
          const packSizeUnit=b.packSizeUnit===undefined?String(p.pack_size_unit||''):String(b.packSizeUnit||'').trim().slice(0,24);
          let quantityReceived=Number(p.quantity_received),quantityPerPackage=quantityReceived/(Number(p.package_qty)||1),conversionApproximate=!!Number(p.conversion_approximate||0);
          if(packageQty!==null||packSize!==null||packSizeUnit||packageUnit){
            if(!(packageQty>0)||!(packSize>0)||!packSizeUnit||!packageUnit){await tx.rollback();return reply(res,400,{error:'incomplete_purchase_packaging'})}
            try{const calc=calculateReceivedQuantity({packageQty,packSize,packSizeUnit,usageUnit:String(p.usage_unit)});quantityReceived=calc.quantity;quantityPerPackage=calc.quantityPerPackage;conversionApproximate=calc.approximate}catch(e){await tx.rollback();return reply(res,400,{error:e.message})}
          }
          const delta=quantityReceived-Number(p.quantity_received);
          if(Number(ingredient.qty||0)+delta<0){await tx.rollback();return reply(res,409,{error:'purchase_correction_stock_negative'})}
          let sourceUrl='',imageUrl='';try{sourceUrl=b.sourceUrl===undefined?String(p.source_url||''):normalizePurchaseUrl(b.sourceUrl);imageUrl=b.imageUrl===undefined?String(p.image_url||''):normalizePurchaseUrl(b.imageUrl)}catch(e){await tx.rollback();return reply(res,400,{error:e.message})}
          const paymentMethod=b.paymentMethod===undefined?String(p.payment_method||'bank'):String(b.paymentMethod||'').trim().toLowerCase();
          if(!['cash','bank','other'].includes(paymentMethod)){await tx.rollback();return reply(res,400,{error:'invalid_purchase_payment_method'})}
          const note=b.note===undefined?String(p.note||''):String(b.note||'').trim().slice(0,500),unitCost=totalCost/quantityReceived;
          await tx.execute({sql:'UPDATE field_purchase_records SET supplier=?,purchased_at=?,package_qty=?,package_unit=?,quantity_received=?,total_cost=?,unit_cost=?,source_url=?,image_url=?,note=?,pack_size=?,pack_size_unit=?,conversion_approximate=?,payment_method=? WHERE id=?',args:[supplier,purchaseDate,packageQty,packageUnit,quantityReceived,totalCost,unitCost,sourceUrl,imageUrl,note,packSize,packSizeUnit,conversionApproximate?1:0,paymentMethod,id]});
          await tx.execute({sql:'UPDATE field_stock_transactions SET qty_delta=? WHERE id=?',args:[quantityReceived,String(p.stock_transaction_id)]});
          await tx.execute({sql:'UPDATE field_cost_history SET unit_cost=?,effective_date=?,supplier=?,package_qty=?,package_unit=?,cost_status=?,confirmed_by=?,confirmed_at=? WHERE purchase_record_id=?',args:[unitCost,purchaseDate,supplier,packageQty,packageUnit,'CONFIRMED',user.id,now,id]});
          ingredient.qty=Number(ingredient.qty||0)+delta;
          const purchaseTxLink=(await tx.execute({sql:'SELECT reference_id FROM field_stock_transactions WHERE id=?',args:[String(p.stock_transaction_id)]})).rows[0]||{};
          const expense=findPurchaseExpense(doc.expenses||[],p,purchaseTxLink);if(expense){expense.amount=totalCost;expense.date=purchaseDate;expense.qty=quantityReceived;expense.description='Purchase '+(ingredient.name||p.ingredient_id);expense.paymentMethod=paymentMethod;expense.sourceType='STOCK_PURCHASE';expense.stockTransactionId=String(p.stock_transaction_id);expense.purchaseRecordId=id}
          const latestRows=(await tx.execute({sql:'SELECT id FROM field_purchase_records WHERE ingredient_id=? AND created_at>=? ORDER BY created_at DESC LIMIT 200',args:[String(p.ingredient_id),Number(ingredient.historyResetAt||0)]})).rows;
          const latest=latestRows.find(x=>!doc.cancelledPurchases?.[String(x.id)])||null;
          if(String(latest?.id||'')===id){ingredient.unitCost=unitCost;ingredient.costStatus='CONFIRMED';ingredient.purchaseProfile={packageUnit,packSize,packSizeUnit,quantityPerPackage,usageUnit:String(p.usage_unit),conversionApproximate,supplier,sourceUrl,imageUrl,purchaseCost:totalCost,purchaseDate,note,paymentMethod,updatedAt:now}}
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'stock_purchase_update',JSON.stringify({id,ingredientId:p.ingredient_id,totalCost,purchaseDate,supplier,paymentMethod,oldQuantity:Number(p.quantity_received),newQuantity:quantityReceived,delta}),now]});
          await tx.commit();return reply(res,200,{ok:true,id,totalCost,unitCost,quantityReceived,delta});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      const purchaseCancelMatch=path.match(/^\/api\/stock\/purchases\/([^/]+)\/cancel$/);
      if(purchaseCancelMatch&&method==='POST'){
        if(user.role!=='admin')return reply(res,403,{error:'admin_required'});
        const id=decodeURIComponent(purchaseCancelMatch[1]),b=bodyOf(req),reason=String(b.reason||'').trim().slice(0,300);
        if(String(b.confirm||'')!=='CANCEL PURCHASE')return reply(res,400,{error:'purchase_cancel_confirmation_required'});
        if(reason.length<2)return reply(res,400,{error:'purchase_cancel_reason_required'});
        const tx=await beginWriteTransaction(db);
        try{
          const p=(await tx.execute({sql:'SELECT * FROM field_purchase_records WHERE id=?',args:[id]})).rows[0];
          if(!p){await tx.rollback();return reply(res,404,{error:'purchase_not_found'})}
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}'),ingredientId=String(p.ingredient_id),ingredient=doc.ingredients?.[ingredientId];
          if(!ingredient){await tx.rollback();return reply(res,404,{error:'ingredient_missing'})}
          if(doc.cancelledPurchases?.[id]){await tx.rollback();return reply(res,409,{error:'purchase_already_cancelled'})}
          if(Number(p.created_at)<Number(ingredient.historyResetAt||0)){await tx.rollback();return reply(res,409,{error:'purchase_before_reset_read_only'})}
          if((doc.closes||[]).some(x=>x.date===String(p.purchased_at))){await tx.rollback();return reply(res,409,{error:'purchase_date_closed'})}
          const purchaseTx=(await tx.execute({sql:'SELECT created_at,reference_id FROM field_stock_transactions WHERE id=? AND ingredient_id=?',args:[String(p.stock_transaction_id),ingredientId]})).rows[0];
          if(!purchaseTx){await tx.rollback();return reply(res,409,{error:'purchase_stock_transaction_missing'})}
          const laterMovement=(await tx.execute({sql:"SELECT id,tx_type,created_at FROM field_stock_transactions WHERE ingredient_id=? AND created_at>? AND tx_type<>'PURCHASE' ORDER BY created_at ASC LIMIT 1",args:[ingredientId,Number(purchaseTx.created_at)||0]})).rows[0];
          if(laterMovement){await tx.rollback();return reply(res,409,{error:'purchase_cancel_has_later_movement',movementType:String(laterMovement.tx_type||''),movementAt:Number(laterMovement.created_at)||0})}
          const rows=(await tx.execute({sql:'SELECT * FROM field_purchase_records WHERE ingredient_id=? AND created_at>=? ORDER BY created_at DESC LIMIT 200',args:[ingredientId,Number(ingredient.historyResetAt||0)]})).rows;
          const cancelled=doc.cancelledPurchases&&typeof doc.cancelledPurchases==='object'?doc.cancelledPurchases:{};
          const previous=rows.find(x=>String(x.id)!==id&&!cancelled[String(x.id)])||null;
          let reversal;
          try{reversal=applyPurchaseReversal({ingredient,purchase:p,previousPurchase:previous})}
          catch(e){await tx.rollback();return reply(res,409,{error:String(e.message||'purchase_cancel_failed'),available:Number(ingredient.qty)||0,required:Number(p.quantity_received)||0})}
          await tx.execute({sql:'INSERT INTO field_state_versions(revision,document,action,actor_id,created_at) VALUES(?,?,?,?,?)',args:[Number(state.revision)||0,state.document,'before_purchase_cancel',user.id,now]});
          doc.ingredients[ingredientId]=reversal.ingredient;
          const expenseRemoval=removePurchaseExpense(doc.expenses||[],p,purchaseTx);doc.expenses=expenseRemoval.expenses;
          await tx.execute({sql:'DELETE FROM field_cost_history WHERE purchase_record_id=?',args:[id]});
          if(!doc.cancelledPurchases||typeof doc.cancelledPurchases!=='object')doc.cancelledPurchases={};
          doc.cancelledPurchases[id]={cancelledAt:now,cancelledBy:user.id,reason,stockTransactionId:String(p.stock_transaction_id),ingredientId,quantityReceived:Number(p.quantity_received)||0,totalCost:Number(p.total_cost)||0};
          const reversalId='stx_'+randomUUID();
          await tx.execute({sql:'INSERT INTO field_stock_transactions(id,ingredient_id,tx_type,qty_delta,unit,reference_type,reference_id,request_key,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',args:[reversalId,ingredientId,'PURCHASE_REVERSAL',reversal.stockDelta,String(p.usage_unit||ingredient.unit||'g'),'PURCHASE_CANCEL',id,'purchase-cancel:'+id,'Cancel purchase: '+reason,user.id,now]});
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'stock_purchase_cancel',JSON.stringify({id,ingredientId,stockTransactionId:p.stock_transaction_id,reversalId,quantityReceived:Number(p.quantity_received)||0,totalCost:Number(p.total_cost)||0,reason,restoredPurchaseId:reversal.restoredPurchaseId,stockChanged:true,purchaseSpendChanged:!!expenseRemoval.removed,expenseId:expenseRemoval.removed?.id||null,costHistoryRemoved:true}),now]});
          await tx.commit();return reply(res,200,{ok:true,id,reversalId,stockDelta:reversal.stockDelta,totalCost:Number(p.total_cost)||0,restoredPurchaseId:reversal.restoredPurchaseId});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      if(path==='/api/stock/transactions'&&method==='POST'){
        const stockResponse=await handleStockApi({path,method,user,db,body:bodyOf(req),now});
        return reply(res,stockResponse.status,stockResponse.body);
      }
      if(path==='/api/stock/cycle-count'&&method==='POST'){
        if(user.role!=='admin'&&!mayView({...user,active:true},'stock'))return reply(res,403,{error:'stock_permission_required'});
        const b=bodyOf(req),requestKey=String(b.requestKey||''),counts=Array.isArray(b.counts)?b.counts:[];
        if(b.confirm!==true)return reply(res,400,{error:'cycle_count_requires_confirmation'});
        if(!/^[A-Za-z0-9._:-]{8,128}$/.test(requestKey)||!counts.length||counts.length>500)return reply(res,400,{error:'invalid_cycle_count'});
        const tx=await beginWriteTransaction(db);
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}');
          if(!doc.cycleCountKeys||typeof doc.cycleCountKeys!=='object')doc.cycleCountKeys={};
          if(doc.cycleCountKeys[requestKey]){const old=doc.cycleCountKeys[requestKey];await tx.rollback();return reply(res,200,{...old,replayed:true})}
          const seen=new Set(),adjustments=[];
          for(const row of counts){const id=String(row?.ingredientId||''),counted=Number(row?.countedQty);if(!id||seen.has(id)||!Number.isFinite(counted)||counted<0||!doc.ingredients?.[id])throw Object.assign(new Error('invalid_cycle_count'),{status:400});seen.add(id);const expected=Number(doc.ingredients[id].qty||0),variance=counted-expected;adjustments.push({ingredientId:id,expectedQty:expected,countedQty:counted,variance,unit:String(doc.ingredients[id].unit||'g')})}
          const cycleId='count_'+randomUUID();
          for(const a of adjustments){doc.ingredients[a.ingredientId].qty=a.countedQty;if(a.variance!==0)await tx.execute({sql:'INSERT INTO field_stock_transactions(id,ingredient_id,tx_type,qty_delta,unit,reference_type,reference_id,request_key,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',args:['stx_'+randomUUID(),a.ingredientId,'ADJUSTMENT',a.variance,a.unit,'CYCLE_COUNT',cycleId,requestKey+':'+a.ingredientId,'Daily cycle count',user.id,now]})}
          if(!Array.isArray(doc.cycleCounts))doc.cycleCounts=[];
          const record={id:cycleId,date:bangkokDate(now),time:now,createdBy:user.id,adjustments};doc.cycleCounts.push(record);
          const response={ok:true,cycleCount:record};doc.cycleCountKeys[requestKey]=response;
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'cycle_count_commit',JSON.stringify({cycleId,requestKey,items:adjustments.length,variances:adjustments.filter(x=>x.variance!==0).length}),now]});
          await tx.commit();return reply(res,201,response);
        }catch(e){await tx.rollback().catch(()=>{});if(e.status)return reply(res,e.status,{error:e.message});throw e}
      }
      if(path==='/api/expenses'&&method==='GET'){
        if(user.role!=='admin'&&!mayView({...user,active:true},'report'))return reply(res,403,{error:'report_permission_required'});
        const state=await one(db,'SELECT revision,document FROM field_state WHERE singleton=1'),doc=JSON.parse(state.document||'{}');
        return reply(res,200,{revision:Number(state.revision)||0,expenses:(Array.isArray(doc.expenses)?doc.expenses:[]).slice().sort((a,b)=>Number(b.time||0)-Number(a.time||0)).slice(0,500)});
      }
      if(path==='/api/expenses'&&method==='POST'){
        if(user.role!=='admin'&&!mayView({...user,active:true},'report'))return reply(res,403,{error:'report_permission_required'});
        const b=bodyOf(req),amount=Number(b.amount),date=String(b.date||bangkokDate(now)),category=String(b.category||'OTHER').trim().slice(0,60),description=String(b.description||'').trim().slice(0,240),paymentMethod=String(b.paymentMethod||'cash').trim().toLowerCase();
        if(!Number.isFinite(amount)||amount<=0||amount>1e7||!/^\d{4}-\d{2}-\d{2}$/.test(date))return reply(res,400,{error:'invalid_expense'});
        const tx=await beginWriteTransaction(db);
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}');
          if((doc.closes||[]).some(x=>x.date===date)){await tx.rollback();return reply(res,409,{error:'day_closed'})}
          if(!Array.isArray(doc.expenses))doc.expenses=[];
          const expense={id:'exp_'+randomUUID(),date,time:now,category,description,amount,paymentMethod,sourceType:'MANUAL',createdBy:user.id};
          doc.expenses.push(expense);
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'expense_create',JSON.stringify({id:expense.id,amount,category,paymentMethod}),now]});
          await tx.commit();return reply(res,201,{ok:true,expense});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      const expenseMatch=path.match(/^\/api\/expenses\/([^/]+)$/);
      if(expenseMatch&&method==='DELETE'){
        if(user.role!=='admin')return reply(res,403,{error:'admin_required'});
        const id=decodeURIComponent(expenseMatch[1]),tx=await beginWriteTransaction(db);
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}'),idx=(doc.expenses||[]).findIndex(x=>x.id===id);
          if(idx<0){await tx.rollback();return reply(res,404,{error:'expense_not_found'})}
          if((doc.closes||[]).some(x=>x.date===doc.expenses[idx].date)){await tx.rollback();return reply(res,409,{error:'day_closed'})}
          if(String(doc.expenses[idx].sourceType||'').startsWith('STOCK_')||['PURCHASE','WASTE'].includes(String(doc.expenses[idx].category||'').toUpperCase())){await tx.rollback();return reply(res,409,{error:'system_expense_read_only'})}
          const [removed]=doc.expenses.splice(idx,1);
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'expense_delete',JSON.stringify({id,amount:removed.amount}),now]});
          await tx.commit();return reply(res,200,{ok:true});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      if(path==='/api/customers'&&method==='GET'){
        if(user.role!=='admin'&&!mayView({...user,active:true},'crm'))return reply(res,403,{error:'crm_permission_required'});
        const state=await one(db,'SELECT revision,document FROM field_state WHERE singleton=1'),doc=JSON.parse(state.document||'{}');
        return reply(res,200,{revision:Number(state.revision)||0,loyalty:{pointsSpend:Number(doc.settings?.pointsSpend)||0,pointsRedeemValue:Number(doc.settings?.pointsRedeemValue)||0},customers:(Array.isArray(doc.customers)?doc.customers:[]).slice().sort((a,b)=>Number(b.lastVisit||0)-Number(a.lastVisit||0))});
      }
      if(path==='/api/customers'&&method==='POST'){
        if(user.role!=='admin'&&!mayView({...user,active:true},'crm'))return reply(res,403,{error:'crm_permission_required'});
        const b=bodyOf(req),name=String(b.name||'').trim().slice(0,120),phone=String(b.phone||'').trim().slice(0,30),lineId=String(b.lineId||'').trim().slice(0,80);
        if(name.length<1)return reply(res,400,{error:'invalid_customer'});
        const tx=await beginWriteTransaction(db);
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
        const id=decodeURIComponent(customerMatch[1]),b=bodyOf(req),tx=await beginWriteTransaction(db);
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
        const today=bangkokDate(now),shift=(Array.isArray(doc.cashShifts)?doc.cashShifts:[]).find(x=>x.date===today)||null;
        return reply(res,200,{revision:Number(state.revision)||0,businessDate:today,shift,closes:(Array.isArray(doc.closes)?doc.closes:[]).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,120)});
      }
      if(path==='/api/cash-shift/open'&&method==='POST'){
        if(user.role!=='admin')return reply(res,403,{error:'admin_required'});
        const b=bodyOf(req),date=bangkokDate(now),openingCash=Number(b.openingCash);
        if(b.openingCash===null||b.openingCash===undefined||String(b.openingCash).trim()===''||!Number.isFinite(openingCash)||openingCash<0||openingCash>1e7)return reply(res,400,{error:'invalid_opening_cash'});
        const tx=await beginWriteTransaction(db);
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}');
          if(!Array.isArray(doc.cashShifts))doc.cashShifts=[];
          if((doc.closes||[]).some(x=>x.date===date)){await tx.rollback();return reply(res,409,{error:'day_already_closed'})}
          if(doc.cashShifts.some(x=>x.date===date)){await tx.rollback();return reply(res,409,{error:'cash_shift_already_opened'})}
          const shift={id:'shift_'+randomUUID(),date,status:'open',openingCash,openedAt:now,openedBy:user.id};
          doc.cashShifts.push(shift);
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'cash_shift_open',JSON.stringify({id:shift.id,date,openingCash}),now]});
          await tx.commit();return reply(res,201,{ok:true,shift,revision:Number(state.revision)+1});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      if(path==='/api/close-day'&&method==='POST'){
        if(user.role!=='admin')return reply(res,403,{error:'admin_required'});
        const b=bodyOf(req),date=String(b.date||bangkokDate(now)),inputOpeningCash=Number(b.openingCash??0),countedCash=Number(b.countedCash);
        if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return reply(res,400,{error:'invalid_date'});
        if(!Number.isFinite(inputOpeningCash)||inputOpeningCash<0||inputOpeningCash>1e7)return reply(res,400,{error:'invalid_opening_cash'});
        if(b.countedCash===null||b.countedCash===undefined||String(b.countedCash).trim()===''||!Number.isFinite(countedCash)||countedCash<0||countedCash>1e7)return reply(res,400,{error:'counted_cash_required'});
        const tx=await beginWriteTransaction(db);
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}');
          if(!Array.isArray(doc.closes))doc.closes=[];
          if(!Array.isArray(doc.cashShifts))doc.cashShifts=[];
          if(doc.closes.some(x=>x.date===date)){await tx.rollback();return reply(res,409,{error:'day_already_closed'})}
          const shift=doc.cashShifts.find(x=>x.date===date&&x.status==='open')||null;
          const openingCash=shift?Number(shift.openingCash)||0:inputOpeningCash;
          if((doc.paymentSessions||[]).some(s=>['collecting','requires_resolution'].includes(s.status)&&s.date===date)){await tx.rollback();return reply(res,409,{error:'close_day_pending_payments'})}
          const saleIdsForDate=new Set((doc.sales||[]).filter(s=>s.date===date&&s.status==='paid').map(s=>s.id));
          const hasOpenOrders=(doc.orders||[]).some(o=>!['returned','void'].includes(String(o.status||''))&&(o.saleIds||[o.saleId]).filter(Boolean).some(id=>saleIdsForDate.has(id)));
          if(hasOpenOrders){await tx.rollback();return reply(res,409,{error:'close_day_open_orders'})}
          const sales=(doc.sales||[]).filter(s=>s.date===date&&s.status==='paid'),expenses=(doc.expenses||[]).filter(e=>e.date===date);
          const revenue=sales.reduce((s,x)=>s+Number(x.total||0),0),cogs=sales.reduce((s,x)=>s+Number(x.costTotal||0),0),finance=profitSummary({revenue,cogs,expenses});
          let cash=0,promptpay=0,other=0;
          for(const sale of sales)for(const p of (sale.payments||[{method:sale.payment,amount:sale.total}])){const amount=Number(p.amount||0);if(p.method==='cash')cash+=amount;else if(p.method==='promptpay')promptpay+=amount;else other+=amount}
          const cashPaidOut=cashExpenseTotal(expenses),reconciliation=reconcileCash({openingCash,cashSales:cash,cashPaidOut,countedCash}),{expectedCash,cashVariance}=reconciliation;
          const close={id:'close_'+randomUUID(),date,time:now,revenue,cogs,expenses:finance.operatingExpenses,purchaseSpend:finance.purchaseSpend,totalCashOut:finance.totalCashOut,grossProfit:finance.grossProfit,operatingProfit:finance.operatingProfit,cash,promptpay,other,openingCash,cashPaidOut,expectedCash,countedCash,cashVariance,orders:sales.length,cups:sales.reduce((s,x)=>s+(x.items||[]).reduce((n,i)=>n+Number(i.qty||0),0),0),closedBy:user.id};
          doc.closes.push(close);
          if(shift){shift.status='closed';shift.closedAt=now;shift.closedBy=user.id;shift.closeId=close.id;shift.countedCash=countedCash;shift.cashVariance=cashVariance}
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'close_day',JSON.stringify({id:close.id,date,revenue,openingCash,cashPaidOut,expectedCash,countedCash,cashVariance,cashShiftId:shift?.id||null,openingCashSource:shift?'SHIFT_OPEN':'CLOSE_INPUT_LEGACY'}),now]});
          await tx.commit();return reply(res,201,{ok:true,close});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      if(path==='/api/management/dashboard'&&method==='GET'){
        if(user.role!=='admin'&&!mayView({...user,active:true},'report'))return reply(res,403,{error:'report_permission_required'});
        const state=await one(db,'SELECT revision,document FROM field_state WHERE singleton=1'),doc=JSON.parse(state.document||'{}');
        const sales=(doc.sales||[]).filter(s=>s.status==='paid'),expenses=doc.expenses||[],ingredients=doc.ingredients||{},today=bangkokDate(now),month=today.slice(0,7);
        const monthSales=sales.filter(s=>String(s.date||'').startsWith(month)),monthExpenses=expenses.filter(e=>String(e.date||'').startsWith(month));
        const revenue=monthSales.reduce((s,x)=>s+Number(x.total||0),0),cogs=monthSales.reduce((s,x)=>s+Number(x.costTotal||0),0),finance=profitSummary({revenue,cogs,expenses:monthExpenses}),inventory=inventoryValuation(ingredients);
        const itemMap={};for(const sale of monthSales)for(const i of sale.items||[]){const k=i.name||i.id;itemMap[k]=(itemMap[k]||0)+Number(i.qty||0)}
        const topItems=Object.entries(itemMap).map(([name,qty])=>({name,qty})).sort((a,b)=>b.qty-a.qty).slice(0,5);
        const lowStock=Object.entries(ingredients).map(([id,x])=>({id,name:x.name||id,qty:Number(x.qty)||0,safetyStock:Number(x.safetyStock??x.minQty??0)||0,unit:x.unit||'g'})).filter(x=>x.safetyStock>0&&x.qty<=x.safetyStock);
        const analytics=buildOperationalAnalytics({sales,ingredients,now});
        const costQuality=assessSalesCostQuality(monthSales);
        const todaySales=sales.filter(s=>s.date===today),todayRevenue=todaySales.reduce((s,x)=>s+Number(x.total||0),0);
        const recommendations=[];
        if(lowStock.length)recommendations.push({level:'warning',title:'สต็อกต่ำ',detail:lowStock.slice(0,3).map(x=>x.name).join(', ')+' ควรวางแผนสั่งซื้อ'});
        if(analytics.purchaseRecommendations.length){const p=analytics.purchaseRecommendations[0],orderText=p.suggestedPackages&&p.packageUnit?(p.suggestedPackages+' '+p.packageUnit+' (อย่างน้อย '+p.suggestQty+' '+p.unit+')'):(p.suggestQty+' '+p.unit);recommendations.push({level:'warning',title:'แนะนำสั่งวัตถุดิบ',detail:p.name+' เหลือประมาณ '+p.daysCover.toFixed(1)+' วัน · แนะนำสั่ง '+orderText});}
        if(analytics.peakHour)recommendations.push({level:'info',title:'ช่วงเวลายอดเด่น',detail:String(analytics.peakHour.hour).padStart(2,'0')+':00–'+String(analytics.peakHour.hour).padStart(2,'0')+':59 · '+analytics.peakHour.orders+' ออเดอร์ในช่วงวิเคราะห์'});
        const margin=revenue?((revenue-cogs)/revenue)*100:0;if(revenue&&margin<55)recommendations.push({level:'warning',title:'Gross Margin ต่ำ',detail:'เดือนนี้ '+margin.toFixed(1)+'% ควรตรวจราคาวัตถุดิบ/ราคาขาย'});
        if(monthSales.length&&topItems.length)recommendations.push({level:'info',title:'เมนูขายดี',detail:topItems[0].name+' ขาย '+topItems[0].qty+' แก้วในเดือนนี้'});
        if(!recommendations.length)recommendations.push({level:'ok',title:'สถานะปกติ',detail:'ยังไม่พบประเด็นเร่งด่วนจากยอดขาย ต้นทุน และสต็อก'});
        return reply(res,200,{revision:Number(state.revision)||0,today,month,todayRevenue,todayOrders:todaySales.length,revenue,cogs,expenses:finance.operatingExpenses,purchaseSpend:finance.purchaseSpend,totalCashOut:finance.totalCashOut,operatingProfit:finance.operatingProfit,grossProfit:finance.grossProfit,grossMargin:margin,profitEstimated:costQuality.isEstimated,costQuality,topItems,lowStock,recommendations,analytics,customers:(doc.customers||[]).length,inventoryValue:inventory.value,inventoryItems:inventory.items,inventoryValueEstimated:inventory.isEstimated});
      }
      if(path==='/api/pos/checkout'&&method==='POST'){
        if(!mayView({...user,active:true},'order'))return reply(res,403,{error:'order_permission_required'});
        const startedAt=Date.now();
        try{
          const b=bodyOf(req);b.serverDate=bangkokDate(now);if(!b.date)b.date=b.serverDate;
          // PromptPay must replay before provider verification. Cash is replayed
          // safely inside checkoutPos, avoiding an extra Turso read on every sale.
          if(String(b.payment||'')==='promptpay'){
            const committed=await getPosRequestReplay({db,requestKey:b.requestKey,user,body:b});
            if(committed){
              console.info('FIELD_METRIC pos_checkout_ms='+String(Date.now()-startedAt)+' payment=promptpay replay=1');
              return reply(res,200,committed);
            }
            const charge=await getPromptPayCharge(b.paymentReference);
            if(!charge.paid)return reply(res,409,{error:'promptpay_not_verified'});
            b.paymentVerified=charge.chargeId;
            b.paymentProviderAmount=charge.amount;
          }
          const result=await checkoutPos({db,user,body:b,now});
          console.info('FIELD_METRIC pos_checkout_ms='+String(Date.now()-startedAt)+' payment='+String(b.payment||'cash')+' replay='+(result?.replayed?'1':'0'));
          return reply(res,200,result)
        }
        catch(e){
          console.info('FIELD_METRIC pos_checkout_ms='+String(Date.now()-startedAt)+' result=error');
          return reply(res,e.status||500,{error:e.status?e.message:'server_error'})
        }
      }
      if(path==='/api/pos/queue'&&method==='GET'){
        if(!mayView({...user,active:true},'queue'))return reply(res,403,{error:'queue_permission_required'});
        try{return reply(res,200,await getQueueSnapshot({db,sinceRevision:req.headers['x-field-revision']}))}
        catch(e){return reply(res,e.status||500,{error:e.status?e.message:'server_error'})}
      }
      if(path==='/api/pos/queue'&&method==='POST'){
        if(!mayView({...user,active:true},'queue'))return reply(res,403,{error:'queue_permission_required'});
        try{return reply(res,200,await queuePosAction({db,user,body:bodyOf(req),now}))}
        catch(e){return reply(res,e.status||500,{error:e.status?e.message:'server_error'})}
      }
      if(path==='/api/pos/split/start'&&method==='POST'){
        if(!mayView({...user,active:true},'order'))return reply(res,403,{error:'order_permission_required'});
        try{const b=bodyOf(req);b.serverDate=bangkokDate(now);if(!b.date)b.date=b.serverDate;return reply(res,200,await startSplitPayment({db,user,body:b,now}))}
        catch(e){return reply(res,e.status||500,{error:e.status?e.message:'server_error'})}
      }
      if(path==='/api/pos/split/pay'&&method==='POST'){
        if(!mayView({...user,active:true},'order'))return reply(res,403,{error:'order_permission_required'});
        try{
          const b=bodyOf(req);
          const committed=await getPosRequestReplay({db,requestKey:b.requestKey,user,body:b});
          if(committed)return reply(res,200,committed);
          if(String(b.method||'')==='promptpay'){
            const charge=await getPromptPayCharge(b.paymentReference);
            if(!charge.paid)return reply(res,409,{error:'promptpay_not_verified'});
            b.paymentVerified=charge.chargeId;
            b.paymentProviderAmount=charge.amount;
          }
          return reply(res,200,await paySplitPayment({db,user,body:b,now}))
        }
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
      if(path==='/api/pos/split/resolve'&&method==='POST'){
        if(user.role!=='admin')return reply(res,403,{error:'admin_required'});
        try{return reply(res,200,await resolveSplitPayment({db,user,body:bodyOf(req),now}))}
        catch(e){return reply(res,e.status||500,{error:e.status?e.message:'server_error'})}
      }
      if(path==='/api/pos/bootstrap'&&method==='GET'){
        if(!mayView({...user,active:true},'order')&&!mayView({...user,active:true},'queue'))return reply(res,403,{error:'pos_permission_required'});
        const requested=Number(req.headers['x-field-revision']),hasRevision=Number.isSafeInteger(requested)&&requested>=0;
        const state=hasRevision
          ?await one(db,'SELECT revision,CASE WHEN revision=? THEN NULL ELSE document END AS document FROM field_state WHERE singleton=1',[requested])
          :await one(db,'SELECT revision,document FROM field_state WHERE singleton=1');
        const revision=Number(state?.revision)||0;
        if(hasRevision&&revision===requested&&state?.document==null)return reply(res,200,{revision,unchanged:true});
        const doc=JSON.parse(state?.document||'{}');
        const structure=getMenuStructure(doc),categoryKey=v=>String(v||'OTHER').trim().toLocaleLowerCase('en-US');
        const categoryMap=new Map(structure.categories.map((row,rank)=>[categoryKey(row.name),{...row,rank}]));
        const categoryInfo=name=>categoryMap.get(categoryKey(name))||{enabled:true,rank:999};
        const baseMenu=(Array.isArray(doc.menu)?doc.menu:[]).filter(m=>!m.archived&&categoryInfo(m.category).enabled).map((m,index)=>({
          id:String(m.id||''),name:String(m.name||''),category:String(m.category||''),image:String(m.image||''),_index:index,
          price:Number(m.price)||0,enabled:!!m.enabled&&Number(m.price)>0,
          variants:(Array.isArray(m.variants)?m.variants:[]).map(v=>({label:String(v.label||''),recipe:v.recipe}))
        })).sort((a,b)=>categoryInfo(a.category).rank-categoryInfo(b.category).rank||a._index-b._index).map(({_index,...m})=>m);
        const availability=buildPosAvailability({menu:baseMenu,ingredients:doc.ingredients||{},lowServings:Number(doc.settings?.availabilityLowServings)||5});
        return reply(res,200,{revision,menu:availability.menu,availabilityStock:availability.stock,settings:{pagerCount:Number(doc.settings?.pagerCount)||10,categories:structure.categories.filter(x=>x.enabled)}});
      }
      const menuImageReadMatch=path.match(/^\/api\/menu-images\/([^/]+)$/);
      if(menuImageReadMatch&&method==='GET'){
        const id=decodeURIComponent(menuImageReadMatch[1]),image=await one(db,'SELECT mime_type,data_url FROM field_menu_images WHERE menu_id=?',[id]);
        if(!image)return reply(res,404,{error:'menu_image_not_found'});
        const normalized=normalizeMenuImageUpload({dataUrl:String(image.data_url||'')});
        return binaryReply(res,200,normalized.bytes,String(image.mime_type||normalized.mimeType));
      }
      if(path==='/api/pos/refund'&&method==='POST'){
        if(user.role!=='admin')return reply(res,403,{error:'admin_required'});
        try{return reply(res,200,await refundSale({db,user,body:bodyOf(req),now}))}
        catch(e){return reply(res,e.status||500,{error:e.status?e.message:'server_error'})}
      }
      if(path==='/api/pos/void'&&method==='POST'){
        if(user.role!=='admin')return reply(res,403,{error:'admin_required'});
        try{return reply(res,200,await voidSale({db,user,body:bodyOf(req),now}))}
        catch(e){return reply(res,e.status||500,{error:e.status?e.message:'server_error'})}
      }
      if(path==='/api/pos/history'&&method==='GET'){
        if(!mayView({...user,active:true},'order'))return reply(res,403,{error:'order_permission_required'});
        const state=await one(db,'SELECT revision,document FROM field_state WHERE singleton=1');
        const doc=JSON.parse(state.document||'{}');
        const sales=(Array.isArray(doc.sales)?doc.sales:[]).slice(-300).reverse().map(s=>{
          const order=(doc.orders||[]).find(o=>o.saleId===s.id||(o.saleIds||[]).includes(s.id));
          const productionStarted=!!order&&((order.items||[]).some(i=>Number(i.readyQty)>0||Number(i.calledQty)>0)||['making','ready','returned'].includes(String(order.status||'')));
          return {
            id:s.id,billNo:s.billNo,date:s.date,time:Number(s.time)||0,subtotal:Number(s.subtotal??s.total)||0,discountTotal:Number(s.discountTotal)||0,crmDiscount:Number(s.crmDiscount)||0,pointsRedeemed:Number(s.pointsRedeemed)||0,pointsAwarded:Number(s.pointsAwarded)||0,total:Number(s.total)||0,received:Number(s.received)||0,change:Number(s.change)||0,
            payment:s.payment||'',paymentMethods:[...new Set((s.payments||[]).map(p=>String(p.method||'')).filter(Boolean))],
            status:s.status||'',queueNo:s.queueNo||'',orderId:order?.id||null,orderStatus:order?.status||null,productionStarted,
            itemCount:(s.items||[]).reduce((n,x)=>n+(Number(x.qty)||0),0),
            items:(s.items||[]).map(x=>({id:x.id,name:x.name,variant:x.variant,qty:Number(x.qty)||0,price:Number(x.price)||0}))
          };
        });
        return reply(res,200,{revision:Number(state.revision)||0,sales});
      }
      if(path==='/api/reports/summary'&&method==='GET'){
        if(user.role!=='admin'&&!mayView({...user,active:true},'report'))return reply(res,403,{error:'report_permission_required'});
        const state=await one(db,'SELECT revision,document FROM field_state WHERE singleton=1');
        const doc=JSON.parse(state.document||'{}'),sales=(Array.isArray(doc.sales)?doc.sales:[]).filter(s=>s.status==='paid');
        const byDate={};let revenue=0,cost=0,cups=0;
        for(const s of sales){const d=String(s.date||'');const total=Number(s.total)||0;byDate[d]=(byDate[d]||0)+total;revenue+=total;cost+=Number(s.costTotal)||0;cups+=(s.items||[]).reduce((n,x)=>n+(Number(x.qty)||0),0)}
        const dates=Object.keys(byDate).sort().slice(-7),daily=dates.map(date=>({date,revenue:byDate[date]}));
        const today=bangkokDate(now),todayRevenue=Number(byDate[today])||0;
        const costQuality=assessSalesCostQuality(sales),inventory=inventoryValuation(doc.ingredients||{});
        return reply(res,200,{revision:Number(state.revision)||0,today,todayRevenue,totalRevenue:revenue,grossProfit:revenue-cost,grossMargin:revenue?((revenue-cost)/revenue)*100:0,profitEstimated:costQuality.isEstimated,costQuality,cups,daily,inventoryValue:inventory.value,inventoryItems:inventory.items,inventoryValueEstimated:inventory.isEstimated});
      }
      if(path==='/api/reports/accounting-export'&&method==='GET'){
        if(user.role!=='admin'&&!mayView({...user,active:true},'report'))return reply(res,403,{error:'report_permission_required'});
        const state=await one(db,'SELECT revision,document FROM field_state WHERE singleton=1'),doc=JSON.parse(state.document||'{}'),ingredients=doc.ingredients||{};
        const sales=(doc.sales||[]).map(s=>({date:String(s.date||''),billNo:String(s.billNo||''),status:String(s.status||''),paymentMethods:(s.payments||[{method:s.payment,amount:s.total}]).map(p=>String(p.method||'')).join('+'),gross:Number(s.subtotal??s.total)||0,discount:Number(s.discountTotal)||0,net:Number(s.total)||0,cogs:Number(s.costTotal)||0,customerId:String(s.customerId||''),pointsRedeemed:Number(s.pointsRedeemed)||0,pointsAwarded:Number(s.pointsAwarded)||0,cups:(s.items||[]).reduce((n,i)=>n+Number(i.qty||0),0)}));
        const expenses=(doc.expenses||[]).map(e=>({date:String(e.date||''),category:String(e.category||''),description:String(e.description||''),amount:Number(e.amount)||0,paymentMethod:String(e.paymentMethod||''),sourceType:String(e.sourceType||'LEGACY'),referenceId:String(e.referenceId||'')}));
        const inventory=inventoryValuation(ingredients);
        const stock=inventory.rows.map(x=>({ingredientId:x.id,name:x.name,qty:x.qty,unit:x.unit,unitCost:x.unitCost,value:x.value,costStatus:x.costStatus,archived:x.archived?'yes':'no'}));
        return reply(res,200,{revision:Number(state.revision)||0,exportedAt:now,sales,expenses,stock,inventorySummary:{value:inventory.value,items:inventory.items,isEstimated:inventory.isEstimated}});
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
      if(path==='/api/admin/costs'&&method==='GET'){
        const state=await one(db,'SELECT revision,document FROM field_state WHERE singleton=1'),doc=JSON.parse(state.document||'{}');
        const purchases=await db.execute('SELECT id,ingredient_id,supplier,purchased_at,package_qty,package_unit,quantity_received,usage_unit,total_cost,unit_cost,source_url,image_url,note,created_by,created_at,pack_size,pack_size_unit,conversion_approximate,payment_method FROM field_purchase_records ORDER BY purchased_at DESC,created_at DESC LIMIT 500');
        const ingredients=doc.ingredients||{},estimatedVariableCost=Number(doc.settings?.estimatedVariableCost??2.5)||0,cancelledPurchases=doc.cancelledPurchases&&typeof doc.cancelledPurchases==='object'?doc.cancelledPurchases:{};
        const records=purchases.rows.filter(x=>!cancelledPurchases[String(x.id)]).map(x=>({id:String(x.id),ingredientId:String(x.ingredient_id),supplier:String(x.supplier||''),purchasedAt:String(x.purchased_at),packageQty:x.package_qty==null?null:Number(x.package_qty),packageUnit:String(x.package_unit||''),quantityReceived:Number(x.quantity_received),usageUnit:String(x.usage_unit),totalCost:Number(x.total_cost),unitCost:Number(x.unit_cost),sourceUrl:String(x.source_url||''),imageUrl:String(x.image_url||''),note:String(x.note||''),createdBy:x.created_by||null,createdAt:Number(x.created_at),packSize:x.pack_size==null?null:Number(x.pack_size),packSizeUnit:String(x.pack_size_unit||''),conversionApproximate:!!Number(x.conversion_approximate||0),paymentMethod:String(x.payment_method||'bank')}));
        return reply(res,200,{revision:Number(state.revision)||0,estimatedVariableCost,ingredients:Object.entries(ingredients).map(([id,x])=>{const policy=ingredientCostPolicy(x,id);return {id,name:x.name||id,unit:x.unit||'g',unitCost:Number(x.unitCost)||0,costKind:policy.kind,wasteMargin:policy.wasteMargin}}),menuCosts:buildMenuCostRows({menu:doc.menu||[],ingredients,estimatedVariableCost}),purchases:comparePurchaseSources(records)});
      }
      if(path==='/api/admin/costs/settings'&&method==='PATCH'){
        const value=Number(bodyOf(req).estimatedVariableCost);if(!Number.isFinite(value)||value<0||value>10000)return reply(res,400,{error:'invalid_estimated_variable_cost'});
        const tx=await beginWriteTransaction(db);try{const state=(await tx.execute('SELECT document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}');if(!doc.settings||typeof doc.settings!=='object')doc.settings={};doc.settings.estimatedVariableCost=value;await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'cost_settings_update',JSON.stringify({estimatedVariableCost:value}),now]});await tx.commit();return reply(res,200,{ok:true,estimatedVariableCost:value})}catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      if(path==='/api/admin/test-data/sales-reset'&&method==='GET'){
        const state=await one(db,'SELECT revision,document FROM field_state WHERE singleton=1'),doc=JSON.parse(state.document||'{}');
        const activePayments=(doc.paymentSessions||[]).filter(s=>['collecting','requires_resolution'].includes(String(s.status||'')));
        const activeOrders=(doc.orders||[]).filter(o=>!['returned','void','refunded','cancelled'].includes(String(o.status||'')));
        const snapshots=await one(db,'SELECT COUNT(*) AS n FROM field_cost_snapshots');
        const requests=await one(db,'SELECT COUNT(*) AS n FROM field_pos_requests');
        return reply(res,200,{revision:Number(state.revision)||0,sales:(doc.sales||[]).length,orders:(doc.orders||[]).length,activeOrders:activeOrders.length,closes:(doc.closes||[]).length,paymentSessions:(doc.paymentSessions||[]).length,activePayments:activePayments.length,costSnapshots:Number(snapshots?.n||0),posRequests:Number(requests?.n||0),customers:(doc.customers||[]).filter(x=>Number(x.visits||0)>0||Number(x.totalSpend||0)>0).length,stockWillChange:false});
      }
      if(path==='/api/admin/test-data/sales-reset'&&method==='POST'){
        const b=bodyOf(req);if(String(b.confirm||'')!=='RESET TEST SALES')return reply(res,400,{error:'test_sales_reset_confirmation_required'});
        const tx=await beginWriteTransaction(db);
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}');
          const activePayments=(doc.paymentSessions||[]).filter(s=>['collecting','requires_resolution'].includes(String(s.status||'')));
          if(activePayments.length){await tx.rollback();return reply(res,409,{error:'active_payment_sessions_exist',count:activePayments.length})}
          const activeOrders=(doc.orders||[]).filter(o=>!['returned','void','refunded','cancelled'].includes(String(o.status||'')));
          if(activeOrders.length&&b.confirmOpenOrders!==true){await tx.rollback();return reply(res,409,{error:'active_orders_confirmation_required',count:activeOrders.length})}
          const oldSales=Array.isArray(doc.sales)?doc.sales.slice():[],counts={sales:oldSales.length,orders:(doc.orders||[]).length,closes:(doc.closes||[]).length,paymentSessions:(doc.paymentSessions||[]).length};
          await tx.execute({sql:'INSERT INTO field_state_versions(revision,document,action,actor_id,created_at) VALUES(?,?,?,?,?)',args:[Number(state.revision)||0,state.document,'before_test_sales_reset',user.id,now]});
          const customerStats={};
          for(const sale of oldSales){
            if(!sale.customerId||sale.customerEffectsReversed===true)continue;
            const stat=customerStats[sale.customerId]||(customerStats[sale.customerId]={visits:0,spend:0,pointsAwarded:0,pointsRedeemed:0});
            const status=String(sale.status||'paid');
            stat.visits+=1;
            if(status!=='refunded'){stat.spend+=Number(sale.total||0);stat.pointsAwarded+=Number(sale.pointsAwarded||0);stat.pointsRedeemed+=Number(sale.pointsRedeemed||0)}
          }
          for(const customer of doc.customers||[]){
            const stat=customerStats[customer.id];if(!stat)continue;
            customer.visits=Math.max(0,Number(customer.visits||0)-stat.visits);
            customer.totalSpend=Math.max(0,Number(customer.totalSpend||0)-stat.spend);
            customer.points=Math.max(0,Number(customer.points||0)-stat.pointsAwarded+stat.pointsRedeemed);
            customer.lastVisit=0;
          }
          doc.sales=[];doc.orders=[];doc.paymentSessions=[];doc.billSeq={};doc.cart=[];doc.closes=[];doc.posRequestKeys={};doc.testSalesResetAt=now;doc.testSalesResetBy=user.id;
          await tx.execute('DELETE FROM field_cost_snapshots');await tx.execute('DELETE FROM field_pos_requests');
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'test_sales_reset',JSON.stringify({...counts,activeOrders:activeOrders.length,stockChanged:false}),now]});
          await tx.commit();return reply(res,200,{ok:true,...counts,stockChanged:false,revision:Number(state.revision)+1});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      if(path==='/api/admin/backup/export'&&method==='GET'){
        const tx=await db.transaction('read');
        try{
          const state=await one(tx,'SELECT revision,document,updated_at FROM field_state WHERE singleton=1'),tables={};
          for(const [key,table] of Object.entries(FULL_BACKUP_TABLES))tables[key]=(await tx.execute(`SELECT * FROM ${table}`)).rows.map(x=>({...x}));
          const backup=buildFullBackup({stateRow:state,tables,createdAt:new Date(now).toISOString()});
          await tx.commit();return reply(res,200,backup);
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      if(path==='/api/admin/backup/preview'&&method==='POST'){
        try{const p=validateFullBackup(bodyOf(req).backup);return reply(res,200,{ok:true,schemaVersion:p.schemaVersion,dataVersion:p.dataVersion,revision:p.revision,recordCounts:p.recordCounts})}
        catch(e){return reply(res,400,{error:String(e.message||'invalid_backup')})}
      }
      if(path==='/api/admin/backup/restore'&&method==='POST'){
        const b=bodyOf(req);if(b.confirm!==true)return reply(res,400,{error:'restore_requires_explicit_confirmation'});
        let backup;try{backup=validateFullBackup(b.backup)}catch(e){return reply(res,400,{error:String(e.message||'invalid_backup')})}
        const revision=expectedRevision(b.expectedRevision),tx=await beginWriteTransaction(db);
        try{
          const current=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0];
          if(Number(current.revision)!==revision){await tx.rollback();return reply(res,409,{error:'revision_conflict',currentRevision:Number(current.revision)})}
          await tx.execute({sql:'INSERT INTO field_state_versions(revision,document,action,actor_id,created_at) VALUES(?,?,?,?,?)',args:[revision,current.document,'before_full_restore',user.id,now]});
          for(const key of ['menuImages','posRequests','costHistory','purchaseRecords','costSnapshots','recipeVersions','stockTransactions'])await tx.execute(`DELETE FROM ${FULL_BACKUP_TABLES[key]}`);
          for(const key of ['stockTransactions','purchaseRecords','costSnapshots','recipeVersions','costHistory','posRequests','menuImages'])await insertBackupRows(tx,key,backup.tables[key]);
          const changed=await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1 AND revision=?',args:[JSON.stringify(backup.fieldState.document),now,revision]});
          if(Number(changed.rowsAffected)!==1)throw new Error('revision_conflict');
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'full_backup_restore',JSON.stringify({previousRevision:revision,backupRevision:backup.revision,schemaVersion:backup.schemaVersion,recordCounts:backup.recordCounts}),now]});
          await tx.commit();return reply(res,200,{ok:true,revision:revision+1,recordCounts:backup.recordCounts});
        }catch(e){await tx.rollback().catch(()=>{});if(e.message==='revision_conflict')return reply(res,409,{error:'revision_conflict'});throw e}
      }
      if(path==='/api/admin/audit'&&method==='GET'){
        const rows=await db.execute(`SELECT a.id,a.actor_id,u.username,a.action,a.details,a.created_at
          FROM field_audit a LEFT JOIN field_users u ON u.id=a.actor_id
          ORDER BY a.id DESC LIMIT 500`);
        return reply(res,200,{events:rows.rows.map(x=>({
          id:Number(x.id),actorId:x.actor_id||null,actor:x.username||x.actor_id||'system',
          action:String(x.action||''),details:safeAuditDetails(x.details),createdAt:Number(x.created_at)||0
        }))});
      }
      if(path==='/api/admin/readiness'&&method==='GET'){
        const state=await one(db,'SELECT revision,document,updated_at FROM field_state WHERE singleton=1'),doc=JSON.parse(state.document||'{}');
        const userCount=await one(db,'SELECT COUNT(*) AS n FROM field_users WHERE active=1');
        const menu=(Array.isArray(doc.menu)?doc.menu:[]).filter(m=>!m.archived),activeMenus=menu.filter(m=>m.enabled);
        const missingRecipe=activeMenus.filter(m=>!(m.variants||[]).length||(m.variants||[]).some(v=>!v.recipe?.items||!Object.keys(v.recipe.items).length||Object.values(v.recipe.items).some(q=>!Number.isFinite(Number(q))||Number(q)<0)||!Object.values(v.recipe.items).some(q=>Number(q)>0)));
        const ingredients=Object.entries(doc.ingredients||{}).map(([id,x])=>({id,name:String(x.name||id),qty:Number(x.qty)||0,safetyStock:Number(x.safetyStock??x.minQty??0)||0,unitCost:Number(x.unitCost)||0,costStatus:String(x.costStatus||(Number(x.unitCost)>0?'CONFIRMED':'MISSING')).toUpperCase()}));
        const lowStock=ingredients.filter(x=>x.safetyStock>0&&x.qty<=x.safetyStock);
        const missingCost=ingredients.filter(x=>x.unitCost<=0||x.costStatus==='MISSING'),pendingCost=ingredients.filter(x=>x.costStatus==='PROVISIONAL');
        const openOrders=(doc.orders||[]).filter(o=>!['returned','void','refunded','cancelled'].includes(String(o.status||'')));
        const splitCollecting=(doc.paymentSessions||[]).filter(s=>s.status==='collecting'&&Number(s.expiresAt||0)>now);
        const splitRequiresResolution=(doc.paymentSessions||[]).filter(s=>s.status==='requires_resolution'||(s.status==='collecting'&&(s.payments||[]).length&&Number(s.expiresAt||0)<=now));
        const pendingPayments=[...splitCollecting,...splitRequiresResolution];
        const today=bangkokDate(now),closedToday=(doc.closes||[]).some(x=>x.date===today),promptpay=promptPayConfig();
        const readinessAvailability=buildPosAvailability({menu:activeMenus,ingredients:doc.ingredients||{},lowServings:Number(doc.settings?.availabilityLowServings)||5});
        const availableMenus=readinessAvailability.menu.filter(m=>m.available).length;
        const availableVariants=readinessAvailability.menu.reduce((sum,m)=>sum+(m.variants||[]).filter(v=>v.available).length,0);
        const approvedRecipeDrift=findApprovedRecipeDrift(doc.menu||[]);
        const warnings=[];
        if(!activeMenus.length)warnings.push({code:'no_active_menu',message:'ยังไม่มีเมนูที่เปิดขาย'});
        if(missingRecipe.length)warnings.push({code:'active_menu_missing_recipe',message:missingRecipe.length+' เมนูยังมีสูตรไม่ครบ'});
        if(activeMenus.length&&availableVariants===0)warnings.push({code:'no_available_menu',message:'ไม่มีเมนูที่ทำได้จาก Stock ปัจจุบัน'});
        if(approvedRecipeDrift.length)warnings.push({code:'approved_recipe_drift',message:approvedRecipeDrift.length+' สูตรยังไม่ตรง FIELD Approved Master'});
        if(lowStock.length)warnings.push({code:'low_stock',message:lowStock.length+' วัตถุดิบถึง Safety Stock'});
        if(missingCost.length)warnings.push({code:'missing_cost',message:missingCost.length+' วัตถุดิบยังไม่มีต้นทุนยืนยัน'});
        if(pendingCost.length)warnings.push({code:'pending_cost',message:pendingCost.length+' วัตถุดิบใช้ต้นทุนชั่วคราว'});
        if(openOrders.length)warnings.push({code:'open_orders',message:openOrders.length+' ออเดอร์ยังไม่ปิด'});
        if(pendingPayments.length)warnings.push({code:'pending_payments',message:pendingPayments.length+' การชำระแบบ Split ยังไม่จบ'});
        if(closedToday)warnings.push({code:'day_closed',message:'วันนี้ถูก Close Day แล้ว'});
        if(!promptpay.configured)warnings.push({code:'promptpay_not_configured',message:'PromptPay provider ยังไม่ได้ตั้งค่า'});
        else if(promptpay.selectedProvider==='beam'&&!promptpay.webhookConfigured)warnings.push({code:'beam_webhook_not_configured',message:'Beam API พร้อมแล้ว แต่ยังขาด Webhook HMAC Key'});
        if(promptpay.selectedProvider==='beam'&&promptpay.mode==='test')warnings.push({code:'beam_playground_mode',message:'Beam อยู่ใน Playground/Test mode ยังไม่รับเงินจริง'});
        const readyForCashSales=Number(userCount?.n||0)>0&&activeMenus.length>0&&missingRecipe.length===0&&availableVariants>0&&!closedToday;
        const readyForPromptPay=readyForCashSales&&promptpay.ready===true;
        const readyForFullOperations=readyForCashSales&&missingCost.length===0&&pendingCost.length===0&&splitRequiresResolution.length===0&&approvedRecipeDrift.length===0;
        return reply(res,200,{
          storage:{ok:true,provider:'turso',revision:Number(state.revision)||0,updatedAt:Number(state.updated_at)||0},
          businessDate:today,closedToday,users:{active:Number(userCount?.n||0)},
          menu:{total:menu.length,active:activeMenus.length,missingRecipe:missingRecipe.length,availableMenus,availableVariants,approvedRecipeDrift:approvedRecipeDrift.length},
          stock:{ingredients:ingredients.length,low:lowStock.length,missingCost:missingCost.length,pendingCost:pendingCost.length,lowItems:lowStock.slice(0,10).map(x=>({id:x.id,name:x.name,qty:x.qty,safetyStock:x.safetyStock}))},
          operations:{openOrders:openOrders.length,pendingPayments:pendingPayments.length,splitCollecting:splitCollecting.length,splitRequiresResolution:splitRequiresResolution.length},
          payment:{promptpay},
          readyForCashSales,readyForPromptPay,readyForFullOperations,promptPayReady:readyForPromptPay,
          warnings
        });
      }
      if(path==='/api/admin/business-settings'&&method==='GET'){
        const state=await one(db,'SELECT revision,document FROM field_state WHERE singleton=1'),doc=JSON.parse(state.document||'{}');
        return reply(res,200,{revision:Number(state.revision)||0,settings:{pointsSpend:Number(doc.settings?.pointsSpend)||0,pointsRedeemValue:Number(doc.settings?.pointsRedeemValue)||0,pagerCount:Number(doc.settings?.pagerCount)||10}});
      }
      if(path==='/api/admin/business-settings'&&method==='PATCH'){
        const b=bodyOf(req),pointsSpend=b.pointsSpend===undefined?undefined:Number(b.pointsSpend),pointsRedeemValue=b.pointsRedeemValue===undefined?undefined:Number(b.pointsRedeemValue),pagerCount=b.pagerCount===undefined?undefined:Number(b.pagerCount);
        if(pointsSpend!==undefined&&(!Number.isFinite(pointsSpend)||pointsSpend<0||pointsSpend>1e6))return reply(res,400,{error:'invalid_points_spend'});
        if(pointsRedeemValue!==undefined&&(!Number.isFinite(pointsRedeemValue)||pointsRedeemValue<0||pointsRedeemValue>1e5))return reply(res,400,{error:'invalid_points_redeem_value'});
        if(pagerCount!==undefined&&(!Number.isFinite(pagerCount)||pagerCount<1||pagerCount>100))return reply(res,400,{error:'invalid_pager_count'});
        const tx=await beginWriteTransaction(db);
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}');
          if(!doc.settings||typeof doc.settings!=='object')doc.settings={};
          if(pointsSpend!==undefined)doc.settings.pointsSpend=pointsSpend;
          if(pointsRedeemValue!==undefined)doc.settings.pointsRedeemValue=pointsRedeemValue;
          if(pagerCount!==undefined)doc.settings.pagerCount=Math.floor(pagerCount);
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'business_settings_update',JSON.stringify({pointsSpend,pointsRedeemValue,pagerCount}),now]});
          await tx.commit();return reply(res,200,{ok:true,settings:doc.settings});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      if(path==='/api/admin/recipes'&&method==='GET'){
        const state=await one(db,'SELECT revision,document FROM field_state WHERE singleton=1'),doc=JSON.parse(state.document||'{}');
        const versions=await db.execute('SELECT id,menu_id,version,status,document,created_by,created_at FROM field_recipe_versions ORDER BY created_at DESC LIMIT 200');
        return reply(res,200,{revision:Number(state.revision)||0,
          ingredients:Object.entries(doc.ingredients||{}).map(([id,x])=>{const policy=ingredientCostPolicy(x,id),raw=Number(x.unitCost)||0;return {id,name:x.name||id,unit:x.unit||'g',qty:Number(x.qty)||0,unitCost:raw,standardUnitCost:raw*(1+policy.wasteMargin),archived:!!x.archived}}),
          menus:(doc.menu||[]).filter(m=>!m.archived).map(m=>({id:m.id,name:m.name,enabled:!!m.enabled,variants:(m.variants||[]).map(v=>({label:v.label||'Standard',recipeVersion:Number(v.recipeVersion)||null,recipe:v.recipe||{items:{}}}))})),
          versions:versions.rows.map(x=>({id:String(x.id),menuId:String(x.menu_id),version:Number(x.version),status:String(x.status),document:JSON.parse(x.document||'{}'),createdBy:x.created_by||null,createdAt:Number(x.created_at)})),
          comments:(Array.isArray(doc.recipeComments)?doc.recipeComments:[]).slice().sort((a,b)=>Number(b.updatedAt||b.createdAt)-Number(a.updatedAt||a.createdAt)),
          approvedDrift:findApprovedRecipeDrift(doc.menu||[])
        });
      }
      if(path==='/api/admin/recipes/reconcile'&&method==='POST'){
        const updateId=String(bodyOf(req).updateId||'').trim();
        if(!updateId)return reply(res,400,{error:'approved_recipe_update_required'});
        const tx=await beginWriteTransaction(db);
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}');
          let applied;
          try{applied=applyApprovedRecipeUpdate(doc.menu||[],updateId)}
          catch(e){await tx.rollback();return reply(res,409,{error:String(e.message||'approved_recipe_reconcile_failed')})}
          const vr=(await tx.execute({sql:'SELECT COALESCE(MAX(version),0) AS v FROM field_recipe_versions WHERE menu_id=?',args:[applied.product.id]})).rows[0],version=Number(vr?.v||0)+1;
          const versionId='rv_'+randomUUID(),document={menuId:applied.product.id,menuName:applied.product.name,variant:String(applied.variant.label||'Standard'),items:applied.items,approvedUpdateId:updateId};
          await tx.execute({sql:'INSERT INTO field_recipe_versions(id,menu_id,version,status,document,created_by,created_at) VALUES(?,?,?,?,?,?,?)',args:[versionId,applied.product.id,version,'active',JSON.stringify(document),user.id,now]});
          applied.variant.recipeVersion=version;
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'approved_recipe_reconcile',JSON.stringify({updateId,menuId:applied.product.id,variant:applied.variant.label,version}),now]});
          await tx.commit();return reply(res,201,{ok:true,updateId,version,id:versionId});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      if(path==='/api/admin/recipes/publish'&&method==='POST'){
        const b=bodyOf(req),menuId=String(b.menuId||''),variantLabel=String(b.variant||'').trim(),items=b.items;
        if(!menuId||!variantLabel||!items||typeof items!=='object'||Array.isArray(items))return reply(res,400,{error:'invalid_recipe'});
        const tx=await beginWriteTransaction(db);
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
      if(path==='/api/admin/recipes/comments'&&method==='POST'){
        const b=bodyOf(req),menuId=String(b.menuId||''),variantLabel=String(b.variant||'').trim(),authorType=String(b.authorType||'').toLowerCase(),text=String(b.text||'').trim();
        if(!['customer','owner','custom'].includes(authorType)||text.length<2||text.length>1000)return reply(res,400,{error:'invalid_recipe_comment'});
        const tx=await beginWriteTransaction(db);
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}'),menu=(doc.menu||[]).find(m=>m.id===menuId&&!m.archived);
          if(!menu){await tx.rollback();return reply(res,404,{error:'menu_not_found'})}
          const variant=(menu.variants||[]).find(v=>v.label===variantLabel);if(!variant){await tx.rollback();return reply(res,404,{error:'variant_not_found'})}
          const authorName=authorType==='owner'?String(b.authorName||user.username||'เจ้าของร้าน').trim():String(b.authorName||'').trim();
          if(authorName.length<1||authorName.length>80){await tx.rollback();return reply(res,400,{error:'comment_author_required'})}
          if(!Array.isArray(doc.recipeComments))doc.recipeComments=[];
          const comment={id:'rc_'+randomUUID(),menuId,variant:variantLabel,recipeVersion:Number(variant.recipeVersion)||null,authorType,authorName,text,createdAt:now,updatedAt:now,createdBy:user.id,history:[]};
          doc.recipeComments.push(comment);
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'recipe_comment_create',JSON.stringify({id:comment.id,menuId,variant:variantLabel,recipeVersion:comment.recipeVersion,authorType}),now]});
          await tx.commit();return reply(res,201,{ok:true,comment});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      const recipeCommentMatch=path.match(/^\/api\/admin\/recipes\/comments\/([^/]+)$/);
      if(recipeCommentMatch&&method==='PATCH'){
        const id=decodeURIComponent(recipeCommentMatch[1]),b=bodyOf(req),tx=await beginWriteTransaction(db);
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}'),comment=(doc.recipeComments||[]).find(x=>x.id===id);
          if(!comment){await tx.rollback();return reply(res,404,{error:'recipe_comment_not_found'})}
          const text=b.text===undefined?comment.text:String(b.text||'').trim(),authorType=b.authorType===undefined?comment.authorType:String(b.authorType||'').toLowerCase(),authorName=b.authorName===undefined?comment.authorName:String(b.authorName||'').trim();
          if(!['customer','owner','custom'].includes(authorType)||text.length<2||text.length>1000||authorName.length<1||authorName.length>80){await tx.rollback();return reply(res,400,{error:'invalid_recipe_comment'})}
          if(!Array.isArray(comment.history))comment.history=[];
          comment.history.push({text:comment.text,authorType:comment.authorType,authorName:comment.authorName,updatedAt:Number(comment.updatedAt||comment.createdAt)||now,updatedBy:comment.updatedBy||comment.createdBy||null});
          comment.text=text;comment.authorType=authorType;comment.authorName=authorName;comment.updatedAt=now;comment.updatedBy=user.id;
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'recipe_comment_update',JSON.stringify({id,menuId:comment.menuId,variant:comment.variant,recipeVersion:comment.recipeVersion}),now]});
          await tx.commit();return reply(res,200,{ok:true,comment});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      if(path==='/api/admin/menu-structure'&&method==='GET'){
        if(user.role!=='admin')return reply(res,403,{error:'admin_required'});
        const state=await one(db,'SELECT revision,document FROM field_state WHERE singleton=1'),doc=JSON.parse(state.document||'{}'),structure=getMenuStructure(doc);
        const ingredients=Object.entries(doc.ingredients||{}).filter(([,x])=>!x?.archived).map(([id,x])=>({id,name:String(x?.name||id),unit:String(x?.unit||'g')})).sort((a,b)=>a.name.localeCompare(b.name));
        return reply(res,200,{revision:Number(state.revision)||0,...structure,ingredients});
      }
      if(path==='/api/admin/menu-structure'&&method==='PATCH'){
        if(user.role!=='admin')return reply(res,403,{error:'admin_required'});
        const tx=await beginWriteTransaction(db);
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}');
          let normalized;try{normalized=validateMenuStructure(bodyOf(req),doc)}catch(e){await tx.rollback();return reply(res,400,{error:String(e.message||'invalid_menu_structure')})}
          const structure=applyMenuStructure(doc,normalized);
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'menu_structure_update',JSON.stringify({categories:structure.categories.length,prepBases:structure.prepBases.length}),now]});
          await tx.commit();return reply(res,200,{ok:true,revision:Number(state.revision)+1,...structure});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      if(path==='/api/admin/products'&&method==='GET'){
        const state=await one(db,'SELECT revision,document FROM field_state WHERE singleton=1');
        const doc=JSON.parse(state.document||'{}');
        const structure=getMenuStructure(doc);
        return reply(res,200,{revision:Number(state.revision)||0,categories:structure.categories,prepBases:structure.prepBases,products:(Array.isArray(doc.menu)?doc.menu:[]).map(m=>({
          id:m.id,name:m.name,category:m.category||'',prepBaseId:String(m.prepBaseId||''),price:Number(m.price)||0,enabled:!!m.enabled,image:m.image||'',archived:!!m.archived,
          archivedReason:m.archivedReason||'',archivedAt:Number(m.archivedAt)||null,
          variants:(Array.isArray(m.variants)?m.variants:[]).map(v=>({label:v.label||''}))
        }))});
      }
      if(path==='/api/admin/products'&&method==='POST'){
        const b=bodyOf(req),name=String(b.name||'').trim(),category=String(b.category||'').trim(),prepBaseId=String(b.prepBaseId||'').trim(),price=Number(b.price);
        if(name.length<2||name.length>120||category.length>80||!Number.isFinite(price)||price<0||price>100000)return reply(res,400,{error:'invalid_product'});
        const tx=await beginWriteTransaction(db);
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}');
          if(!Array.isArray(doc.menu))doc.menu=[];
          const structure=getMenuStructure(doc),categoryName=category||structure.categories.find(x=>x.enabled)?.name||'OTHER';
          if(!structure.categories.some(x=>x.name===categoryName)){await tx.rollback();return reply(res,400,{error:'menu_category_not_found'})}
          if(prepBaseId&&!prepBaseState(doc,prepBaseId)){await tx.rollback();return reply(res,400,{error:'prep_base_not_found'})}
          const id='menu-'+randomUUID(),product={id,name,category:categoryName,prepBaseId,price,enabled:false,image:String(b.image||'').slice(0,500),variants:[{label:'Standard',recipe:{items:{}}}]};
          doc.menu.push(product);
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'product_create',JSON.stringify({id,name}),now]});
          await tx.commit();return reply(res,201,{ok:true,product:{id,name,category:product.category,prepBaseId:product.prepBaseId||'',price,enabled:false,image:product.image,variants:[{label:'Standard'}]}});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      const productMatch=path.match(/^\/api\/admin\/products\/([^/]+)$/);
      const productPurgeMatch=path.match(/^\/api\/admin\/products\/([^/]+)\/purge$/);
      const productRestoreMatch=path.match(/^\/api\/admin\/products\/([^/]+)\/restore$/);
      const productImageMatch=path.match(/^\/api\/admin\/products\/([^/]+)\/image$/);
      if(productImageMatch&&method==='POST'){
        if(user.role!=='admin')return reply(res,403,{error:'admin_required'});
        const id=decodeURIComponent(productImageMatch[1]),b=bodyOf(req),image=normalizeMenuImageUpload(b),tx=await beginWriteTransaction(db);
        try{
          const state=(await tx.execute('SELECT document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}'),product=(doc.menu||[]).find(m=>m.id===id&&!m.archived);
          if(!product){await tx.rollback();return reply(res,404,{error:'product_not_found'})}
          const imageUrl='/api/menu-images/'+encodeURIComponent(id)+'?v='+now;product.image=imageUrl;
          await tx.execute({sql:'INSERT INTO field_menu_images(menu_id,mime_type,data_url,updated_by,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(menu_id) DO UPDATE SET mime_type=excluded.mime_type,data_url=excluded.data_url,updated_by=excluded.updated_by,updated_at=excluded.updated_at',args:[id,image.mimeType,image.dataUrl,user.id,now]});
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'product_image_update',JSON.stringify({id,mimeType:image.mimeType,bytes:image.bytes.length}),now]});
          await tx.commit();return reply(res,200,{ok:true,image:imageUrl});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      if(productPurgeMatch&&method==='DELETE'){
        const id=decodeURIComponent(productPurgeMatch[1]),b=bodyOf(req);if(String(b.confirm||'')!=='DELETE')return reply(res,400,{error:'delete_confirmation_required'});
        const tx=await beginWriteTransaction(db);
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}'),index=(doc.menu||[]).findIndex(m=>m.id===id),product=(doc.menu||[])[index];
          if(!product){await tx.rollback();return reply(res,404,{error:'product_not_found'})}
          const sold=(doc.sales||[]).some(s=>(s.items||[]).some(i=>i.id===id));if(sold){await tx.rollback();return reply(res,409,{error:'product_has_sales_archive_instead'})}
          const snapshots=await tx.execute({sql:'SELECT id FROM field_cost_snapshots WHERE menu_id=? LIMIT 1',args:[id]});if(snapshots.rows.length){await tx.rollback();return reply(res,409,{error:'product_has_cost_history_archive_instead'})}
          doc.menu.splice(index,1);if(Array.isArray(doc.recipeComments))doc.recipeComments=doc.recipeComments.filter(x=>x.menuId!==id);
          await tx.execute({sql:'DELETE FROM field_recipe_versions WHERE menu_id=?',args:[id]});await tx.execute({sql:'DELETE FROM field_menu_images WHERE menu_id=?',args:[id]});
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'product_purge_test_data',JSON.stringify({id,name:product.name}),now]});
          await tx.commit();return reply(res,200,{ok:true,id});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      if(productRestoreMatch&&method==='POST'){
        const id=decodeURIComponent(productRestoreMatch[1]),tx=await beginWriteTransaction(db);
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}'),product=(doc.menu||[]).find(m=>m.id===id&&m.archived);
          if(!product){await tx.rollback();return reply(res,404,{error:'archived_product_not_found'})}
          if(!Array.isArray(product.archiveHistory))product.archiveHistory=[];
          product.archiveHistory.push({archivedAt:Number(product.archivedAt)||null,reason:product.archivedReason||'',restoredAt:now,restoredBy:user.id});
          product.enabled=false;product.archived=false;product.restoredAt=now;product.restoredBy=user.id;
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'product_restore',JSON.stringify({id,status:'DRAFT'}),now]});
          await tx.commit();return reply(res,200,{ok:true,status:'DRAFT'});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      if(productMatch&&method==='PATCH'){
        const id=decodeURIComponent(productMatch[1]),b=bodyOf(req),tx=await beginWriteTransaction(db);
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}'),product=(doc.menu||[]).find(m=>m.id===id&&!m.archived);
          if(!product){await tx.rollback();return reply(res,404,{error:'product_not_found'})}
          if(b.name!==undefined){const v=String(b.name).trim();if(v.length<2||v.length>120)throw Object.assign(new Error('invalid_product'),{status:400});product.name=v}
          if(b.category!==undefined){const v=String(b.category).trim();if(v.length>80)throw Object.assign(new Error('invalid_product'),{status:400});const name=v||'OTHER';if(!getMenuStructure(doc).categories.some(x=>x.name===name))throw Object.assign(new Error('menu_category_not_found'),{status:400});product.category=name}
          if(b.prepBaseId!==undefined){const v=String(b.prepBaseId||'').trim();if(v&&!prepBaseState(doc,v))throw Object.assign(new Error('prep_base_not_found'),{status:400});product.prepBaseId=v}
          if(b.price!==undefined){const v=Number(b.price);if(!Number.isFinite(v)||v<0||v>100000)throw Object.assign(new Error('invalid_product'),{status:400});product.price=v}
          if(b.enabled!==undefined){if(typeof b.enabled!=='boolean')throw Object.assign(new Error('invalid_product'),{status:400});product.enabled=b.enabled}
          if(product.enabled&&Number(product.price)<=0)throw Object.assign(new Error('price_required_before_enable'),{status:409});
          if(product.enabled&&(product.variants||[]).some(v=>!v.recipe?.items||!Object.keys(v.recipe.items).length))throw Object.assign(new Error('recipe_required_before_enable'),{status:409});
          if(b.image!==undefined)product.image=String(b.image||'').slice(0,500);
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'product_update',JSON.stringify({id}),now]});
          await tx.commit();return reply(res,200,{ok:true});
        }catch(e){await tx.rollback().catch(()=>{});throw e}
      }
      if(productMatch&&method==='DELETE'){
        const id=decodeURIComponent(productMatch[1]),b=bodyOf(req),reason=String(b.reason||'').trim();
        if(reason.length<3||reason.length>500)return reply(res,400,{error:'archive_reason_required'});
        const tx=await beginWriteTransaction(db);
        try{
          const state=(await tx.execute('SELECT revision,document FROM field_state WHERE singleton=1')).rows[0],doc=JSON.parse(state.document||'{}'),product=(doc.menu||[]).find(m=>m.id===id&&!m.archived);
          if(!product){await tx.rollback();return reply(res,404,{error:'product_not_found'})}
          product.enabled=false;product.archived=true;product.archivedAt=now;product.archivedReason=reason;
          await tx.execute({sql:'UPDATE field_state SET revision=revision+1,document=?,updated_at=? WHERE singleton=1',args:[JSON.stringify(doc),now]});
          await tx.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[user.id,'product_archive',JSON.stringify({id,reason}),now]});
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
        const tx=await beginWriteTransaction(db);
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
        const b=bodyOf(req),revision=expectedRevision(b.expectedRevision),p=previewSnapshot(b.state),tx=await beginWriteTransaction(db);
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
