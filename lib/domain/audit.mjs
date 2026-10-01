const SENSITIVE=/password|secret|token|credential|authorization/i;
function clean(value,depth=0){
  if(depth>6)return '[depth-limit]';
  if(Array.isArray(value))return value.slice(0,100).map(x=>clean(x,depth+1));
  if(value&&typeof value==='object'){
    const out={};for(const [k,v] of Object.entries(value)){out[k]=SENSITIVE.test(k)?'[REDACTED]':clean(v,depth+1)}return out;
  }
  if(typeof value==='string')return value.slice(0,1000);
  return value;
}
export function safeAuditDetails(raw){
  try{return clean(typeof raw==='string'?JSON.parse(raw):raw??{})}catch{return {raw:String(raw??'').slice(0,1000)}}
}
