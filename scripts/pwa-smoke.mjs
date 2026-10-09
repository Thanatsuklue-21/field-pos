import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

function requireValue(ok,message){if(!ok)throw new Error(message)}

export async function runPwaSmoke({baseUrl,expectedSha,bypassSecret="",fetchImpl=fetch,requestTimeoutMs=10_000}){
  requireValue(baseUrl,"BASE_URL_required");
  requireValue(/^[a-f0-9]{40}$/i.test(expectedSha||""),"EXPECTED_SHA_requires_full_commit");
  const base=new URL(baseUrl);
  requireValue(["https:","http:"].includes(base.protocol)&&!base.username&&!base.password,"BASE_URL_invalid");
  const localWorker=await readFile(new URL("../public/sw.js",import.meta.url),"utf8");
  const versionOf=source=>source.match(/^const VERSION="(field-pwa-v\d+)"/m)?.[1];
  const expectedVersion=versionOf(localWorker);
  requireValue(expectedVersion,"candidate_sw_version_missing");

  async function get(path){
    let url=new URL(path,base);
    requireValue(url.origin===base.origin,path+"_cross_origin_asset");
    for(let hop=0;hop<5;hop++){
      requireValue(url.origin===base.origin,path+"_cross_origin_redirect");
      const headers={"Cache-Control":"no-cache"};
      if(bypassSecret)headers["x-vercel-protection-bypass"]=bypassSecret;
      let response;
      try{response=await fetchImpl(url,{redirect:"manual",cache:"no-store",headers,signal:AbortSignal.timeout(requestTimeoutMs)})}
      catch{throw new Error(path+"_fetch_failed_or_timeout")}
      if(response.status>=300&&response.status<400){
        const location=response.headers.get("location");
        requireValue(location,path+"_redirect_without_location");
        const next=new URL(location,url);
        requireValue(next.origin===base.origin,path+"_cross_origin_redirect");
        requireValue(next.pathname.replace(/\/$/,"")===url.pathname.replace(/\/$/,""),path+"_unexpected_redirect");
        url=next;continue;
      }
      requireValue(response.ok,path+"_http_"+response.status);
      return response;
    }
    throw new Error(path+"_too_many_redirects");
  }
  async function json(path){
    const response=await get(path);
    requireValue(/application\/(?:[a-z0-9.+-]*\+)?json(?:;|$)/i.test(response.headers.get("content-type")||""),path+"_not_json");
    return response.json();
  }
  const manifest=await json("/manifest.webmanifest");
  requireValue(manifest?.name==="FIELD POS","manifest_name");
  requireValue(manifest?.start_url==="/pos","manifest_start_url");
  requireValue(manifest?.display==="standalone","manifest_display");
  requireValue(String(manifest?.background_color||"").toLowerCase()!=="#000000","manifest_black_splash");
  for(const size of [192,512]){
    const icon=manifest?.icons?.find(x=>x.sizes===`${size}x${size}`);
    requireValue(icon?.src,"manifest_icon_"+size);
    const response=await get(icon.src),bytes=new Uint8Array(await response.arrayBuffer());
    requireValue(/image\/png/i.test(response.headers.get("content-type")||""),"icon_type_"+size);
    requireValue(bytes.length>=24&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value),"icon_png_"+size);
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    requireValue(view.getUint32(16)===size&&view.getUint32(20)===size,"icon_dimensions_"+size);
  }

  const swResponse=await get("/sw.js"),sw=await swResponse.text();
  requireValue(/(?:application|text)\/(?:javascript|x-javascript)/i.test(swResponse.headers.get("content-type")||""),"sw_content_type");
  requireValue(versionOf(sw)===expectedVersion,"sw_version_mismatch");
  requireValue(sw.includes('url.pathname.startsWith("/api/")'),"sw_api_bypass");
  requireValue(sw.includes('SAFE_OFFLINE_ROUTES=["/pos","/settings"]'),"sw_safe_routes");
  requireValue(sw.includes("if(response?.ok&&safe)"),"unsafe_shell_not_cached");
  const swCache=String(swResponse.headers.get("cache-control")||"");
  requireValue(swCache.includes("no-cache")||swCache.includes("no-store"),"sw_cache_header");
  for(const path of ["/pos","/settings"]){
    const response=await get(path),html=await response.text();
    requireValue(/text\/html/i.test(response.headers.get("content-type")||"")&&/<html[\s>]/i.test(html)&&html.includes("/_next/static/"),path+"_not_app_shell");
  }
  const build=await json("/api/build");
  requireValue(build?.buildSha===expectedSha,"build_sha_mismatch:"+build?.buildSha);
  requireValue(typeof build?.environment==="string"&&build.environment.length>0,"build_environment");
  let health;
  try{health=await json("/api/health")}
  catch(error){throw new Error("server_health_gate_failed:"+error.message)}
  requireValue(health?.ok===true&&health?.storage==="turso","health_storage");
  return {ok:true,origin:base.origin,buildSha:build.buildSha,environment:build.environment,protectionBypassUsed:Boolean(bypassSecret),
    manifest:{name:manifest.name,start_url:manifest.start_url,display:manifest.display},
    serviceWorker:{version:expectedVersion,safeRoutes:["/pos","/settings"]},shells:["/pos","/settings"]};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await runPwaSmoke({baseUrl:String(process.env.BASE_URL||"").trim(),expectedSha:String(process.env.EXPECTED_SHA||"").trim(),bypassSecret:String(process.env.VERCEL_AUTOMATION_BYPASS_SECRET||"").trim()});
  console.log(JSON.stringify(result,null,2));
}
