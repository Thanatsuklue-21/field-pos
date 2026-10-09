const formatter=new Intl.NumberFormat('en-US',{useGrouping:true,minimumFractionDigits:0,maximumFractionDigits:2});
const satangFormatter=new Intl.NumberFormat('en-US',{useGrouping:true,minimumFractionDigits:2,maximumFractionDigits:2});

// Display only: never feed the grouped string into payment or accounting calculations.
export function formatMoney(value){
  if(value===null||value===undefined||value==='')return '—';
  const amount=Number(value);
  if(!Number.isFinite(amount))return '—';
  if(Math.abs(amount)<0.005)return '0';
  return (Number.isInteger(amount)?formatter:satangFormatter).format(amount);
}
