import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {SCHEMA} from '../lib/schema.mjs';
import {notifyKitchenPayment} from '../lib/line-kitchen.mjs';

test('LINE outbox retries use one key, preserve target/body and suppress accepted duplicates',async t=>{
 const db=createClient({url:':memory:'});t.after(()=>db.close());await db.batch(SCHEMA,'write');
 const oldToken=process.env.LINE_CHANNEL_ACCESS_TOKEN,oldTarget=process.env.LINE_KITCHEN_GROUP_ID;
 process.env.LINE_CHANNEL_ACCESS_TOKEN='test-token';process.env.LINE_KITCHEN_GROUP_ID='C'+'a'.repeat(32);
 t.after(()=>{if(oldToken===undefined)delete process.env.LINE_CHANNEL_ACCESS_TOKEN;else process.env.LINE_CHANNEL_ACCESS_TOKEN=oldToken;if(oldTarget===undefined)delete process.env.LINE_KITCHEN_GROUP_ID;else process.env.LINE_KITCHEN_GROUP_ID=oldTarget});
 const payment={sessionId:'split-test',orderId:'o-test',queueNo:'001',total:65},calls=[];
 const fetcher=async(url,options)=>{calls.push({url,...options});return calls.length===1?new Response('',{status:503}):new Response('',{status:409,headers:{'x-line-accepted-request-id':'accepted'}})};
 await notifyKitchenPayment(db,payment,{fetcher,now:1000000});
 await notifyKitchenPayment(db,payment,{fetcher,now:1000001});assert.equal(calls.length,1);
 process.env.LINE_KITCHEN_GROUP_ID='C'+'b'.repeat(32);
 await notifyKitchenPayment(db,payment,{fetcher,now:1100000});assert.equal(calls.length,2);
 assert.equal(calls[0].headers['X-Line-Retry-Key'],calls[1].headers['X-Line-Retry-Key']);assert.equal(calls[0].body,calls[1].body);
 await notifyKitchenPayment(db,payment,{fetcher,now:1200000});assert.equal(calls.length,2);
 assert.equal((await db.execute('SELECT state FROM field_line_outbox')).rows[0].state,'sent');
});
