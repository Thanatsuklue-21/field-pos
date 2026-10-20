import {sumMoney} from './domain/money.mjs';
const whole=new Intl.NumberFormat('en-US',{maximumFractionDigits:0});
const satang=new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
// Display only. Grouped strings must never be parsed as payment amounts.
export function formatMoney(value){
  if(value===null||value===undefined||value==='')return '—';
  try{const amount=sumMoney([value]);return (Number.isInteger(amount)?whole:satang).format(amount)}catch{return '—'}
}
