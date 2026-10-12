import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClient} from '@libsql/client';
import {createApi} from '../lib/api.mjs';
import {digest} from '../lib/security.mjs';
import {seedTenCupDatabase,runTenCupScenario} from '../scripts/qa-ten-cup-scenario.mjs';

test('10 cups: checkout/replay → production/handoff → expenses → cash movements → close → reports/export agree',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'field-ten-cup-')),db=createClient({url:'file:'+join(dir,'qa.db')});
  t.after(async()=>{db.close();try{await rm(dir,{recursive:true,force:true})}catch(error){if(process.platform!=='win32'||error.code!=='EBUSY')throw error}});
  await seedTenCupDatabase(db);
  const token='ten-cup-local-session';
  await db.execute({sql:'INSERT INTO field_sessions VALUES(?,?,?,?)',args:[digest(token),'ten-cup-owner','qa-csrf',Date.now()+60000]});
  const handler=createApi({db,origin:'https://field.test'});
  const call=async(route,method='GET',body,expected=200)=>{
    const res={writeHead(status){this.status=status},end(raw){this.body=JSON.parse(raw)}};
    await handler({method,query:{route},headers:{origin:'https://field.test',cookie:'field_session='+token,'x-csrf-token':'qa-csrf'},body},res);
    assert.equal(res.status,expected,route+': '+JSON.stringify(res.body).slice(0,200));return res.body;
  };
  await runTenCupScenario(call);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM field_stock_transactions WHERE tx_type='SALE' ")).rows[0].n),30);
});
