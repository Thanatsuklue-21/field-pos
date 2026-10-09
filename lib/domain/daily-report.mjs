import {profitSummary} from './finance.mjs';
import {assessSalesCostQuality} from './cost-center.mjs';

export function dailyReport(doc,date){
  const sales=(doc.sales||[]).filter(s=>s.date===date&&s.status==='paid');
  const expenses=(doc.expenses||[]).filter(e=>e.date===date);
  const revenue=sales.reduce((sum,s)=>sum+Number(s.total||0),0);
  const cogs=sales.reduce((sum,s)=>sum+Number(s.costTotal||0),0);
  const channels={cashSales:0,promptpaySales:0,bankSales:0,cardSales:0,otherSales:0};
  const names={cash:'cashSales',promptpay:'promptpaySales',bank:'bankSales',card:'cardSales'};
  for(const sale of sales)for(const payment of sale.payments||[{method:sale.payment,amount:sale.total}])channels[names[payment.method]||'otherSales']+=Number(payment.amount||0);
  const close=(doc.closes||[]).find(row=>row.date===date);
  return {date,orders:sales.length,cups:sales.reduce((sum,s)=>sum+(s.items||[]).reduce((n,i)=>n+Number(i.qty||0),0),0),
    revenue,cogs,...profitSummary({revenue,cogs,expenses}),...channels,
    profitEstimated:assessSalesCostQuality(sales).isEstimated,closed:!!close,
    // Preserve independent blind counting: drawer results appear only after close.
    expectedCash:close?.expectedCash??null,countedCash:close?.countedCash??null,cashVariance:close?.cashVariance??null};
}
