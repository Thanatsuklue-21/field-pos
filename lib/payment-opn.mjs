const API='https://api.omise.co';

function bad(message,status=400){const e=new Error(message);e.status=status;return e}
function secret(){return String(process.env.OMISE_SECRET_KEY||'').trim()}
function authHeader(){
  const key=secret();
  if(!key)throw bad('promptpay_provider_not_configured',503);
  return 'Basic '+Buffer.from(key+':').toString('base64');
}
async function omiseFetch(path,{method='GET',form}={}){
  const headers={Authorization:authHeader(),Accept:'application/json'};
  let body;
  if(form){
    headers['Content-Type']='application/x-www-form-urlencoded';
    body=new URLSearchParams(form).toString();
  }
  const res=await fetch(API+path,{method,headers,body});
  let data={};
  try{data=await res.json()}catch{}
  if(!res.ok){
    const message=String(data?.message||data?.code||'payment_provider_error');
    throw bad(message,res.status>=500?502:400);
  }
  return data;
}
function normalizeAmount(amount){
  const baht=Number(amount);
  if(!Number.isFinite(baht)||baht<20||baht>150000)throw bad('promptpay_amount_out_of_range');
  return Math.round(baht*100);
}
function chargeResult(charge){
  return {
    provider:'opn',
    chargeId:charge?.id||null,
    status:charge?.status||'unknown',
    paid:charge?.status==='successful'||charge?.paid===true,
    amount:Number(charge?.amount||0)/100,
    currency:charge?.currency||'THB',
    qrUrl:charge?.source?.scannable_code?.image?.download_uri||null,
    expiresAt:charge?.expires_at||null,
    failureCode:charge?.failure_code||null,
    failureMessage:charge?.failure_message||null
  };
}
export function promptPayConfig(){
  const key=secret();
  return {provider:'opn',configured:!!key,mode:key.startsWith('skey_test_')||key.startsWith('sk_test_')?'test':key?'live':'unconfigured'};
}
export async function createPromptPayCharge({amount,reference}){
  const satang=normalizeAmount(amount);
  const ref=String(reference||'').slice(0,80);
  const expiresAt=new Date(Date.now()+15*60*1000).toISOString();
  const form={
    amount:String(satang),
    currency:'THB',
    'source[type]':'promptpay',
    expires_at:expiresAt
  };
  if(ref)form.description='FIELD '+ref;
  const charge=await omiseFetch('/charges',{method:'POST',form});
  const result=chargeResult(charge);
  if(!result.chargeId||!result.qrUrl)throw bad('promptpay_qr_unavailable',502);
  return result;
}
export async function getPromptPayCharge(chargeId){
  const id=String(chargeId||'');
  if(!/^chrg_[A-Za-z0-9]+$/.test(id))throw bad('invalid_charge_id');
  return chargeResult(await omiseFetch('/charges/'+encodeURIComponent(id)));
}
export async function verifyPromptPayWebhook(event){
  if(!event||typeof event!=='object')throw bad('invalid_webhook');
  const chargeId=event?.data?.id;
  if(!chargeId)return {ok:true,ignored:true};
  const charge=await getPromptPayCharge(chargeId);
  return {ok:true,charge};
}
