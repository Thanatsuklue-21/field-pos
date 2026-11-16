import {
  beamPromptPayConfig,
  createBeamPromptPayCharge,
  getBeamPromptPayCharge,
  verifyBeamPromptPayWebhook
} from './payment-beam.mjs';
import {
  promptPayConfig as opnPromptPayConfig,
  createPromptPayCharge as createOpnPromptPayCharge,
  getPromptPayCharge as getOpnPromptPayCharge,
  verifyPromptPayWebhook as verifyOpnPromptPayWebhook
} from './payment-opn.mjs';
import {
  directPromptPayConfig,
  createDirectPromptPayCharge,
  getDirectPromptPayCharge
} from './payment-promptpay-direct.mjs';

function provider(){
  const explicit=String(process.env.PROMPTPAY_PROVIDER||'').trim().toLowerCase();
  if(explicit==='beam'||explicit==='opn'||explicit==='direct')return explicit;
  if(process.env.BEAM_MERCHANT_ID&&process.env.BEAM_API_KEY)return 'beam';
  if(process.env.OMISE_SECRET_KEY)return 'opn';
  return 'beam';
}

export function promptPayConfig(){
  const selected=provider();
  const config=selected==='opn'?opnPromptPayConfig():selected==='direct'?directPromptPayConfig():beamPromptPayConfig();
  const ready=selected==='opn'?config.configured===true:config.ready===true;
  return {...config,ready,selectedProvider:selected,legacyOpnConfigured:!!process.env.OMISE_SECRET_KEY};
}

export function isPromptPayLiveReady(config=promptPayConfig()){
  return config?.ready===true&&String(config?.mode||'').toLowerCase()==='live';
}

export async function createPromptPayCharge(input){
  const selected=provider();
  if(selected==='direct')return createDirectPromptPayCharge(input);
  return selected==='opn'?createOpnPromptPayCharge(input):createBeamPromptPayCharge(input);
}

export async function getPromptPayCharge(chargeId){
  const id=String(chargeId||'');
  if(id.startsWith('pd_'))return getDirectPromptPayCharge(id);
  if(id.startsWith('chrg_'))return getOpnPromptPayCharge(id);
  if(id.startsWith('ch_'))return getBeamPromptPayCharge(id);
  return provider()==='opn'?getOpnPromptPayCharge(id):getBeamPromptPayCharge(id);
}

export async function verifyPromptPayWebhook(event,context={}){
  const headers=context?.headers||{};
  const beamSignature=Object.entries(headers).some(([k,v])=>String(k).toLowerCase()==='x-beam-signature'&&String(v||''));
  if(beamSignature||provider()==='beam')return verifyBeamPromptPayWebhook(event,context);
  return verifyOpnPromptPayWebhook(event,context);
}
