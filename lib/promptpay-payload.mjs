// Pure EMVCo PromptPay payload builder shared by the server and the browser.
// No Node-only imports: the POS renders the same QR locally when the network
// is down or slow (owner-approved 2026-11-16).

export const MAX_PROMPTPAY_SATANG=15_000_000; // ฿150,000 per QR

function crc16(data){
  let crc=0xffff;
  for(let i=0;i<data.length;i++){
    crc^=data.charCodeAt(i)<<8;
    for(let j=0;j<8;j++)crc=(crc&0x8000)!==0?((crc<<1)^0x1021)&0xffff:(crc<<1)&0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4,'0');
}
const tag=(id,value)=>id+String(value.length).padStart(2,'0')+value;

export function normalizePromptPayId(raw){
  const digits=String(raw??'').replace(/[\s-]/g,'');
  if(/^0[689]\d{8}$/.test(digits))return {type:'phone',value:digits};
  if(/^\d{13}$/.test(digits))return {type:'national_id',value:digits};
  return null;
}

export function buildPromptPayPayload(promptPayId,satang){
  const id=normalizePromptPayId(promptPayId);
  if(!id){const e=new Error('promptpay_direct_id_invalid');e.status=503;throw e}
  if(!Number.isSafeInteger(satang)||satang<1||satang>MAX_PROMPTPAY_SATANG){const e=new Error('promptpay_amount_out_of_range');e.status=400;throw e}
  const target=id.type==='phone'?tag('01','0066'+id.value.slice(1)):tag('02',id.value);
  const amount=(Math.floor(satang/100))+'.'+String(satang%100).padStart(2,'0');
  const raw=[
    tag('00','01'),
    tag('01','12'), // dynamic: amount is locked
    tag('29',tag('00','A000000677010111')+target),
    tag('53','764'),
    tag('54',amount),
    tag('58','TH')
  ].join('')+'6304';
  return raw+crc16(raw);
}
