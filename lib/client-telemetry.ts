"use client";

export type ClientTelemetryProperties=Record<string,string|number|boolean|null|undefined>;

export function captureClientTelemetry(name:string,properties:ClientTelemetryProperties={}){
  if(typeof window==="undefined")return;
  try{(window as any).posthog?.capture?.(name,properties)}catch{}
}

export function clientNow(){
  return typeof performance!=="undefined"&&typeof performance.now==="function"?performance.now():Date.now();
}

export function elapsedMs(start:number){
  return Math.max(0,Math.round(clientNow()-start));
}
