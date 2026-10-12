import {getDb,ensureDbSchema} from "../../../../lib/db.mjs";
import {authenticateAiRequest,loadAiSupervisorSnapshot} from "../../../../lib/ai-supervisor-server.mjs";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function GET(request){
  try{
    await ensureDbSchema();const db=getDb();await authenticateAiRequest(db,request);
    return Response.json(await loadAiSupervisorSnapshot(db),{headers:{'Cache-Control':'no-store'}});
  }catch(e){return Response.json({error:e?.message||'server_error'},{status:e?.status||500})}
}
