import {digest} from './security.mjs';
import {bangkokDate} from './time.mjs';
import {buildAiSupervisorSnapshot} from './domain/ai-supervisor.mjs';

const one=async(db,sql,args=[])=>(await db.execute({sql,args})).rows[0];
export async function authenticateAiRequest(db,request,{write=false,origin}={}){
  const token=request.cookies?.get?.('field_session')?.value||'';
  if(!token)throw Object.assign(new Error('login_required'),{status:401});
  const now=Date.now();
  const row=await one(db,'SELECT s.csrf_token,u.id,u.username,u.role,u.permissions,u.active FROM field_sessions s JOIN field_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?',[digest(token),now]);
  if(!row?.active)throw Object.assign(new Error('login_required'),{status:401});
  if(write){
    if(origin&&request.headers.get('origin')!==origin)throw Object.assign(new Error('origin_denied'),{status:403});
    if(request.headers.get('x-csrf-token')!==row.csrf_token)throw Object.assign(new Error('csrf_denied'),{status:403});
  }
  return {user:{id:row.id,username:row.username,role:row.role,permissions:JSON.parse(row.permissions||'{}')},csrf:row.csrf_token};
}
export async function loadAiSupervisorSnapshot(db,now=Date.now()){
  const state=await one(db,'SELECT revision,document FROM field_state WHERE singleton=1');
  const doc=JSON.parse(state?.document||'{}');
  const audit=(await db.execute('SELECT actor_id,action,created_at FROM field_audit ORDER BY id DESC LIMIT 60')).rows.map(x=>({...x}));
  return {...buildAiSupervisorSnapshot({doc,audit,date:bangkokDate(now),now}),revision:Number(state?.revision||0)};
}
export function filterAiSupervisorSnapshot(snapshot,user){
  if(user?.role==='admin')return snapshot;
  const p=user?.permissions||{},allowedAreas=new Set();
  if(p.order||p.queue)allowedAreas.add('flow');
  if(p.order)allowedAreas.add('money');
  if(p.stock)allowedAreas.add('stock');
  const report=!!p.report;
  const alerts=(snapshot.alerts||[]).filter(a=>allowedAreas.has(a.area)&&(a.area!=='money'||report||a.id==='payment-pending'));
  const metrics={
    revenue:report?snapshot.metrics.revenue:0,
    refundAmount:report?snapshot.metrics.refundAmount:0,
    orders:p.order||p.queue?snapshot.metrics.orders:0,
    openOrders:p.queue?snapshot.metrics.openOrders:0,
    expenses:report?snapshot.metrics.expenses:0,
    pendingPayments:p.order?snapshot.metrics.pendingPayments:0,
    outOfStock:p.stock?snapshot.metrics.outOfStock:0,
    lowStock:p.stock?snapshot.metrics.lowStock:0,
    cashVariance:report?snapshot.metrics.cashVariance:0
  };
  return {...snapshot,alerts,metrics,auditSignals:[],health:alerts.some(a=>a.severity==='critical')?'critical':alerts.some(a=>a.severity==='high'||a.severity==='medium')?'review':'ok',topSeverity:alerts[0]?.severity||'info'};
}
const ALLOWED_HREFS=new Set(['/dashboard','/pos','/queue','/stock','/costs','/expenses','/close','/orders','/reports','/audit','/settings']);
function fallback(snapshot,message){
  const top=snapshot.alerts?.[0];
  return {answer:top?('จุดที่ควรจัดการก่อนคือ '+top.title+' — '+top.detail):'ตอนนี้ไม่พบสัญญาณ Critical/High จากกฎตรวจสอบหลัก ระบบยังควรทำ reconciliation ตามขั้นตอนปกติ',actions:top?[{type:'navigate',label:'ไปตรวจ '+top.area,href:top.href,reason:top.title}]:[],mode:'rules',message:String(message||'')};
}
function responseText(data){
  if(typeof data?.output_text==='string')return data.output_text;
  for(const item of data?.output||[])for(const c of item?.content||[])if(c?.type==='output_text'&&typeof c.text==='string')return c.text;
  return '';
}
export async function askAiSupervisor({snapshot,message}){
  const key=process.env.OPENAI_API_KEY;
  if(!key)return fallback(snapshot,message);
  const model=process.env.OPENAI_MODEL||'gpt-5.4';
  const schema={type:'object',properties:{answer:{type:'string'},actions:{type:'array',items:{type:'object',properties:{type:{type:'string',enum:['navigate','refresh']},label:{type:'string'},href:{type:'string'},reason:{type:'string'}},required:['type','label','href','reason'],additionalProperties:false}}},required:['answer','actions'],additionalProperties:false};
  const safeSnapshot={...snapshot,auditSignals:(snapshot.auditSignals||[]).map(x=>({action:x.action,createdAt:x.createdAt}))};
  const prompt='คุณคือ FIELD POS AI Supervisor หน้าที่คือช่วยให้พนักงานทำงานเร็ว ถูกต้อง และลดความเสี่ยงเงิน/สต๊อก ห้ามอ้างว่าพนักงานโกงจากสัญญาณเพียงอย่างเดียว ห้ามแนะนำให้ข้าม payment verification, ลบ audit, แก้ยอดวันปิดแล้ว หรือแก้ balance ตรงๆ Financial truth ต้องยึด deterministic snapshot. Action ที่ทำได้อัตโนมัติมี navigate/refresh เท่านั้น; refund, void, cash out, stock adjustment, close day, payment override ต้องให้คนอนุมัติในหน้าจอเดิม. ตอบภาษาไทยแบบสั้นและลงมือได้.';
  const api=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model,input:[{role:'system',content:prompt},{role:'user',content:'คำขอ: '+String(message||'ช่วยตรวจระบบตอนนี้')+'\nSnapshot: '+JSON.stringify(safeSnapshot)}],text:{format:{type:'json_schema',name:'field_ai_supervisor',strict:true,schema}}})});
  if(!api.ok)return fallback(snapshot,message);
  try{
    const data=await api.json(),parsed=JSON.parse(responseText(data)||'{}');
    const actions=(Array.isArray(parsed.actions)?parsed.actions:[]).filter(a=>['navigate','refresh'].includes(a.type)&&ALLOWED_HREFS.has(a.href));
    return {answer:String(parsed.answer||fallback(snapshot,message).answer),actions,mode:'ai'};
  }catch{return fallback(snapshot,message)}
}
