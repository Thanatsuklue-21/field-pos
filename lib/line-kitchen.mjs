import {randomUUID} from 'node:crypto';

const MAX_RETRY_AGE_MS=23*60*60*1000;
const LEASE_MS=60_000;

async function deliverClaimedJob(db,job,{fetcher=fetch,now=Date.now()}={}){
  const token=process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if(!token||!job)return {attempted:false};
  let accepted=false,blocked=false;
  try{
    const response=await fetcher('https://api.line.me/v2/bot/message/push',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,'X-Line-Retry-Key':job.retry_key},
      body:JSON.stringify({to:job.target,messages:[{type:'text',text:job.message}]})
    });
    accepted=response.ok||(response.status===409&&!!response.headers.get('x-line-accepted-request-id'));
    const retryableStatus=[408,425,429].includes(Number(response.status));
    blocked=!accepted&&!retryableStatus&&response.status>=400&&response.status<500;
    await response.body?.cancel();
  }catch{console.error('[line-kitchen] delivery unavailable')}
  await db.execute({sql:"UPDATE field_line_outbox SET state=?,sent_at=?,next_at=? WHERE session_id=? AND retry_key=?",args:[accepted?'sent':blocked?'blocked':'pending',accepted?now:null,accepted?0:now+Math.min(3600000,30000*2**Math.min(Number(job.attempts),6)),job.session_id,job.retry_key]});
  if(!accepted)console.error('[line-kitchen] notification pending retry');
  return {attempted:true,accepted,blocked,sessionId:String(job.session_id)};
}

async function claimDueJob(db,{sessionId=null,now=Date.now()}={}){
  const cutoff=now-MAX_RETRY_AGE_MS;
  const filter=sessionId?'session_id=? AND ':'';
  const sql=`UPDATE field_line_outbox
    SET state='sending',attempts=attempts+1,next_at=?
    WHERE session_id=(
      SELECT session_id FROM field_line_outbox
      WHERE ${filter}state IN ('pending','sending') AND next_at<=? AND created_at>?
      ORDER BY next_at ASC,created_at ASC LIMIT 1
    )
    RETURNING *`;
  // Put lease value first for UPDATE, then selector args.
  const ordered=sessionId?[now+LEASE_MS,sessionId,now,cutoff]:[now+LEASE_MS,now,cutoff];
  const claim=await db.execute({sql,args:ordered});
  return claim.rows[0]||null;
}

export async function getKitchenOutboxStatus(db,{now=Date.now()}={}){
  const cutoff=now-MAX_RETRY_AGE_MS;
  const result=await db.execute({sql:`SELECT
    COALESCE(SUM(CASE WHEN state='pending' AND created_at>? THEN 1 ELSE 0 END),0) AS pending,
    COALESCE(SUM(CASE WHEN state='sending' AND created_at>? THEN 1 ELSE 0 END),0) AS sending,
    COALESCE(SUM(CASE WHEN state IN ('pending','sending') AND created_at>? AND next_at<=? THEN 1 ELSE 0 END),0) AS retryable,
    COALESCE(SUM(CASE WHEN state='blocked' THEN 1 ELSE 0 END),0) AS blocked,
    COALESCE(SUM(CASE WHEN state IN ('pending','sending') AND created_at<=? THEN 1 ELSE 0 END),0) AS stale,
    MIN(CASE WHEN state IN ('pending','sending','blocked') THEN created_at ELSE NULL END) AS oldest_unresolved_at
    FROM field_line_outbox`,args:[cutoff,cutoff,cutoff,now,cutoff]});
  const row=result.rows[0]||{};
  const pending=Number(row.pending)||0,sending=Number(row.sending)||0,blocked=Number(row.blocked)||0,stale=Number(row.stale)||0;
  const target=process.env.LINE_KITCHEN_GROUP_ID;
  return {
    configured:!!process.env.LINE_CHANNEL_ACCESS_TOKEN&&/^C[0-9a-f]{32}$/i.test(target||''),
    pending,sending,retryable:Number(row.retryable)||0,blocked,stale,
    unresolved:pending+sending+blocked+stale,
    oldestUnresolvedAt:row.oldest_unresolved_at==null?null:Number(row.oldest_unresolved_at)||null
  };
}

// Drains due persistent notifications independently from payment-provider webhook retries.
// limit is deliberately bounded so an operator/admin request cannot monopolize a serverless invocation.
export async function drainKitchenOutbox(db,{fetcher=fetch,now=Date.now(),limit=10,sessionId=null}={}){
  if(!process.env.LINE_CHANNEL_ACCESS_TOKEN)return {ok:true,attempted:0,accepted:0,blocked:0};
  const cap=Math.max(1,Math.min(25,Number(limit)||10));
  let attempted=0,accepted=0,blocked=0;
  for(let i=0;i<cap;i++){
    const job=await claimDueJob(db,{sessionId,now});
    if(!job)break;
    const result=await deliverClaimedJob(db,job,{fetcher,now});
    if(result.attempted)attempted++;
    if(result.accepted)accepted++;
    if(result.blocked)blocked++;
    if(sessionId)break;
  }
  return {ok:true,attempted,accepted,blocked};
}

// Persistent delivery intent; duplicate payment callbacks can retry failed pushes.
// The retry key stays unchanged when LINE accepted a request but its response was lost.
export async function notifyKitchenPayment(db,payment,{fetcher=fetch,now=Date.now()}={}){
  const token=process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const target=process.env.LINE_KITCHEN_GROUP_ID;
  if(!token||!/^C[0-9a-f]{32}$/i.test(target||''))return;
  try{
    const text=`🔔 ชำระเงินแล้ว • คิว #${payment.queueNo}\nยอด ${Number(payment.total).toFixed(2)} บาท\nออเดอร์ ${payment.orderId}`;
    await db.execute({sql:'INSERT OR IGNORE INTO field_line_outbox(session_id,retry_key,target,message,created_at) VALUES(?,?,?,?,?)',args:[payment.sessionId,randomUUID(),target,text,now]});
    await drainKitchenOutbox(db,{fetcher,now,limit:1,sessionId:payment.sessionId});
  }catch{console.error('[line-kitchen] outbox unavailable')}
}
