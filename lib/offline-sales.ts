import {api,type Bootstrap,type Session} from "@/lib/api-client";
import {offlineCashDelete,offlineCashList,offlineCashPatch,offlineCashPut,type OfflineCashRecord,type OfflineStockShortage} from "@/lib/offline-db";
import {cartAvailability} from "@/lib/domain/availability.mjs";

type CartLine={id:string;variant:string;qty:number};
export type OfflineCashSummary={pending:number;needsReview:number;stockReconciliation:number;businessReview:number;total:number};
export type OfflineCashSyncResult=OfflineCashSummary&{synced:number};
export type OfflineCashReviewItem={
  requestKey:string;
  localNo:string;
  createdAt:number;
  total:number;
  reviewKind:"business_rejection"|"stock_reconciliation";
  lastError?:string;
  acceptedOrderId?:string;
  acceptedSaleIds:string[];
  stockShortages:OfflineStockShortage[];
};

export async function queueOfflineCashSale(body:Record<string,any>,options:{projectStock?:boolean}={}){
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
  const bootstrap=await offlineCashPut(record,options.projectStock?(current:Bootstrap)=>{
    if(!Array.isArray(body.cart)||!body.cart.length||!cartAvailability({cart:body.cart,menu:current.menu,stock:current.availabilityStock}).available)throw new Error("stock_shortage");
    return applyOfflineCashToBootstrap(current,body.cart);
  }:undefined) as Bootstrap|undefined;
  return {...record,bootstrap};
}

export async function getOfflineCashSummary():Promise<OfflineCashSummary>{
  const rows=await offlineCashList();
  const pending=rows.filter(x=>x.status==="pending").length;
  const needsReview=rows.filter(x=>x.status==="needs_review").length;
  const stockReconciliation=rows.filter(x=>x.status==="needs_review"&&x.reviewKind==="stock_reconciliation").length;
  const businessReview=Math.max(0,needsReview-stockReconciliation);
  return {pending,needsReview,stockReconciliation,businessReview,total:rows.length};
}

export async function getOfflineCashReviews():Promise<OfflineCashReviewItem[]>{
  const rows=await offlineCashList();
  return rows.filter(x=>x.status==="needs_review").map(row=>({
    requestKey:row.requestKey,
    localNo:row.localNo,
    createdAt:Number(row.createdAt)||0,
    total:Number(row.body?.total)||0,
    reviewKind:row.reviewKind==="stock_reconciliation"?"stock_reconciliation":"business_rejection",
    lastError:row.lastError,
    acceptedOrderId:row.acceptedOrderId,
    acceptedSaleIds:Array.isArray(row.acceptedSaleIds)?row.acceptedSaleIds.map(String):[],
    stockShortages:Array.isArray(row.stockShortages)?row.stockShortages.map(x=>({...x})):[],
  }));
}

export async function acknowledgeOfflineStockReconciliation(requestKey:string):Promise<OfflineCashSummary>{
  const rows=await offlineCashList();
  const row=rows.find(x=>x.requestKey===requestKey);
  if(!row||row.status!=="needs_review"||row.reviewKind!=="stock_reconciliation"
    ||!row.acceptedOrderId||!Array.isArray(row.acceptedSaleIds)||!row.acceptedSaleIds.length){
    throw new Error("offline_stock_reconciliation_not_found");
  }
  await offlineCashDelete(requestKey);
  return getOfflineCashSummary();
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

function isConfirmedOfflineReceipt(row:OfflineCashRecord,receipt:any){
  const hasIdentity=(value:unknown)=>typeof value==="string"&&value.trim().length>0;
  const expectedTotal=Number(row.body.total);
  return receipt?.ok===true&&hasIdentity(receipt.orderId)
    &&Array.isArray(receipt.saleIds)&&receipt.saleIds.length>0&&receipt.saleIds.every(hasIdentity)
    &&Number.isFinite(receipt.total)&&receipt.total>=0
    &&Number.isFinite(expectedTotal)&&Math.abs(receipt.total-expectedTotal)<=0.001
    &&(row.body.offlineFulfilled!==true||receipt.offlineFulfilled===true);
}

async function acceptConfirmedOfflineReceipt(row:OfflineCashRecord,receipt:any){
  if(!isConfirmedOfflineReceipt(row,receipt))throw new Error("offline_sync_unconfirmed");
  if(receipt.stockReconciliationRequired===true){
    const stockShortages:OfflineStockShortage[]=(Array.isArray(receipt.stockShortages)?receipt.stockShortages:[])
      .map((item:any)=>({
        ingredientId:String(item?.ingredientId||""),
        available:Number.isFinite(Number(item?.available))?Number(item.available):0,
        required:Number.isFinite(Number(item?.required))?Number(item.required):0,
        deficit:Number.isFinite(Number(item?.deficit))?Number(item.deficit):0
      })).filter((item:OfflineStockShortage)=>item.ingredientId.length>0);
    await offlineCashPatch(row.requestKey,{
      status:"needs_review",
      reviewKind:"stock_reconciliation",
      lastError:"stock_reconciliation_required",
      lastAttemptAt:Date.now(),
      acceptedOrderId:String(receipt.orderId),
      acceptedSaleIds:receipt.saleIds.map(String),
      acceptedAt:Date.now(),
      stockShortages
    });
    return;
  }
  await offlineCashDelete(row.requestKey);
}

async function recoverCommittedOfflineReceipt(session:Session,row:OfflineCashRecord){
  return api<any>("/api/pos/offline/replay",{
    method:"POST",
    headers:{"X-CSRF-Token":session.csrf},
    body:JSON.stringify({requestKey:row.requestKey,expectedTotal:Number(row.body.total)})
  });
}

export async function syncOfflineCashSales(session:Session):Promise<OfflineCashSyncResult>{
  if(session.offline||!session.csrf)throw new Error("offline_session_revalidation");
  const rows=await offlineCashList();
  let synced=0;
  for(const row of rows){
    if(row.status!=="pending")continue;
    if(typeof navigator!=="undefined"&&!navigator.onLine)throw new Error("offline_write_blocked");
    await offlineCashPatch(row.requestKey,{attempts:Number(row.attempts||0)+1,lastAttemptAt:Date.now(),lastError:undefined});
    try{
      const receipt=await api<any>("/api/pos/checkout",{
        method:"POST",
        headers:{"X-CSRF-Token":session.csrf},
        body:JSON.stringify(row.body)
      });
      // HTTP success alone can be an empty/proxy response. Retain the original
      // idempotent bill unless the checkout contract confirms a committed sale.
      await acceptConfirmedOfflineReceipt(row,receipt);
      synced++;
    }catch(error:any){
      const code=String(error?.message||"sync_failed");
      const status=Number(error?.status)||0;
      if(status===409&&code==="request_key_conflict"){
        try{
          // The original operator may have committed successfully before the device
          // lost its acknowledgement. A later operator must recover that exact
          // committed Offline receipt, never create a replacement request key.
          const recovered=await recoverCommittedOfflineReceipt(session,row);
          await acceptConfirmedOfflineReceipt(row,recovered);
          synced++;
          continue;
        }catch(recoveryError:any){
          const recoveryCode=String(recoveryError?.message||"offline_replay_lookup_failed");
          const recoveryStatus=Number(recoveryError?.status)||0;
          if(recoveryStatus===404&&recoveryCode==="offline_request_not_found"){
            await offlineCashPatch(row.requestKey,{status:"needs_review",reviewKind:"business_rejection",lastError:code,lastAttemptAt:Date.now()});
            continue;
          }
          await offlineCashPatch(row.requestKey,{lastError:recoveryCode,lastAttemptAt:Date.now()});
          throw recoveryError;
        }
      }
      if(status>=400&&status<500&&![401,403,408,425,429].includes(status)){
        await offlineCashPatch(row.requestKey,{status:"needs_review",reviewKind:"business_rejection",lastError:code,lastAttemptAt:Date.now()});
        continue;
      }
      await offlineCashPatch(row.requestKey,{lastError:code,lastAttemptAt:Date.now()});
      // Authentication, throttling, network and local-delete failures remain retryable.
      // Do not let the caller publish a successful sync for an incomplete attempt.
      throw error;
    }
  }
  const summary=await getOfflineCashSummary();
  return {...summary,synced};
}
