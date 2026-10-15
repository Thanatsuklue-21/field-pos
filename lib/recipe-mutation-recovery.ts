export type RecipePublishBody={requestKey:string;operation:"publish";menuId:string;variant:string;items:Record<string,number>};
export type RecipeReconcileBody={requestKey:string;operation:"reconcile";updateId:string};
export type RecipeCommentCreateBody={requestKey:string;operation:"commentCreate";menuId:string;variant:string;authorType:"customer"|"owner"|"custom";authorName:string;text:string};
export type RecipeMutationBody=RecipePublishBody|RecipeReconcileBody|RecipeCommentCreateBody;
export type RecipeMutationIntent={version:1;actorId:string;createdAt:number;body:RecipeMutationBody};
type StorageLike=Pick<Storage,"getItem"|"setItem"|"removeItem">;
export const RECIPE_MUTATION_INTENT_PREFIX="field-recipe-mutation-pending-v1:";
const REQUEST_KEY_RE=/^[A-Za-z0-9._:-]{8,128}$/;
const keyFor=(actorId:string)=>RECIPE_MUTATION_INTENT_PREFIX+encodeURIComponent(actorId);
const fail=(code:string,cause?:unknown)=>Object.assign(new Error(code),{status:0,cause});
const plainObject=(value:any)=>!!value&&typeof value==="object"&&!Array.isArray(value);
const sorted=(value:Record<string,number>)=>Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)));

function storageOrThrow(storage?:StorageLike){
  try{return storage||localStorage}catch(cause){throw fail("recipe_recovery_unavailable",cause)}
}
function validBody(body:any):body is RecipeMutationBody{
  if(!plainObject(body)||typeof body.requestKey!=="string"||!REQUEST_KEY_RE.test(body.requestKey))return false;
  if(body.operation==="publish"){
    if(typeof body.menuId!=="string"||!body.menuId||typeof body.variant!=="string"||!body.variant||!plainObject(body.items))return false;
    const entries=Object.entries(body.items);
    return entries.length>0&&entries.every(([id,qty])=>!!id&&Number.isFinite(Number(qty))&&Number(qty)>0&&Number(qty)<=1e6);
  }
  if(body.operation==="reconcile")return typeof body.updateId==="string"&&body.updateId.length>0&&body.updateId.length<=160;
  if(body.operation==="commentCreate")return typeof body.menuId==="string"&&body.menuId.length>0
    &&typeof body.variant==="string"&&body.variant.length>0
    &&["customer","owner","custom"].includes(body.authorType)
    &&typeof body.authorName==="string"&&body.authorName.length>=1&&body.authorName.length<=80
    &&typeof body.text==="string"&&body.text.length>=2&&body.text.length<=1000;
  return false;
}
export function readRecipeMutationIntent(actorId:string,storage?:StorageLike):RecipeMutationIntent|null{
  try{
    const raw=storageOrThrow(storage).getItem(keyFor(actorId));
    if(!raw)return null;
    const intent=JSON.parse(raw) as RecipeMutationIntent;
    if(intent?.version!==1||intent.actorId!==actorId||!Number.isFinite(intent.createdAt)||!validBody(intent.body))throw new Error("invalid_intent");
    return intent;
  }catch(cause){throw fail("recipe_recovery_unavailable",cause)}
}
export function prepareRecipeMutationIntent(actorId:string,body:RecipeMutationBody,storage?:StorageLike):RecipeMutationIntent{
  if(!validBody(body))throw fail("invalid_recipe_recovery_intent");
  const normalizedBody:RecipeMutationBody=body.operation==="publish"?{...body,items:sorted(body.items)}:{...body} as RecipeMutationBody;
  const store=storageOrThrow(storage),existing=readRecipeMutationIntent(actorId,store);
  if(existing){
    if(JSON.stringify(existing.body)!==JSON.stringify(normalizedBody))throw fail("pending_recipe_mutation_exists");
    return existing;
  }
  const intent:RecipeMutationIntent={version:1,actorId,createdAt:Date.now(),body:normalizedBody};
  const raw=JSON.stringify(intent);
  try{
    store.setItem(keyFor(actorId),raw);
    if(store.getItem(keyFor(actorId))!==raw)throw new Error("intent_not_persisted");
    return intent;
  }catch(cause){throw fail("recipe_recovery_unavailable",cause)}
}
function clearIntent(intent:RecipeMutationIntent,storage:StorageLike){
  const current=readRecipeMutationIntent(intent.actorId,storage);
  if(current?.body.requestKey===intent.body.requestKey&&current.body.operation===intent.body.operation)storage.removeItem(keyFor(intent.actorId));
}
const NOT_COMMITTED=new Set([
  "login_required","csrf_denied","admin_required","invalid_request_key",
  "invalid_recipe","menu_not_found","variant_not_found","ingredient_missing","invalid_recipe_qty","empty_recipe",
  "approved_recipe_update_required","approved_recipe_update_not_found","approved_recipe_menu_not_found","approved_recipe_not_legacy_match","approved_recipe_reconcile_failed",
  "invalid_recipe_comment","comment_author_required"
]);
function definitelyNotCommitted(error:any){
  const status=Number(error?.status),code=String(error?.message||"");
  return [400,401,403,404,409,422].includes(status)&&NOT_COMMITTED.has(code);
}
function sameItems(actual:any,expected:Record<string,number>){
  if(!plainObject(actual))return false;
  return JSON.stringify(sorted(Object.fromEntries(Object.entries(actual).map(([k,v])=>[k,Number(v)]))))===JSON.stringify(sorted(expected));
}
export function exactRecipeMutationAck(result:any,intent:RecipeMutationIntent){
  const body=intent.body;
  if(result?.ok!==true||String(result.requestKey||"")!==body.requestKey||String(result.performedBy||"")!==intent.actorId||String(result.operation||"")!==body.operation)return false;
  if(body.operation==="publish"){
    return String(result.menuId||"")===body.menuId&&String(result.variant||"")===body.variant
      &&typeof result.id==="string"&&result.id.length>0&&Number.isInteger(Number(result.version))&&Number(result.version)>0
      &&sameItems(result.items,body.items);
  }
  if(body.operation==="reconcile"){
    return String(result.updateId||"")===body.updateId&&typeof result.menuId==="string"&&result.menuId.length>0
      &&typeof result.variant==="string"&&result.variant.length>0&&typeof result.id==="string"&&result.id.length>0
      &&Number.isInteger(Number(result.version))&&Number(result.version)>0&&plainObject(result.items);
  }
  const c=result?.comment;
  return typeof c?.id==="string"&&c.id.length>0&&String(c.menuId||"")===body.menuId&&String(c.variant||"")===body.variant
    &&String(c.authorType||"")===body.authorType&&String(c.authorName||"")===body.authorName&&String(c.text||"")===body.text;
}
export async function sendRecipeMutationIntent(intent:RecipeMutationIntent,send:(body:RecipeMutationBody)=>Promise<any>,storage?:StorageLike){
  const store=storageOrThrow(storage),current=readRecipeMutationIntent(intent.actorId,store);
  if(!current||JSON.stringify(current)!==JSON.stringify(intent))throw fail("recipe_recovery_unavailable");
  let result:any;
  try{result=await send(JSON.parse(JSON.stringify(intent.body)))}
  catch(error:any){
    if(definitelyNotCommitted(error))clearIntent(intent,store);
    throw error;
  }
  if(!exactRecipeMutationAck(result,intent))throw fail("recipe_ack_unknown");
  try{clearIntent(intent,store)}catch(cause){throw fail("recipe_recovery_unavailable",cause)}
  return result;
}
