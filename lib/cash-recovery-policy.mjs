export function shouldRetainCashPending(error={}){
  const status=Number(error?.status);
  const code=String(error?.message||"");
  if(["network_unavailable","offline_write_blocked","offline_session_revalidation"].includes(code))return true;
  if(!Number.isFinite(status)||status<=0)return true;
  if([401,403,408,425,429].includes(status))return true;
  return status>=500;
}
