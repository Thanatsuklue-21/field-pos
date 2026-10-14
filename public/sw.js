const CACHE="field-pos-shell-v1";
const STATIC_DESTINATIONS=new Set(["style","script","font","image"]);
const SHELL="/pos";

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.add(SHELL)).catch(()=>{}));
  self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("field-pos-shell-")&&key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  if(url.pathname.startsWith("/api/"))return;

  if(request.mode==="navigate"){
    event.respondWith(
      fetch(request).then(response=>{
        if(response.ok&&url.pathname==="/pos"){
          const copy=response.clone();
          caches.open(CACHE).then(cache=>cache.put(SHELL,copy)).catch(()=>{});
        }
        return response;
      }).catch(()=>caches.match(SHELL).then(hit=>hit||Response.error()))
    );
    return;
  }

  if(!STATIC_DESTINATIONS.has(request.destination))return;
  event.respondWith(
    caches.match(request).then(hit=>hit||fetch(request).then(response=>{
      if(response.ok){
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>{});
      }
      return response;
    }))
  );
});
