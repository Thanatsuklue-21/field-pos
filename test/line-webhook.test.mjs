import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {receiveLineWebhook} from '../lib/line-webhook.mjs';

test('LINE receiver authenticates exact bytes, supports Verify, and logs only valid group IDs',async t=>{
  const old=process.env.LINE_CHANNEL_SECRET,log=console.log,logs=[];
  const secret='test-channel-secret';process.env.LINE_CHANNEL_SECRET=secret;
  console.log=(value)=>logs.push(value);
  t.after(()=>{console.log=log;if(old===undefined)delete process.env.LINE_CHANNEL_SECRET;else process.env.LINE_CHANNEL_SECRET=old});
  const request=(body,signedBody=body)=>new Request('https://field.test/api/line/webhook',{method:'POST',headers:{'x-line-signature':createHmac('sha256',secret).update(signedBody).digest('base64')},body});
  assert.equal((await receiveLineWebhook(request('{"events":[]}'))).status,200);
  const id='C'+'a'.repeat(32);
  const body=JSON.stringify({events:[{type:'join',source:{type:'group',groupId:id}},{type:'message',source:{type:'group',groupId:id,userId:'private-user'},message:{text:'private-text'}}]});
  assert.equal((await receiveLineWebhook(request(body))).status,200);
  assert.deepEqual(logs,[`[line-webhook] source.groupId=${id}`]);
  assert.equal((await receiveLineWebhook(request(body+' ',body))).status,401);
  assert.equal(logs.length,1);
  assert.equal((await receiveLineWebhook(request('not json'))).status,400);
  assert.equal((await receiveLineWebhook(request('{"events":{}}'))).status,400);
  assert.equal((await receiveLineWebhook(request('x'.repeat(128*1024+1)))).status,413);
  const bad=JSON.stringify({events:[{source:{type:'group',groupId:'Cfake\nsecret'}},{source:{type:'user',groupId:id}}]});
  assert.equal((await receiveLineWebhook(request(bad))).status,200);assert.equal(logs.length,1);
  delete process.env.LINE_CHANNEL_SECRET;
  assert.equal((await receiveLineWebhook(request(body))).status,503);
});
