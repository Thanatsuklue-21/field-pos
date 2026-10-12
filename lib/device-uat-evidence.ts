"use client";

export const DEVICE_UAT_CHECK_IDS=["layout_no_overlap","keyboard_checkout","offline_cold_start","reconnect_sync","safe_update"] as const;
export type DeviceUatCheckId=typeof DEVICE_UAT_CHECK_IDS[number];
export type DeviceUatTargetClass="phone"|"tablet"|"other";
export type DeviceUatEvidence={
  version:1;
  buildSha:string;
  targetClass:DeviceUatTargetClass;
  checks:Record<DeviceUatCheckId,boolean>;
  updatedAt:number;
};

const KEY="field-pos-device-uat-evidence-v1";
const emptyChecks=()=>Object.fromEntries(DEVICE_UAT_CHECK_IDS.map(id=>[id,false])) as Record<DeviceUatCheckId,boolean>;
const validSha=(sha:string)=>/^[a-f0-9]{40}$/i.test(sha);

export function blankDeviceUatEvidence(buildSha:string,targetClass:DeviceUatTargetClass):DeviceUatEvidence|null{
  if(!validSha(buildSha))return null;
  return {version:1,buildSha,targetClass,checks:emptyChecks(),updatedAt:0};
}

export function readDeviceUatEvidence(buildSha:string,targetClass:DeviceUatTargetClass):DeviceUatEvidence|null{
  const blank=blankDeviceUatEvidence(buildSha,targetClass);
  if(!blank||typeof window==="undefined")return blank;
  try{
    const row=JSON.parse(localStorage.getItem(KEY)||"null");
    if(row?.version!==1||row?.buildSha!==buildSha||row?.targetClass!==targetClass)return blank;
    const checks=emptyChecks();
    for(const id of DEVICE_UAT_CHECK_IDS)checks[id]=row?.checks?.[id]===true;
    return {...blank,checks,updatedAt:Number.isFinite(Number(row?.updatedAt))?Number(row.updatedAt):0};
  }catch{return blank}
}

export function writeDeviceUatCheck(buildSha:string,targetClass:DeviceUatTargetClass,id:DeviceUatCheckId,passed:boolean){
  if(typeof window==="undefined"||!DEVICE_UAT_CHECK_IDS.includes(id))return null;
  const current=readDeviceUatEvidence(buildSha,targetClass);
  if(!current)return null;
  const next:DeviceUatEvidence={...current,checks:{...current.checks,[id]:passed===true},updatedAt:Date.now()};
  try{localStorage.setItem(KEY,JSON.stringify(next))}catch{return null}
  return next;
}

export function clearDeviceUatEvidence(){
  if(typeof window==="undefined")return;
  try{localStorage.removeItem(KEY)}catch{}
}

export function deviceUatProgress(evidence:DeviceUatEvidence|null){
  if(!evidence)return {passed:0,total:DEVICE_UAT_CHECK_IDS.length,complete:false};
  const passed=DEVICE_UAT_CHECK_IDS.filter(id=>evidence.checks[id]===true).length;
  return {passed,total:DEVICE_UAT_CHECK_IDS.length,complete:passed===DEVICE_UAT_CHECK_IDS.length};
}
