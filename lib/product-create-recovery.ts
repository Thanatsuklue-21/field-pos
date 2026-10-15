export type ProductCreateBody={
  requestKey:string;
  name:string;
  category:string;
  prepBaseId:string;
  price:number;
  imageDataUrl:string;
};
export type ProductCreateIntent={version:1;actorId:string;createdAt:number;body:ProductCreateBody};
type StorageLike=Pick<Storage,"getItem"|"setItem"|"removeItem">;
export const PRODUCT_CREATE_INTENT_PREFIX="field-product-create-pending-v1:";
const REQUEST_KEY_RE=/^[A-Za-z0-9._:-]{8,128}$/;
const keyFor=(actorId:string)=>PRODUCT_CREATE_INTENT_PREFIX+encodeURIComponent(actorId);
const fail=(code:string,cause?:unknown)=>Object.assign(new Error(code),{status:0,cause});

function storageOrThrow(storage?:StorageLike){
  try{return storage||localStorage}catch(cause){throw fail("product_create_recovery_unavailable",cause)}
}
function validBody(body:any):body is ProductCreateBody{
  return !!body&&typeof body==="object"&&!Array.isArray(body)
    &&typeof body.requestKey==="string"&&REQUEST_KEY_RE.test(body.requestKey)
    &&typeof body.name==="string"&&body.name.length<=120
    &&typeof body.category==="string"&&body.category.length<=80
    &&typeof body.prepBaseId==="string"&&body.prepBaseId.length<=80
    &&Number.isFinite(Number(body.price))
    &&typeof body.imageDataUrl==="string"&&body.imageDataUrl.length<=260000;
}
export function readProductCreateIntent(actorId:string,storage?:StorageLike):ProductCreateIntent|null{
  try{
    const raw=storageOrThrow(storage).getItem(keyFor(actorId));
    if(!raw)return null;
    const intent=JSON.parse(raw) as ProductCreateIntent;
    if(intent?.version!==1||intent.actorId!==actorId||!Number.isFinite(intent.createdAt)||!validBody(intent.body))throw new Error("invalid_intent");
    return intent;
  }catch(cause){throw fail("product_create_recovery_unavailable",cause)}
}
export function prepareProductCreateIntent(actorId:string,body:ProductCreateBody,storage?:StorageLike):ProductCreateIntent{
  if(!validBody(body))throw fail("invalid_product_create_intent");
  const store=storageOrThrow(storage),existing=readProductCreateIntent(actorId,store);
  if(existing){
    if(JSON.stringify(existing.body)!==JSON.stringify(body))throw fail("pending_product_create_exists");
    return existing;
  }
  const intent:ProductCreateIntent={version:1,actorId,createdAt:Date.now(),body:{...body}};
  const raw=JSON.stringify(intent);
  try{
    store.setItem(keyFor(actorId),raw);
    if(store.getItem(keyFor(actorId))!==raw)throw new Error("intent_not_persisted");
    return intent;
  }catch(cause){throw fail("product_create_recovery_unavailable",cause)}
}
function clearIntent(intent:ProductCreateIntent,storage:StorageLike){
  const current=readProductCreateIntent(intent.actorId,storage);
  if(current?.body.requestKey===intent.body.requestKey)storage.removeItem(keyFor(intent.actorId));
}
const NOT_COMMITTED=new Set([
  "login_required","csrf_denied","admin_required","invalid_request_key","invalid_product",
  "menu_category_not_found","prep_base_not_found","invalid_menu_image","menu_image_too_large"
]);
function definitelyNotCommitted(error:any){
  return [400,401,403,404,409,422].includes(Number(error?.status))&&NOT_COMMITTED.has(String(error?.message||""));
}
export function exactProductCreateAck(result:any,intent:ProductCreateIntent){
  const body=intent.body,product=result?.product,id=String(product?.id||"");
  if(result?.ok!==true||String(result.requestKey||"")!==body.requestKey||String(result.performedBy||"")!==intent.actorId||!id)return false;
  if(String(product.name||"")!==body.name||String(product.prepBaseId||"")!==body.prepBaseId||Number(product.price)!==Number(body.price)||product.enabled!==false)return false;
  if(body.category&&String(product.category||"")!==body.category)return false;
  if(body.imageDataUrl&&!String(product.image||"").startsWith("/api/menu-images/"+encodeURIComponent(id)+"?v="))return false;
  return true;
}
export async function sendProductCreateIntent(intent:ProductCreateIntent,send:(body:ProductCreateBody)=>Promise<any>,storage?:StorageLike){
  const store=storageOrThrow(storage),current=readProductCreateIntent(intent.actorId,store);
  if(!current||JSON.stringify(current)!==JSON.stringify(intent))throw fail("product_create_recovery_unavailable");
  let result:any;
  try{result=await send({...intent.body})}
  catch(error:any){
    if(definitelyNotCommitted(error))clearIntent(intent,store);
    throw error;
  }
  if(!exactProductCreateAck(result,intent))throw fail("product_create_ack_unknown");
  try{clearIntent(intent,store)}catch(cause){throw fail("product_create_recovery_unavailable",cause)}
  return result;
}
