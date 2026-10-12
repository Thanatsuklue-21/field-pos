import {getDb,ensureDbSchema} from "../../../../lib/db.mjs";
import {authenticateAiRequest,loadAiSupervisorSnapshot,filterAiSupervisorSnapshot,askAiSupervisor} from "../../../../lib/ai-supervisor-server.mjs";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function POST(request){
  try{
    await ensureDbSchema();const db=getDb(),origin=process.env.PUBLIC_ORIGIN;
    const auth=await authenticateAiRequest(db,request,{write:true,origin});
    const body=await request.json().catch(()=>({})),message=String(body?.message||'').trim().slice(0,1200);
    if(!message)return Response.json({error:'message_required'},{status:400});
    const snapshot=filterAiSupervisorSnapshot(await loadAiSupervisorSnapshot(db),auth.user);
    return Response.json({...await askAiSupervisor({snapshot,message}),snapshot},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return Response.json({error:e?.message||'server_error'},{status:e?.status||500})}
}
