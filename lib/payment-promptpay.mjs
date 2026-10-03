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

function provider(){
  const explicit=String(process.env.PROMPTPAY_PROVIDER||'').trim().toLowerCase();
  if(explicit==='beam'||explicit==='opn')return explicit;
  if(process.env.BEAM_MERCHANT_ID&&process.env.BEAM_API_KEY)return 'beam';
  if(process.env.OMISE_SECRET_KEY)return 'opn';
  return 'beam';
}

export function promptPayConfig(){
  const selected=provider();
  const config=selected==='opn'?opnPromptPayConfig():beamPromptPayConfig();
  return {...config,selectedProvider:selected,legacyOpnConfigured:!!process.env.OMISE_SECRET_KEY};
}

export async function createPromptPayCharge(input){
  return provider()==='opn'?createOpnPromptPayCharge(input):createBeamPromptPayCharge(input);
}

export async function getPromptPayCharge(chargeId){
  const id=String(chargeId||'');
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
