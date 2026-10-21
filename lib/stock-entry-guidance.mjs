import {formatBaht} from './domain/money.mjs';

// Text inputs can contain incomplete numbers while editing; never throw during rendering.
export function purchaseCostLabel(raw){
 const text=String(raw??'').trim();
 if(!text)return 'ยังไม่กรอกราคา';
 const amount=Number(text);
 if(!Number.isFinite(amount)||amount<0)return 'ตรวจราคาซื้อ';
 try{return '฿'+formatBaht(amount)}catch{return 'ตรวจราคาซื้อ'}
}
