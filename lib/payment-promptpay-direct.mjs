// Direct PromptPay (zero fee): the shop's own PromptPay number receives the
// transfer; an Android phone running MacroDroid forwards the bank app's
// incoming-money notification to POST /api/payments/bank-notification.
//
// Safety model (owner-approved 2026-11-16):
// - The QR locks the exact bill amount (EMVCo dynamic QR, CRC-16/CCITT-FALSE).
// - Only one pending direct QR per amount at a time (no random satang: menu
//   price is the sale price, NON-VAT).
// - A notification can mark a QR paid only when: shared secret header matches,
//   the text is an *incoming* transfer, amount equals the bill to the satang,
//   it arrives after the QR was created and before it expired, and exactly one
//   pending QR has that amount. Each notification is consumed at most once.
// - Raw notification text is never stored (it contains the payer's name):
//   only amount, direction, time and a salted hash for de-duplication.
// - If no notification arrives, the operator may confirm manually; that is
//   recorded with the actor and confirm_mode='manual' for close-day review.
// The sale itself is still finalised by the existing server-authoritative
// checkout / split-payment path, which re-reads this charge before committing.

import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import QRCode from 'qrcode';

export const DIRECT_QR_TTL_MS=15*60*1000;
export const NOTIFICATION_DUPLICATE_WINDOW_MS=10*60*1000;

function bad(message,status=400){const e=new Error(message);e.status=status;return e}

let boundDb=null;
export function bindDirectPromptPayStore(db){boundDb=db}
function store(db){const d=db||boundDb;if(!d)throw bad('promptpay_direct_store_unavailable',503);return d}

// ---------- EMVCo PromptPay payload (shared with the browser) ----------
import {buildPromptPayPayload,normalizePromptPayId,MAX_PROMPTPAY_SATANG} from './promptpay-payload.mjs';
export {buildPromptPayPayload,normalizePromptPayId};
const MAX_SATANG=MAX_PROMPTPAY_SATANG;

export function toSatang(baht){
  const n=Number(baht);
  if(!Number.isFinite(n))throw bad('promptpay_amount_out_of_range');
  const s=Math.round(n*100);
  if(Math.abs(s-n*100)>1e-6)throw bad('promptpay_amount_out_of_range');
  return s;
}

// ---------- configuration ----------
const promptPayId=()=>String(process.env.PROMPTPAY_DIRECT_ID||'').trim();
const notifySecret=()=>String(process.env.BANK_NOTIFY_SECRET||'').trim();
const bankName=()=>String(process.env.BANK_NOTIFY_BANK||'krungsri').trim().toLowerCase();

export function directPromptPayConfig(){
  const idOk=!!normalizePromptPayId(promptPayId());
  const secretOk=notifySecret().length>=32;
  const missing=[];
  if(!idOk)missing.push('PROMPTPAY_DIRECT_ID');
  if(!secretOk)missing.push('BANK_NOTIFY_SECRET');
  return {
    provider:'direct',configured:idOk,ready:idOk&&secretOk,mode:'live',environment:'direct',
    webhookConfigured:secretOk,bank:bankName(),missing,
    // Public receiving number (already printed inside every QR); lets the POS
    // render the identical QR locally when offline.
    offlineQrId:idOk?normalizePromptPayId(promptPayId()).value:null
  };
}

// ---------- charges (payment intents) ----------
function rowToCharge(row,now=Date.now()){
  if(!row)throw bad('promptpay_charge_not_found',404);
  let status=String(row.status);
  if(status==='pending'&&Number(row.expires_at)<now)status='expired';
  return {
    provider:'direct',chargeId:String(row.id),status,paid:status==='paid',
    amount:Number(row.amount_satang)/100,currency:'THB',qrUrl:row.qr_url?String(row.qr_url):null,
    expiresAt:new Date(Number(row.expires_at)).toISOString(),failureCode:null,failureMessage:null,
    referenceId:String(row.reference_id),confirmMode:row.confirm_mode?String(row.confirm_mode):null
  };
}

export async function createDirectPromptPayCharge({amount,reference},{db,now=Date.now()}={}){
  const d=store(db),ref=String(reference||'').trim().slice(0,120);
  if(!ref)throw bad('invalid_payment_reference');
  const satang=toSatang(amount);
  const payload=buildPromptPayPayload(promptPayId(),satang);
  const svg=await QRCode.toString(payload,{type:'svg',errorCorrectionLevel:'M',margin:2});
  const qrUrl='data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64');
  const id='pd_'+randomBytes(12).toString('hex');
  // One atomic batch (single round trip; libSQL runs a batch in one transaction).
  // Same invariants as before: idempotent per reference, and one pending QR per
  // amount so a bank notification maps to exactly one bill.
  const [,byRef,clash]=await d.batch([
    {sql:`INSERT INTO field_promptpay_direct(id,reference_id,amount_satang,status,qr_payload,qr_url,created_at,expires_at)
      SELECT ?,?,?,'pending',?,?,?,?
      WHERE NOT EXISTS(SELECT 1 FROM field_promptpay_direct WHERE reference_id=?)
        AND NOT EXISTS(SELECT 1 FROM field_promptpay_direct WHERE status='pending' AND amount_satang=? AND expires_at>=?)`,
      args:[id,ref,satang,payload,qrUrl,now,now+DIRECT_QR_TTL_MS,ref,satang,now]},
    {sql:'SELECT * FROM field_promptpay_direct WHERE reference_id=?',args:[ref]},
    {sql:"SELECT id FROM field_promptpay_direct WHERE status='pending' AND amount_satang=? AND expires_at>=? AND reference_id<>?",args:[satang,now,ref]}
  ],'write');
  const row=byRef.rows[0];
  if(row)return rowToCharge(row,now);
  if(clash.rows.length)throw bad('promptpay_direct_amount_in_use',409);
  throw bad('promptpay_direct_create_failed',503);
}

export async function getDirectPromptPayCharge(chargeId,{db,now=Date.now()}={}){
  const id=String(chargeId||'');
  if(!/^pd_[a-f0-9]{24}$/.test(id))throw bad('invalid_charge_id');
  return rowToCharge((await store(db).execute({sql:'SELECT * FROM field_promptpay_direct WHERE id=?',args:[id]})).rows[0],now);
}

// Operator released the QR (customer paid another way). A late transfer for a
// cancelled QR becomes an unmatched notification for close-day review.
export async function getDirectPromptPayChargeByReference(reference,{db,now=Date.now()}={}){
  const r=await store(db).execute({sql:'SELECT * FROM field_promptpay_direct WHERE reference_id=?',args:[String(reference||'')]});
  return r.rows[0]?rowToCharge(r.rows[0],now):null;
}

export async function cancelDirectPromptPayCharge(chargeId,{db,now=Date.now(),actorId}={}){
  const d=store(db),id=String(chargeId||'');
  const r=await d.execute({sql:"UPDATE field_promptpay_direct SET status='cancelled',cancelled_at=?,confirmed_by=? WHERE id=? AND status='pending'",args:[now,actorId||null,id]});
  return {cancelled:Number(r.rowsAffected||0)===1,charge:await getDirectPromptPayCharge(id,{db:d,now})};
}

export async function confirmDirectPromptPayManually(chargeId,{db,now=Date.now(),actorId}={}){
  const d=store(db),id=String(chargeId||'');
  if(!actorId)throw bad('actor_required',401);
  const r=await d.execute({sql:"UPDATE field_promptpay_direct SET status='paid',paid_at=?,confirm_mode='manual',confirmed_by=? WHERE id=? AND status='pending' AND expires_at>=?",args:[now,actorId,id,now-DIRECT_QR_TTL_MS]});
  const charge=await getDirectPromptPayCharge(id,{db:d,now});
  if(Number(r.rowsAffected||0)!==1&&!charge.paid)throw bad('promptpay_direct_not_pending',409);
  await d.execute({sql:'INSERT INTO field_audit(actor_id,action,details,created_at) VALUES(?,?,?,?)',args:[actorId,'promptpay_direct_manual_confirm',JSON.stringify({chargeId:id,amount:charge.amount,referenceId:charge.referenceId}),now]});
  return charge;
}

// ---------- bank notification parsing ----------
const OUTGOING=/(โอนออก|โอนเงินออก|เงินออก|ถอน|ชำระ|จ่ายบิล|หักบัญชี|ตัดบัญชี|withdraw|transfer\s*out|payment\s*to|debit)/i;
const INCOMING=/(เงินเข้า|รับเงิน|รับโอน|โอนเข้า|ได้รับเงิน|เข้าบัญชี|ฝากเงิน|deposit|received|incoming|credit)/i;
const BALANCE=/(คงเหลือ|ยอดเงินคงเหลือ|ยอดคงเหลือ|ใช้ได้|balance|avail)/i;
const AMOUNT=/(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?!\d)/g;

// Returns {direction:'in'|'out'|'unknown', amount:number|null}. The amount is
// the first money value after the incoming keyword that is not a balance.
export function parseBankNotification(text){
  const t=String(text||'').replace(/\s+/g,' ').trim().slice(0,1000);
  if(!t)return {direction:'unknown',amount:null};
  const inMatch=INCOMING.exec(t),outMatch=OUTGOING.exec(t);
  if(outMatch&&(!inMatch||outMatch.index<inMatch.index))return {direction:'out',amount:null};
  if(!inMatch)return {direction:'unknown',amount:null};
  const after=t.slice(inMatch.index);
  AMOUNT.lastIndex=0;let m;
  while((m=AMOUNT.exec(after))){
    const before=after.slice(Math.max(0,m.index-24),m.index);
    if(BALANCE.test(before))continue;
    const satang=Number(m[1].replace(/,/g,''))*100+Number(m[2]);
    if(!Number.isSafeInteger(satang)||satang<1||satang>MAX_SATANG)return {direction:'in',amount:null};
    return {direction:'in',amount:satang/100};
  }
  return {direction:'in',amount:null};
}

function secretMatches(provided){
  const expected=notifySecret();
  if(expected.length<32)throw bad('bank_notify_not_configured',503);
  const a=createHash('sha256').update(String(provided||'')).digest(),b=createHash('sha256').update(expected).digest();
  return timingSafeEqual(a,b);
}

function header(headers,name){
  const target=name.toLowerCase();
  for(const [k,v] of Object.entries(headers||{}))if(String(k).toLowerCase()===target)return String(v||'');
  return '';
}

// Handle one forwarded notification. Returns
// {matched, chargeId?, referenceId?, amount, status} — never the raw text.
export async function receiveBankNotification({body,headers},{db,now=Date.now()}={}){
  if(!secretMatches(header(headers,'x-field-bank-key')))throw bad('invalid_bank_notification_key',401);
  const text=String(body?.text??'');
  if(!text||text.length>2000)throw bad('invalid_bank_notification');
  const d=store(db);
  const normalized=text.replace(/\s+/g,' ').trim();
  // Keyed hash: equal texts dedupe, but the hash reveals nothing without the secret.
  const textHash=createHmac('sha256',notifySecret()).update(normalized).digest('hex');
  const parsed=parseBankNotification(normalized);
  const satang=parsed.amount==null?null:Math.round(parsed.amount*100);
  const id='bn_'+randomBytes(12).toString('hex');
  const tx=await d.transaction('write');
  try{
    const dup=(await tx.execute({sql:'SELECT id,status,matched_charge_id FROM field_bank_notifications WHERE text_hash=? AND received_at>=? ORDER BY received_at DESC LIMIT 1',args:[textHash,now-NOTIFICATION_DUPLICATE_WINDOW_MS]})).rows[0];
    if(dup){
      await tx.rollback();
      return {matched:String(dup.status)==='matched',duplicate:true,chargeId:dup.matched_charge_id?String(dup.matched_charge_id):null,amount:satang==null?null:satang/100,status:'duplicate'};
    }
    let status='ignored',matched=null;
    if(parsed.direction==='in'&&satang!=null){
      const candidates=(await tx.execute({sql:"SELECT * FROM field_promptpay_direct WHERE status='pending' AND amount_satang=? AND created_at<=? AND expires_at>=?",args:[satang,now,now]})).rows;
      if(candidates.length===1){
        const upd=await tx.execute({sql:"UPDATE field_promptpay_direct SET status='paid',paid_at=?,confirm_mode='notification',notification_id=? WHERE id=? AND status='pending'",args:[now,id,candidates[0].id]});
        if(Number(upd.rowsAffected||0)===1){status='matched';matched=candidates[0]}
        else status='unmatched';
      }else status=candidates.length>1?'ambiguous':'unmatched';
    }
    await tx.execute({sql:'INSERT INTO field_bank_notifications(id,text_hash,direction,amount_satang,status,matched_charge_id,bank,received_at) VALUES(?,?,?,?,?,?,?,?)',args:[id,textHash,parsed.direction,satang,status,matched?String(matched.id):null,bankName(),now]});
    await tx.commit();
    return {matched:status==='matched',duplicate:false,chargeId:matched?String(matched.id):null,referenceId:matched?String(matched.reference_id):null,amount:satang==null?null:satang/100,status,direction:parsed.direction};
  }catch(e){await tx.rollback().catch(()=>{});throw e}
}

export async function listBankNotifications({db,since=0,limit=200}={}){
  const rows=(await store(db).execute({sql:'SELECT id,direction,amount_satang,status,matched_charge_id,bank,received_at FROM field_bank_notifications WHERE received_at>=? ORDER BY received_at DESC LIMIT ?',args:[since,Math.min(500,Math.max(1,limit))]})).rows;
  return rows.map(r=>({id:String(r.id),direction:String(r.direction),amount:r.amount_satang==null?null:Number(r.amount_satang)/100,status:String(r.status),chargeId:r.matched_charge_id?String(r.matched_charge_id):null,bank:String(r.bank||''),receivedAt:Number(r.received_at)}));
}
