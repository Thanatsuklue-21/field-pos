import {createHmac,timingSafeEqual} from 'node:crypto';

const headers={'Cache-Control':'no-store'};
const MAX_BYTES=128*1024;
const reply=(status,error)=>Response.json(error?{error}:{ok:true},{status,headers});

export async function receiveLineWebhook(request){
  const secret=process.env.LINE_CHANNEL_SECRET;
  if(!secret||!secret.trim())return reply(503,'line_webhook_not_configured');
  const signature=request.headers.get('x-line-signature')||'';
  if(!/^[A-Za-z0-9+/]{43}=$/.test(signature))return reply(401,'invalid_line_signature');
  const reader=request.body?.getReader();
  if(!reader)return reply(400,'body_required');
  const chunks=[];let bytes=0;
  try{
    while(true){
      const {value,done}=await reader.read();if(done)break;
      bytes+=value.length;
      if(bytes>MAX_BYTES){await reader.cancel();return reply(413,'body_too_large')}
      chunks.push(value);
    }
  }catch{return reply(400,'invalid_body')}
  finally{reader.releaseLock()}
  const raw=Buffer.concat(chunks);
  const expected=createHmac('sha256',secret).update(raw).digest();
  const provided=Buffer.from(signature,'base64');
  if(provided.length!==expected.length||!timingSafeEqual(expected,provided))return reply(401,'invalid_line_signature');
  let payload;
  try{payload=JSON.parse(raw.toString('utf8'))}catch{return reply(400,'invalid_json')}
  if(!payload||!Array.isArray(payload.events)||payload.events.length>100)return reply(400,'invalid_events');
  // LINE Verify sends events: []. Never log message text, user IDs or raw payloads.
  const groups=new Set();
  for(const event of payload.events){
    const source=event?.source;
    if(source?.type==='group'&&/^C[0-9a-f]{32}$/i.test(source.groupId||'')&&source.groupId.startsWith('C'))groups.add(source.groupId);
  }
  for(const groupId of groups)console.log(`[line-webhook] source.groupId=${groupId}`);
  return reply(200);
}
