import {randomUUID} from 'node:crypto';

// Persistent delivery intent; duplicate payment callbacks can retry failed pushes.
// The retry key stays unchanged when LINE accepted a request but its response was lost.
export async function notifyKitchenPayment(db,payment,{fetcher=fetch,now=Date.now()}={}){
  const token=process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const target=process.env.LINE_KITCHEN_GROUP_ID;
  if(!token||!/^C[0-9a-f]{32}$/i.test(target||''))return;
  try{
    const text=`🔔 ชำระเงินแล้ว • คิว #${payment.queueNo}\nยอด ${Number(payment.total).toFixed(2)} บาท\nออเดอร์ ${payment.orderId}`;
    await db.execute({sql:'INSERT OR IGNORE INTO field_line_outbox(session_id,retry_key,target,message,created_at) VALUES(?,?,?,?,?)',args:[payment.sessionId,randomUUID(),target,text,now]});
    const claim=await db.execute({sql:"UPDATE field_line_outbox SET state='sending',attempts=attempts+1,next_at=? WHERE session_id=? AND state IN ('pending','sending') AND next_at<=? AND created_at>? RETURNING *",args:[now+60000,payment.sessionId,now,now-23*60*60*1000]});
    const job=claim.rows[0];if(!job)return;
    let accepted=false,blocked=false;
    try{
      const response=await fetcher('https://api.line.me/v2/bot/message/push',{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,'X-Line-Retry-Key':job.retry_key},
        body:JSON.stringify({to:job.target,messages:[{type:'text',text:job.message}]})
      });
      accepted=response.ok||(response.status===409&&!!response.headers.get('x-line-accepted-request-id'));
      blocked=!accepted&&response.status>=400&&response.status<500;
      await response.body?.cancel();
    }catch{console.error('[line-kitchen] delivery unavailable')}
    await db.execute({sql:"UPDATE field_line_outbox SET state=?,sent_at=?,next_at=? WHERE session_id=? AND retry_key=?",args:[accepted?'sent':blocked?'blocked':'pending',accepted?now:null,accepted?0:now+Math.min(3600000,30000*2**Math.min(Number(job.attempts),6)),payment.sessionId,job.retry_key]});
    if(!accepted)console.error('[line-kitchen] notification pending retry');
  }catch{console.error('[line-kitchen] outbox unavailable')}
}
