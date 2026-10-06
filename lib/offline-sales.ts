import {api,type Bootstrap,type Session} from "@/lib/api-client";
import {offlineCashDelete,offlineCashList,offlineCashPatch,offlineCashPut,type OfflineCashRecord} from "@/lib/offline-db";

type CartLine={id:string;variant:string;qty:number};
export type OfflineCashSummary={pending:number;needsReview:number;total:number};
export type OfflineCashSyncResult=OfflineCashSummary&{synced:number};

export async function queueOfflineCashSale(body:Record<string,any>){
  const createdAt=Number(body.offlineCreatedAt)||Date.now();
  const requestKey=String(body.requestKey||"");
  if(requestKey.length<8)throw new Error("invalid_request_key");
  const record:OfflineCashRecord={
    requestKey,
    body,
    createdAt,
    localNo:"OFF-"+String(createdAt).slice(-6),
    status:"pending",
    attempts:0
  };
  await offlineCashPut(record);
  return record;
}

export async function getOfflineCashSummary():Promise<OfflineCashSummary>{
  const rows=await offlineCashList();
  const pending=rows.filter(x=>x.status==="pending").length;
  const needsReview=rows.filter(x=>x.status==="needs_review").length;
  return {pending,needsReview,total:rows.length};
}

function recalcVariant(v:any,stock:Bootstrap["availabilityStock"]){
  const entries=Object.entries(v.recipeItems||{}).filter(([,raw])=>Number(raw)>0);
  if(!entries.length)return {...v,available:false,maxServings:0};
  let max=Number.POSITIVE_INFINITY;
  for(const [ingredientId,raw] of entries){
    const need=Number(raw),row=stock[ingredientId];
    if(!row||!Number.isFinite(Number(row.qty))){max=0;break}
    max=Math.min(max,Math.floor(Math.max(0,Number(row.qty))/need));
  }
  if(!Number.isFinite(max))max=0;
  return {...v,available:max>=1,maxServings:Math.max(0,max),lowStock:max>=1&&(v.lowStock===true||max<=2)};
}

export function applyOfflineCashToBootstrap(data:Bootstrap|null,cart:CartLine[]):Bootstrap|null{
  if(!data)return data;
  const stock=Object.fromEntries(Object.entries(data.availabilityStock||{}).map(([id,row])=>[id,{...row}]));
  for(const line of cart){
    const menu=(data.menu||[]).find(x=>x.id===line.id);
    const variant=menu?.variants?.find(v=>v.label===line.variant);
    for(const [ingredientId,raw] of Object.entries(variant?.recipeItems||{})){
      const qty=Number(raw)*Number(line.qty||0);
      if(qty<=0||!stock[ingredientId])continue;
      stock[ingredientId]={...stock[ingredientId],qty:Number(stock[ingredientId].qty)-qty};
    }
  }
  const menu=(data.menu||[]).map(item=>{
    const variants=(item.variants||[]).map(v=>recalcVariant(v,stock));
    const available=!!item.enabled&&variants.some(v=>v.available);
    const maxServings=variants.length?Math.max(0,...variants.map(v=>Number(v.maxServings)||0)):0;
    return {...item,variants,available,maxServings,lowStock:available&&variants.some(v=>v.available&&v.lowStock)};
  });
  return {...data,menu,availabilityStock:stock};
}

export async function syncOfflineCashSales(session:Session):Promise<OfflineCashSyncResult>{
  const rows=await offlineCashList();
  let synced=0;
  for(const row of rows){
    if(row.status!=="pending")continue;
    if(typeof navigator!=="undefined"&&!navigator.onLine)break;
    await offlineCashPatch(row.requestKey,{attempts:Number(row.attempts||0)+1,lastAttemptAt:Date.now(),lastError:undefined});
    try{
      await api<any>("/api/pos/checkout",{
        method:"POST",
        headers:{"X-CSRF-Token":session.csrf},
        body:JSON.stringify(row.body)
      });
      await offlineCashDelete(row.requestKey);
      synced++;
    }catch(error:any){
      const code=String(error?.message||"sync_failed");
      if(["network_unavailable","offline_write_blocked"].includes(code)||!error?.status)break;
      if(Number(error.status)>=400&&Number(error.status)<500){
        await offlineCashPatch(row.requestKey,{status:"needs_review",lastError:code,lastAttemptAt:Date.now()});
        continue;
      }
      await offlineCashPatch(row.requestKey,{lastError:code,lastAttemptAt:Date.now()});
      break;
    }
  }
  const summary=await getOfflineCashSummary();
  return {...summary,synced};
}
