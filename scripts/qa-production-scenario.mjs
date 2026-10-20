// Isolated local QA only: never accepts a remote base URL or database URL.
import assert from 'node:assert/strict';
import {mkdir,writeFile,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createClient} from '@libsql/client';
import {SCHEMA} from '../lib/schema.mjs';
import {digest} from '../lib/security.mjs';
import {bangkokDate} from '../lib/time.mjs';

const mode=process.argv[2],dbPath=resolve(process.argv[3]||'../vnext-report/isolated.db'),output=resolve(process.argv[4]||'../vnext-report/http');
const base=process.argv[5]||'http://127.0.0.1:3100';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname),'QA must use localhost');
assert.ok(!dbPath.includes('://'),'QA requires a local file');
const token='field-local-qa-only',csrf='field-local-qa-csrf',origin='https://field.qa',date=bangkokDate();
await mkdir(output,{recursive:true});
if(mode==='seed'){
  let exists=false;try{await access(dbPath);exists=true}catch{}
  assert.equal(exists,false,'Choose a new disposable database path; seed never overwrites');
  const db=createClient({url:'file:'+dbPath});
  try{
    await db.batch(SCHEMA,'write');
    await db.execute("INSERT INTO field_users(id,username,password_hash,role,created_at,updated_at) VALUES('qa-owner','qa-owner','unused','admin',0,0)");
    await db.execute({sql:'INSERT INTO field_sessions VALUES(?,?,?,?)',args:[digest(token),'qa-owner',csrf,Date.now()+2*60*60*1000]});
    const doc={menu:[{id:'tea',name:'QA Matcha Latte',category:'MATCHA',enabled:true,price:55.25,variants:[{label:'normal',recipe:{items:{matcha:5,milk:110,cup:1}}}]}],ingredients:{matcha:{name:'Matcha',qty:1000,unitCost:2,unit:'g'},milk:{name:'Milk',qty:30000,unitCost:0.06,unit:'ml'},cup:{name:'Cup',qty:500,unitCost:3,unit:'piece'}},settings:{pagerCount:10,deliveryGp:{grab:0.3}},sales:[],orders:[],billSeq:{},expenses:[],cashShifts:[],cashMovements:[],closes:[]};
    await db.execute({sql:'UPDATE field_state SET document=? WHERE singleton=1',args:[JSON.stringify(doc)]});
    await writeFile(join(output,'fixture.json'),JSON.stringify({database:'isolated local file',date,bills:60,unitPrice:55.25,recipeCost:19.6,expectedRevenue:3315,expectedCogs:1176,expectedGpFees:165.8,expectedOperatingExpenses:80.1,expectedOperatingProfit:1893.1,expectedCash:2127.4},null,2));
    console.log('Seeded isolated fixture:',dbPath);
  }finally{db.close()}
}else if(mode==='run'){
  const samples=[],failures=[],start=Date.now();
  async function request(path,body,expected=200,auth=true){
    const at=performance.now(),method=body?'POST':'GET';
    const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Origin:origin,...(path.includes('?revision=')?{'X-Field-Revision':path.split('?revision=')[1]}:{}),...(auth?{Cookie:'field_session='+token,'X-CSRF-Token':csrf}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
    const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={text:text.slice(0,100)}}
    samples.push({path,method,status:r.status,ms:Number((performance.now()-at).toFixed(2)),bytes:Buffer.byteLength(text)});
    if(r.status!==expected)failures.push({path,expected,actual:r.status,data});
    assert.equal(r.status,expected,JSON.stringify({path,data}));return data;
  }
  await request('/api/health');await request('/api/pos/bootstrap',undefined,401,false);
  await request('/api/cash-shift/open',{requestKey:randomUUID(),date,openingCash:500},201);
  const cold=await request('/api/pos/bootstrap');
  for(let i=0;i<20;i++){await request('/api/pos/bootstrap?revision='+cold.revision);await request('/api/pos/queue');}
  const keys=[];
  for(let i=0;i<60;i++){
    const payment=i<30?'cash':i<40?'bank':i<50?'card':'other';
    const body={requestKey:randomUUID(),date,cart:[{id:'tea',variant:'normal',qty:1,price:1}],payment,received:payment==='cash'?100:55.25,...(payment==='other'?{salesChannel:'grab'}:{})};
    const sale=await request('/api/pos/checkout',body);assert.equal(sale.total,55.25);if(payment==='cash')assert.equal(sale.change,44.75);
    const replay=await request('/api/pos/checkout',body);assert.equal(replay.orderId,sale.orderId);keys.push(body.requestKey);
    for(const action of ['complete_item','call','return'])await request('/api/pos/queue',{requestKey:randomUUID(),orderId:sale.orderId,action,...(action==='complete_item'?{itemIndex:0,expectedReadyQty:0}:{})});
  }
  for(const [amount,paymentMethod] of [[30.1,'cash'],[50,'bank']])await request('/api/expenses',{requestKey:randomUUID(),date,amount,paymentMethod,category:'UTILITY',description:'Isolated QA operating expense'},201);
  const dashboard=await request('/api/management/dashboard');
  assert.equal(dashboard.revenue,3315);assert.equal(dashboard.cogs,1176);assert.equal(dashboard.deliveryGpFees,165.8);assert.equal(dashboard.operatingProfit,1893.1);
  const review=await request('/api/close-day/review',{requestKey:randomUUID(),date,firstCount:2127.4,secondCount:2127.4});
  assert.equal(review.review.variance,0);
  const closeBody={requestKey:randomUUID(),date,openingCash:500,countedCash:2127.4,reviewId:review.review.id,varianceReason:'',confirmVariance:false};
  const closed=await request('/api/close-day',closeBody,201);const replay=await request('/api/close-day',closeBody);assert.equal(replay.close.id,closed.close.id);
  assert.equal(closed.close.expectedCash,2127.4);assert.equal(closed.close.operatingProfit,1893.1);
  await request('/api/pos/checkout',{requestKey:randomUUID(),date,cart:[{id:'tea',variant:'normal',qty:1}],payment:'cash',received:100},409);
  const db=createClient({url:'file:'+dbPath});let stored;
  try{
    const doc=JSON.parse((await db.execute('SELECT document FROM field_state WHERE singleton=1')).rows[0].document);
    assert.equal(doc.sales.length,60);assert.equal(doc.ingredients.matcha.qty,700);assert.equal(doc.ingredients.milk.qty,23400);assert.equal(doc.ingredients.cup.qty,440);
    const count=Number((await db.execute("SELECT COUNT(*) AS n FROM field_stock_transactions WHERE tx_type='SALE'")).rows[0].n);assert.equal(count,180);
    stored={sales:doc.sales.length,saleStockTransactions:count,stock:doc.ingredients,closes:doc.closes.length,close:doc.closes[0]};
  }finally{db.close()}
  const groups={};for(const x of samples)(groups[x.method+' '+x.path.split('?')[0]]??=[]).push(x.ms);
  const stats=Object.entries(groups).map(([route,times])=>{const sorted=[...times].sort((a,b)=>a-b);return {route,n:times.length,minMs:sorted[0],medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],maxMs:sorted.at(-1)}});
  const result={environment:'local Next production build + isolated file-backed libSQL; NOT production latency',date,elapsedMs:Date.now()-start,requests:samples.length,unexpectedResponses:failures.length,checkoutReplays:60,metrics:stats,stored,samples};
  await writeFile(join(output,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,samples:undefined,stored:{sales:stored.sales,saleStockTransactions:stored.saleStockTransactions,closes:stored.closes}}));
}else throw Error('Use seed or run');
