const VERSION="field-pwa-v5",SHELL_CACHE=VERSION+"-shell",RUNTIME_CACHE=VERSION+"-runtime",CACHE_PREFIX="field-pwa-";
const SAFE_OFFLINE_ROUTES=["/pos","/settings"];
const PRECACHE=[...SAFE_OFFLINE_ROUTES,"/manifest.webmanifest","/field-icon-180.png","/field-icon-192.png","/field-icon-512.png"];

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

async function warmShell(){
  const shell=await caches.open(SHELL_CACHE),runtime=await caches.open(RUNTIME_CACHE),assets=new Set();
  await Promise.allSettled(PRECACHE.map(async url=>{
    const request=new Request(url,{cache:"reload"}),response=await fetch(request);
    if(!response?.ok)return;
    await shell.put(request,response.clone());
    if(SAFE_OFFLINE_ROUTES.includes(url)){
      for(const asset of nextStaticUrls(await response.clone().text()))assets.add(asset);
    }
  }));
  await Promise.allSettled([...assets].map(async url=>{
    const request=new Request(url,{cache:"reload"}),response=await fetch(request);
    if(response?.ok)await runtime.put(request,response.clone());
  }));
}

self.addEventListener("install",event=>{event.waitUntil(warmShell());});
self.addEventListener("activate",event=>{event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&![SHELL_CACHE,RUNTIME_CACHE].includes(key)).map(key=>caches.delete(key)));await self.clients.claim();})());});
self.addEventListener("message",event=>{if(event.data?.type==="SKIP_WAITING")self.skipWaiting();});

async function networkFirstNavigation(request){const cache=await caches.open(SHELL_CACHE);try{const response=await fetch(request);if(response?.ok)await cache.put(request,response.clone());return response}catch{return (await cache.match(request,{ignoreSearch:true}))||(await cache.match("/pos"))||Response.error()}}
async function cacheFirstAsset(request){const cache=await caches.open(RUNTIME_CACHE),hit=await cache.match(request);if(hit)return hit;const response=await fetch(request);if(response?.ok)await cache.put(request,response.clone());return response}
async function staleWhileRevalidateImage(request){const cache=await caches.open(RUNTIME_CACHE),cached=await cache.match(request);const network=fetch(request).then(async response=>{if(response?.ok)await cache.put(request,response.clone());return response}).catch(()=>null);return cached||(await network)||Response.error()}

self.addEventListener("fetch",event=>{const request=event.request;if(request.method!=="GET")return;const url=new URL(request.url);if(url.origin!==self.location.origin)return;
  if(url.pathname.startsWith("/api/"))return;
  if(request.mode==="navigate"){event.respondWith(networkFirstNavigation(request));return}
  if(url.pathname.startsWith("/_next/static/")||["script","style","font"].includes(request.destination)){event.respondWith(cacheFirstAsset(request));return}
  if(request.destination==="image")event.respondWith(staleWhileRevalidateImage(request));
});
