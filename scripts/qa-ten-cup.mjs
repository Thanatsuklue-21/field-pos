// Always creates a new local file database. Never reads TURSO credentials.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createClient} from '@libsql/client';
import {createApi} from '../lib/api.mjs';
import {seedTenCupDatabase,runTenCupScenario} from './qa-ten-cup-scenario.mjs';
import {toCsv,reportFilename} from '../lib/report-csv.mjs';
const output=resolve(process.argv[2]||'ten-cup-qa-output'),dir=await mkdtemp(join(tmpdir(),'field-ten-cup-evidence-'));
const db=createClient({url:'file:'+join(dir,'qa.db')});
try{
  await seedTenCupDatabase(db);
  const handler=createApi({db,origin:'https://field.test'});let cookie='',csrf='';
  const call=async(route,method='GET',body,expected=200)=>{
    const res={writeHead(status,headers){this.status=status;this.headers=headers},end(raw){this.body=JSON.parse(raw)}};
    await handler({method,query:{route},headers:{origin:'https://field.test',cookie,'x-csrf-token':csrf},body},res);
    assert.equal(res.status,expected,route+': '+JSON.stringify(res.body).slice(0,200));
    if(route==='auth/login'){cookie=res.headers['Set-Cookie'].split(';')[0];csrf=res.body.csrf}return res.body;
  };
  await call('auth/login','POST',{username:'qaoperator',password:'LocalQaOnly2026!'});
  const result=await runTenCupScenario(call);
  await mkdir(output,{recursive:true});
  for(const kind of ['dailySummary','sales','saleItems','expenses','stock','cashMovements'])await writeFile(join(output,reportFilename(kind,result.date)),'\ufeff'+toCsv(result.exported[kind]),'utf8');
  await writeFile(join(output,'ten-cup-results.json'),JSON.stringify(result,null,2));
  await writeFile(join(output,'qa-database-location.txt'),dir+'\n');
  console.log(JSON.stringify({ok:true,date:result.date,cups:result.close.cups,revenue:result.close.revenue,cogs:result.close.cogs,expenses:result.close.expenses,operatingProfit:result.close.operatingProfit,expectedCash:result.close.expectedCash,cashVariance:result.close.cashVariance,output},null,2));
}finally{db.close()}
