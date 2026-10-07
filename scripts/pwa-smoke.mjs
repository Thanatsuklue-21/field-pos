const baseRaw=String(process.env.BASE_URL||"").trim();
const expectedSha=String(process.env.EXPECTED_SHA||"").trim();
if(!baseRaw)throw new Error("BASE_URL_required");
const base=new URL(baseRaw);
if(!["https:","http:"].includes(base.protocol))throw new Error("BASE_URL_invalid_protocol");

async function get(path){
  const url=new URL(path,base);
  const response=await fetch(url,{redirect:"follow",cache:"no-store",headers:{"Cache-Control":"no-cache"}});
  if(!response.ok)throw new Error(path+"_http_"+response.status);
  return response;
}
async function json(path){return await (await get(path)).json()}
async function text(path){return await (await get(path)).text()}
function requireValue(ok,message){if(!ok)throw new Error(message)}

const manifest=await json("/manifest.webmanifest");
requireValue(manifest?.name==="FIELD POS","manifest_name");
requireValue(manifest?.start_url==="/pos","manifest_start_url");
requireValue(manifest?.display==="standalone","manifest_display");
requireValue(Array.isArray(manifest?.icons)&&manifest.icons.some(x=>String(x.sizes)==="192x192"),"manifest_icon_192");
requireValue(manifest.icons.some(x=>String(x.sizes)==="512x512"),"manifest_icon_512");
requireValue(String(manifest?.background_color||"").toLowerCase()!=="#000000","manifest_black_splash");

const swResponse=await get("/sw.js"),sw=await swResponse.text();
requireValue(sw.includes('url.pathname.startsWith("/api/")'),"sw_api_bypass");
requireValue(sw.includes('SAFE_OFFLINE_ROUTES=["/pos","/settings"]'),"sw_safe_routes");
requireValue(sw.includes('VERSION="field-pwa-v5"'),"sw_version");
const swCache=String(swResponse.headers.get("cache-control")||"");
requireValue(swCache.includes("no-cache")||swCache.includes("no-store"),"sw_cache_header");

const [posResponse,settingsResponse,health]=await Promise.all([get("/pos"),get("/settings"),json("/api/health")]);
requireValue(posResponse.ok&&settingsResponse.ok,"safe_shell_routes");
requireValue(health?.ok===true&&health?.storage==="turso","health_storage");
requireValue(typeof health?.buildSha==="string"&&health.buildSha.length>=7,"health_build_sha");
requireValue(typeof health?.environment==="string"&&health.environment.length>0,"health_environment");
if(expectedSha)requireValue(health.buildSha===expectedSha,"build_sha_mismatch:"+health.buildSha);

console.log(JSON.stringify({
  ok:true,
  origin:base.origin,
  buildSha:health.buildSha,
  environment:health.environment,
  manifest:{name:manifest.name,start_url:manifest.start_url,display:manifest.display},
  serviceWorker:{version:"field-pwa-v5",safeRoutes:["/pos","/settings"]},
  shells:["/pos","/settings"]
},null,2));
