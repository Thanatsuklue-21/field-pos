import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {SCHEMA} from '../lib/schema.mjs';
import {notifyKitchenPayment,drainKitchenOutbox,getKitchenOutboxStatus} from '../lib/line-kitchen.mjs';

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


test('LINE outbox can retry a due notification without another payment webhook',async t=>{
 const db=createClient({url:':memory:'});t.after(()=>db.close());await db.batch(SCHEMA,'write');
 const oldToken=process.env.LINE_CHANNEL_ACCESS_TOKEN,oldTarget=process.env.LINE_KITCHEN_GROUP_ID;
 process.env.LINE_CHANNEL_ACCESS_TOKEN='test-token';process.env.LINE_KITCHEN_GROUP_ID='C'+'c'.repeat(32);
 t.after(()=>{if(oldToken===undefined)delete process.env.LINE_CHANNEL_ACCESS_TOKEN;else process.env.LINE_CHANNEL_ACCESS_TOKEN=oldToken;if(oldTarget===undefined)delete process.env.LINE_KITCHEN_GROUP_ID;else process.env.LINE_KITCHEN_GROUP_ID=oldTarget});
 const payment={sessionId:'split-drain',orderId:'o-drain',queueNo:'009',total:80},calls=[];
 const fetcher=async(url,options)=>{calls.push({url,...options});return calls.length===1?new Response('',{status:503}):new Response('',{status:200})};
 await notifyKitchenPayment(db,payment,{fetcher,now:1_000_000});
 assert.equal(calls.length,1);
 const before=(await db.execute('SELECT state,retry_key,next_at FROM field_line_outbox WHERE session_id=?',['split-drain'])).rows[0];
 assert.equal(before.state,'pending');
 await drainKitchenOutbox(db,{fetcher,now:Number(before.next_at)-1});
 assert.equal(calls.length,1);
 const result=await drainKitchenOutbox(db,{fetcher,now:Number(before.next_at)});
 assert.deepEqual(result,{ok:true,attempted:1,accepted:1,blocked:0});
 assert.equal(calls.length,2);
 assert.equal(calls[0].headers['X-Line-Retry-Key'],calls[1].headers['X-Line-Retry-Key']);
 assert.equal((await db.execute('SELECT state FROM field_line_outbox WHERE session_id=?',['split-drain'])).rows[0].state,'sent');
});


test('LINE 429 is retriable while permanent client errors are blocked',async t=>{
 const db=createClient({url:':memory:'});t.after(()=>db.close());await db.batch(SCHEMA,'write');
 const oldToken=process.env.LINE_CHANNEL_ACCESS_TOKEN,oldTarget=process.env.LINE_KITCHEN_GROUP_ID;
 process.env.LINE_CHANNEL_ACCESS_TOKEN='test-token';process.env.LINE_KITCHEN_GROUP_ID='C'+'d'.repeat(32);
 t.after(()=>{if(oldToken===undefined)delete process.env.LINE_CHANNEL_ACCESS_TOKEN;else process.env.LINE_CHANNEL_ACCESS_TOKEN=oldToken;if(oldTarget===undefined)delete process.env.LINE_KITCHEN_GROUP_ID;else process.env.LINE_KITCHEN_GROUP_ID=oldTarget});
 const throttled={sessionId:'split-429',orderId:'o-429',queueNo:'010',total:90};
 await notifyKitchenPayment(db,throttled,{fetcher:async()=>new Response('',{status:429}),now:2_000_000});
 let row=(await db.execute('SELECT state,next_at FROM field_line_outbox WHERE session_id=?',['split-429'])).rows[0];
 assert.equal(row.state,'pending');assert.ok(Number(row.next_at)>2_000_000);

 const blocked={sessionId:'split-400',orderId:'o-400',queueNo:'011',total:95};
 await notifyKitchenPayment(db,blocked,{fetcher:async()=>new Response('',{status:400}),now:2_100_000});
 row=(await db.execute('SELECT state FROM field_line_outbox WHERE session_id=?',['split-400'])).rows[0];
 assert.equal(row.state,'blocked');
});


test('LINE recovery health separates retryable, blocked and stale notifications',async t=>{
 const db=createClient({url:':memory:'});t.after(()=>db.close());await db.batch(SCHEMA,'write');
 const oldToken=process.env.LINE_CHANNEL_ACCESS_TOKEN,oldTarget=process.env.LINE_KITCHEN_GROUP_ID;
 process.env.LINE_CHANNEL_ACCESS_TOKEN='test-token';process.env.LINE_KITCHEN_GROUP_ID='C'+'e'.repeat(32);
 t.after(()=>{if(oldToken===undefined)delete process.env.LINE_CHANNEL_ACCESS_TOKEN;else process.env.LINE_CHANNEL_ACCESS_TOKEN=oldToken;if(oldTarget===undefined)delete process.env.LINE_KITCHEN_GROUP_ID;else process.env.LINE_KITCHEN_GROUP_ID=oldTarget});
 const now=100_000_000,cutoff=now-23*60*60*1000;
 await db.execute({sql:'INSERT INTO field_line_outbox(session_id,retry_key,target,message,state,attempts,next_at,created_at) VALUES(?,?,?,?,?,?,?,?)',args:['health-pending','rk-pending',process.env.LINE_KITCHEN_GROUP_ID,'pending','pending',1,now-1,now-1000]});
 await db.execute({sql:'INSERT INTO field_line_outbox(session_id,retry_key,target,message,state,attempts,next_at,created_at) VALUES(?,?,?,?,?,?,?,?)',args:['health-blocked','rk-blocked',process.env.LINE_KITCHEN_GROUP_ID,'blocked','blocked',1,0,now-2000]});
 await db.execute({sql:'INSERT INTO field_line_outbox(session_id,retry_key,target,message,state,attempts,next_at,created_at) VALUES(?,?,?,?,?,?,?,?)',args:['health-stale','rk-stale',process.env.LINE_KITCHEN_GROUP_ID,'stale','pending',3,cutoff-1,cutoff-1000]});
 const status=await getKitchenOutboxStatus(db,{now});
 assert.equal(status.configured,true);
 assert.equal(status.pending,1);
 assert.equal(status.retryable,1);
 assert.equal(status.blocked,1);
 assert.equal(status.stale,1);
 assert.equal(status.unresolved,3);
 assert.equal(status.oldestUnresolvedAt,cutoff-1000);
});
