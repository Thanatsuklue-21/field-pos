const VERSION="field-pwa-v7",SHELL_CACHE=VERSION+"-shell",RUNTIME_CACHE=VERSION+"-runtime",CACHE_PREFIX="field-pwa-";
const SAFE_OFFLINE_ROUTES=["/pos","/settings"];
const OPTIONAL_PRECACHE=["/manifest.webmanifest","/field-icon-180.png","/field-icon-192.png","/field-icon-512.png"];

function nextStaticUrls(html){
  const urls=new Set();
  const re=/(?:src|href)=["']([^"']+)["']/g;
  for(const match of html.matchAll(re)){
    try{
      const url=new URL(match[1],self.location.origin);
      if(url.origin===self.location.origin&&url.pathname.startsWith("/_next/static/"))urls.add(url.href);
    }catch{}
  }
  return [...urls];
}

async function fetchRequired(request){
  const response=await fetch(request);
  if(!response?.ok)throw new Error("pwa_shell_fetch_failed:"+new URL(request.url).pathname);
  return response;
}

async function warmShell(){
  const shell=await caches.open(SHELL_CACHE),runtime=await caches.open(RUNTIME_CACHE),assets=new Set();

  // Required offline routes must be fully available before this worker may install.
  await Promise.all(SAFE_OFFLINE_ROUTES.map(async url=>{
    const request=new Request(url,{cache:"reload"}),response=await fetchRequired(request);
    await shell.put(request,response.clone());
    for(const asset of nextStaticUrls(await response.clone().text()))assets.add(asset);
  }));

  // Route-specific Next.js CSS/JS is also required for a usable cold-start, not just cached HTML.
  await Promise.all([...assets].map(async url=>{
    const request=new Request(url,{cache:"reload"}),response=await fetchRequired(request);
    await runtime.put(request,response.clone());
  }));

  // Manifest/icons are useful for install UX but must not prevent an already-installed POS update.
  await Promise.allSettled(OPTIONAL_PRECACHE.map(async url=>{
    const request=new Request(url,{cache:"reload"}),response=await fetch(request);
    if(response?.ok)await shell.put(request,response.clone());
  }));
}

self.addEventListener("install",event=>{event.waitUntil(warmShell());});
self.addEventListener("activate",event=>{event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&![SHELL_CACHE,RUNTIME_CACHE].includes(key)).map(key=>caches.delete(key)));await self.clients.claim();})());});
self.addEventListener("message",event=>{if(event.data?.type==="SKIP_WAITING")self.skipWaiting();});

async function networkFirstNavigation(request){const cache=await caches.open(SHELL_CACHE),url=new URL(request.url),safe=SAFE_OFFLINE_ROUTES.includes(url.pathname);try{const response=await fetch(request);if(response?.ok&&safe)await cache.put(url.pathname,response.clone());return response}catch{return safe?(await cache.match(url.pathname,{ignoreSearch:true})||await cache.match("/pos")||Response.error()):(await cache.match("/pos")||Response.error())}}
async function cacheFirstAsset(request){const cache=await caches.open(RUNTIME_CACHE),hit=await cache.match(request);if(hit)return hit;const response=await fetch(request);if(response?.ok)await cache.put(request,response.clone());return response}
async function staleWhileRevalidateImage(request){const cache=await caches.open(RUNTIME_CACHE),cached=await cache.match(request);const network=fetch(request).then(async response=>{if(response?.ok)await cache.put(request,response.clone());return response}).catch(()=>null);return cached||(await network)||Response.error()}

self.addEventListener("fetch",event=>{const request=event.request;if(request.method!=="GET")return;const url=new URL(request.url);if(url.origin!==self.location.origin)return;
  if(url.pathname.startsWith("/api/"))return;
  if(request.mode==="navigate"){event.respondWith(networkFirstNavigation(request));return}
  if(url.pathname.startsWith("/_next/static/")||["script","style","font"].includes(request.destination)){event.respondWith(cacheFirstAsset(request));return}
  if(request.destination==="image")event.respondWith(staleWhileRevalidateImage(request));
});
