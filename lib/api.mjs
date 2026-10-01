import {randomUUID} from 'node:crypto';
import {digest,newToken,hashPassword,verifyPassword,validUsername,validPassword,normalizePermissions,mayView} from './security.mjs';
import {previewSnapshot,expectedRevision} from './migration.mjs';
import {handleStockApi} from './stock-api.mjs';
import {checkoutPos,queuePosAction,startSplitPayment,paySplitPayment,getSplitPaymentStatus,cancelSplitPayment} from './pos-api.mjs';
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
