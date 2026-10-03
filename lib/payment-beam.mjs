import {createHmac,timingSafeEqual} from 'node:crypto';

const PLAYGROUND_API='https://playground.api.beamcheckout.com';
const PRODUCTION_API='https://api.beamcheckout.com';

function bad(message,status=400){const e=new Error(message);e.status=status;return e}
const merchantId=()=>String(process.env.BEAM_MERCHANT_ID||'').trim();
const apiKey=()=>String(process.env.BEAM_API_KEY||'').trim();
const webhookKey=()=>String(process.env.BEAM_WEBHOOK_HMAC_KEY||'').trim();
const environment=()=>String(process.env.BEAM_ENV||'playground').trim().toLowerCase()==='production'?'production':'playground';
const baseUrl=()=>environment()==='production'?PRODUCTION_API:PLAYGROUND_API;

function authHeader(){
  const merchant=merchantId(),key=apiKey();
  if(!merchant||!key)throw bad('promptpay_provider_not_configured',503);
  return 'Basic '+Buffer.from(merchant+':'+key).toString('base64');
}

async function beamFetch(path,{method='GET',json,idempotencyKey}={}){
  const headers={Authorization:authHeader(),Accept:'application/json'};
  let body;
  if(json!==undefined){
    headers['Content-Type']='application/json';
    body=JSON.stringify(json);
  }
  if(idempotencyKey)headers['x-beam-idempotency-key']=String(idempotencyKey).slice(0,255);
  const res=await fetch(baseUrl()+path,{method,headers,body});
  let data={};
  try{data=await res.json()}catch{}
  if(!res.ok){
    const code=data?.error?.errorCode||data?.errorCode||data?.code||data?.message||'payment_provider_error';
    throw bad(String(code),res.status>=500?502:res.status===401?503:400);
  }
  return data;
}

function normalizeAmount(amount){
  const baht=Number(amount);
  if(!Number.isFinite(baht)||baht<1||baht>150000)throw bad('promptpay_amount_out_of_range');
  return Math.round(baht*100);
}

function qrDataUrl(value){
  const raw=String(value||'').trim();
  if(!raw)return null;
  return raw.startsWith('data:')?raw:'data:image/png;base64,'+raw;
}

function chargeResult(charge){
  const status=String(charge?.status||(charge?.actionRequired==='ENCODED_IMAGE'?'PENDING':'UNKNOWN')).toUpperCase();
  return {
    provider:'beam',
    chargeId:charge?.chargeId||null,
    status:status.toLowerCase(),
    paid:status==='SUCCEEDED',
    amount:Number.isFinite(Number(charge?.amount))?Number(charge.amount)/100:0,
    currency:charge?.currency||'THB',
    qrUrl:qrDataUrl(charge?.encodedImage?.imageBase64Encoded),
    expiresAt:charge?.encodedImage?.expiry||charge?.expiresAt||null,
    failureCode:charge?.failureCode||null,
    failureMessage:charge?.failureMessage||null,
    referenceId:charge?.referenceId||null
  };
}

export function beamPromptPayConfig(){
  const merchantConfigured=!!merchantId(),apiConfigured=!!apiKey(),webhookConfigured=!!webhookKey();
  const configured=merchantConfigured&&apiConfigured;
  const missing=[];
  if(!merchantConfigured)missing.push('BEAM_MERCHANT_ID');
  if(!apiConfigured)missing.push('BEAM_API_KEY');
  if(!webhookConfigured)missing.push('BEAM_WEBHOOK_HMAC_KEY');
  return {
    provider:'beam',
    configured,
    ready:configured&&webhookConfigured,
    mode:environment()==='production'?'live':'test',
    environment:environment(),
    webhookConfigured,
    missing
  };
}

export async function createBeamPromptPayCharge({amount,reference}){
  const satang=normalizeAmount(amount);
  const ref=String(reference||'').trim().slice(0,120);
  if(!ref)throw bad('invalid_payment_reference');
  const origin=String(process.env.PUBLIC_ORIGIN||'').trim().replace(/\/$/,'');
  if(!/^https:\/\//.test(origin))throw bad('origin_not_configured',503);
  const expiryTime=new Date(Date.now()+15*60*1000).toISOString();
  const charge=await beamFetch('/api/v1/charges',{
    method:'POST',
    idempotencyKey:ref,
    json:{
      amount:satang,
      currency:'THB',
      paymentMethod:{
        qrPromptPay:{expiryTime},
        paymentMethodType:'QR_PROMPT_PAY'
      },
      referenceId:ref,
      returnUrl:origin+'/pos',
      skip3dsFlow:false
    }
  });
  const result=chargeResult(charge);
  if(!result.chargeId||!result.qrUrl)throw bad('promptpay_qr_unavailable',502);
  if(!result.amount)result.amount=satang/100;
  if(!result.referenceId)result.referenceId=ref;
  return result;
}

export async function getBeamPromptPayCharge(chargeId){
  const id=String(chargeId||'');
  if(!/^ch_[A-Za-z0-9_-]{6,}$/.test(id))throw bad('invalid_charge_id');
  return chargeResult(await beamFetch('/api/v1/charges/'+encodeURIComponent(id)));
}

function header(headers,name){
  const target=name.toLowerCase();
  for(const [k,v] of Object.entries(headers||{}))if(String(k).toLowerCase()===target)return String(v||'');
  return '';
}

function verifySignature(rawBody,signature){
  const key=webhookKey();
  if(!key)throw bad('promptpay_webhook_not_configured',503);
  if(!rawBody||!signature)throw bad('invalid_webhook_signature',401);
  let keyBytes,received;
  try{
    keyBytes=Buffer.from(key,'base64');
    received=Buffer.from(signature,'base64');
  }catch{throw bad('invalid_webhook_signature',401)}
  if(!keyBytes.length||!received.length)throw bad('invalid_webhook_signature',401);
  const expected=createHmac('sha256',keyBytes).update(Buffer.from(rawBody,'utf8')).digest();
  if(received.length!==expected.length||!timingSafeEqual(received,expected))throw bad('invalid_webhook_signature',401);
}

export async function verifyBeamPromptPayWebhook(event,{rawBody='',headers={}}={}){
  verifySignature(String(rawBody||''),header(headers,'x-beam-signature'));
  const eventType=header(headers,'x-beam-event').toLowerCase();
  if(event?.merchantId&&merchantId()&&String(event.merchantId)!==merchantId())throw bad('invalid_webhook_merchant',401);
  if(!['charge.succeeded','charge.failed'].includes(eventType))return {ok:true,ignored:true,eventType};
  const charge=chargeResult(event);
  if(!charge.chargeId)throw bad('invalid_webhook');
  return {ok:true,eventType,charge};
}
