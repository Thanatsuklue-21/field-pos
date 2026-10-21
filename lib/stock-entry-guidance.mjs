import {formatBaht} from './domain/money.mjs';
import {calculateReceivedQuantity,normalizeUsageUnit} from './domain/stock-units.mjs';

export function countedQuantity(row,per){
 const fields=per>0?[row.packs,row.loose]:[row.base];
 if(fields.every(value=>String(value??'').trim()===''))return null;
 const values=fields.map(value=>Number(String(value??'').trim()||0));
 if(values.some(value=>!Number.isFinite(value)||value<0))return null;
 const total=per>0?values[0]*per+values[1]:values[0];
 return Number.isFinite(total)?total:null;
}

export function defaultPackSizeUnit(unit){
 try{return normalizeUsageUnit(unit)}catch{return String(unit||'g')}
}

export function previewReceived(packageQty,packSize,fromUnit,toUnit){
 const target={piece:'ชิ้น',set:'ชุด',serve:'เสิร์ฟ'}[defaultPackSizeUnit(toUnit)]||String(toUnit);
 try{
  const result=calculateReceivedQuantity({packageQty,packSize,packSizeUnit:fromUnit,usageUnit:toUnit});
  if(!Number.isFinite(result.quantity)||result.quantity<=0)throw new Error('invalid_package_qty');
  return {qty:result.quantity,label:result.quantity.toLocaleString()+' '+target,approximate:result.approximate};
 }catch(error){
  const code=error?.message;
  const label=code==='incompatible_stock_unit'?'เลือกหน่วยต่อแพ็กให้ตรงกับสต็อก ('+target+')':code==='unsupported_stock_unit'?'หน่วยสต็อกยังไม่รองรับ ('+target+') · ให้ผู้ดูแลตรวจหน่วย':'กรอกจำนวนแพ็กและปริมาณต่อแพ็กให้ถูกต้อง';
  return {qty:0,label,approximate:false};
 }
}

// Text inputs can contain incomplete numbers while editing; never throw during rendering.
export function purchaseCostLabel(raw){
 const text=String(raw??'').trim();
 if(!text)return 'ยังไม่กรอกราคา';
 const amount=Number(text);
 if(!Number.isFinite(amount)||amount<0)return 'ตรวจราคาซื้อ';
 try{return '฿'+formatBaht(amount)}catch{return 'ตรวจราคาซื้อ'}
}
