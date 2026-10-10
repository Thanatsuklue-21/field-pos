function escapeCsv(value){const text=String(value??'');return /[",\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text}
export function toCsv(rows){
  if(!rows.length)return '';
  const headers=[...new Set(rows.flatMap(row=>Object.keys(row)))];
  return [headers.map(escapeCsv).join(','),...rows.map(row=>headers.map(key=>escapeCsv(row[key])).join(','))].join('\r\n');
}
export function reportFilename(kind,businessDate){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(businessDate))throw new Error('report_business_date_required');
  return 'FIELD_'+kind+'_'+businessDate+'.csv';
}
