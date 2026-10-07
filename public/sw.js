const VERSION="field-pwa-v2",SHELL_CACHE=VERSION+"-shell",RUNTIME_CACHE=VERSION+"-runtime",CACHE_PREFIX="field-pwa-";
const PRECACHE=["/pos","/field-icon-180.png","/field-icon-192.png","/field-icon-512.png"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(SHELL_CACHE).then(cache=>Promise.allSettled(PRECACHE.map(url=>cache.add(new Request(url,{cache:"reload"}))))));});
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
