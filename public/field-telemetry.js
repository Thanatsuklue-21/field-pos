(()=>{
'use strict';

const PROJECT_TOKEN='phc_CivP85Vkv7DJpEdTdxSX9jPzCCNmyeGtbnhJp5DKWXR8';
const INGEST='https://us.i.posthog.com/i/v0/e/';
const DEVICE_KEY='field_telemetry_device_v1';
const SESSION_KEY='field_telemetry_session_v1';
const startedAt=performance.now();

function randomId(prefix){
  try{return prefix+crypto.randomUUID()}catch{return prefix+Date.now().toString(36)+Math.random().toString(36).slice(2)}
}
function storageId(storage,key,prefix){
  let id=storage.getItem(key);
  if(!id){id=randomId(prefix);storage.setItem(key,id)}
  return id;
}
const distinctId=storageId(localStorage,DEVICE_KEY,'device-');
const sessionId=storageId(sessionStorage,SESSION_KEY,'session-');

function safeError(error){
  if(!error)return {};
  return {
    error_name:String(error.name||'Error').slice(0,120),
    error_message:String(error.message||error).slice(0,500),
    error_stack:String(error.stack||'').slice(0,4000)
  };
}
function baseProps(){
  return {
    app:'field-pos',
    app_version:'v7.4',
    environment:location.hostname==='field-pos.vercel.app'?'production':'preview',
    session_id:sessionId,
    viewport_width:window.innerWidth,
    viewport_height:window.innerHeight,
    device_pixel_ratio:window.devicePixelRatio||1,
    online:navigator.onLine,
    page_path:location.pathname
  };
}
function capture(event,properties={}){
  const payload={
    api_key:PROJECT_TOKEN,
    event:String(event),
    distinct_id:distinctId,
    timestamp:new Date().toISOString(),
    properties:{...baseProps(),...properties}
  };
  const body=JSON.stringify(payload);
  try{
    if(document.visibilityState==='hidden'&&navigator.sendBeacon){
      navigator.sendBeacon(INGEST,new Blob([body],{type:'application/json'}));
      return;
    }
    fetch(INGEST,{method:'POST',headers:{'Content-Type':'application/json'},body,keepalive:true,credentials:'omit'}).catch(()=>{});
  }catch{}
}
window.FIELD_TELEMETRY={capture};

window.addEventListener('error',event=>{
  capture('field error',{
    source:'window_error',
    filename:String(event.filename||'').slice(-180),
    line:event.lineno||0,
    column:event.colno||0,
    ...safeError(event.error||event.message)
  });
});
window.addEventListener('unhandledrejection',event=>{
  capture('field error',{source:'unhandled_rejection',...safeError(event.reason)});
});
window.addEventListener('online',()=>capture('field connectivity changed',{status:'online'}));
window.addEventListener('offline',()=>capture('field connectivity changed',{status:'offline'}));

const nativeFetch=window.fetch.bind(window);
window.fetch=async function(input,init){
  const url=typeof input==='string'?input:(input?.url||'');
  const isApi=/\/api\//.test(url);
  if(!isApi)return nativeFetch(input,init);
  const started=performance.now();
  let status=0,ok=false,error=null;
  try{
    const response=await nativeFetch(input,init);
    status=response.status;ok=response.ok;
    return response;
  }catch(e){
    error=e;
    throw e;
  }finally{
    const ms=Math.round(performance.now()-started);
    let route=url;
    try{route=new URL(url,location.origin).pathname}catch{}
    const noisyMeta=route==='/api/state/meta'&&ok&&ms<800;
    if(!noisyMeta){
      capture('field api request',{
        route,
        method:String(init?.method||'GET').toUpperCase(),
        status,
        ok,
        duration_ms:ms,
        ...(error?safeError(error):{})
      });
    }
  }
};

document.addEventListener('click',event=>{
  const target=event.target?.closest?.('button,[data-start],[data-finish],[data-advance]');
  if(!target)return;
  const id=target.id||'';
  if(id==='checkoutBtn')capture('checkout opened',{step:'cart'});
  else if(id==='confirmGoPayBtn')capture('checkout opened',{step:'payment'});
  else if(id==='payModeSplit')capture('split payment started');
  else if(id==='payModeFull')capture('full payment selected');
  else if(id==='confirmPaymentBtn')capture('payment submit clicked',{
    method:document.getElementById('payModal')?.dataset?.method||'unknown',
    split:document.getElementById('payModeSplit')?.classList.contains('active')||false
  });
  else if(target.matches('[data-start]'))capture('queue action',{action:'start'});
  else if(target.matches('[data-finish]'))capture('queue action',{action:'finish'});
  else if(target.matches('[data-advance]'))capture('queue action',{action:'return'});
  else if(target.matches('.paytab'))capture('payment method selected',{method:target.dataset.pay||'unknown'});
},{capture:true});

window.addEventListener('load',()=>{
  capture('field app loaded',{load_ms:Math.round(performance.now()-startedAt)});
  try{
    const nav=performance.getEntriesByType('navigation')[0];
    if(nav){
      capture('field page performance',{
        dns_ms:Math.round(nav.domainLookupEnd-nav.domainLookupStart),
        connect_ms:Math.round(nav.connectEnd-nav.connectStart),
        ttfb_ms:Math.round(nav.responseStart-nav.requestStart),
        dom_interactive_ms:Math.round(nav.domInteractive-nav.startTime),
        load_ms:Math.round(nav.loadEventEnd-nav.startTime)
      });
    }
  }catch{}
});

try{
  if('PerformanceObserver'in window){
    const po=new PerformanceObserver(list=>{
      for(const e of list.getEntries()){
        if(e.duration>=200)capture('field long task',{duration_ms:Math.round(e.duration)});
      }
    });
    po.observe({entryTypes:['longtask']});
  }
}catch{}
})();