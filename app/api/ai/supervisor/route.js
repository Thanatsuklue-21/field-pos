import {getDb,ensureDbSchema} from "../../../../lib/db.mjs";
import {authenticateAiRequest,loadAiSupervisorSnapshot,filterAiSupervisorSnapshot} from "../../../../lib/ai-supervisor-server.mjs";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function GET(request){
  try{
    await ensureDbSchema();const db=getDb(),auth=await authenticateAiRequest(db,request);
    return Response.json(filterAiSupervisorSnapshot(await loadAiSupervisorSnapshot(db),auth.user),{headers:{'Cache-Control':'no-store'}});
  }catch(e){return Response.json({error:e?.message||'server_error'},{status:e?.status||500})}
}
