import {sumMoney} from './domain/money.mjs';
export function settlementEntryAmount(raw){
 const text=String(raw??'').trim();
 if(!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(text))return null;
 try{return sumMoney([text.startsWith('.')?'0'+text:text])}catch{return null}
}
