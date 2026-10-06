import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('unknown-account login abuse is throttled with a hashed source key',async()=>{
  const api=await read('lib/api.mjs'),schema=await read('lib/schema.mjs'),gate=await read('components/auth-gate.tsx');
  assert.match(schema,/field_login_rate_limits/);
  assert.match(api,/LOGIN_UNKNOWN_WINDOW_MS=5\*60\*1000/);
  assert.match(api,/LOGIN_UNKNOWN_BLOCK_MS=10\*60\*1000/);
  assert.match(api,/LOGIN_UNKNOWN_MAX_ATTEMPTS=20/);
  assert.match(api,/digest\('login-unknown:'\+ip\)/);
  assert.match(api,/login_rate_limited/);
  assert.match(gate,/มีการลองเข้าสู่ระบบหลายครั้งเกินไป/);
});

test('normal login remains cheap and successful sign-in cleans expired sessions',async()=>{
  const api=await read('lib/api.mjs');
  const login=api.slice(api.indexOf("if(path==='/api/auth/login'"),api.indexOf("if(path==='/api/payments/promptpay/webhook'"));
  assert.match(login,/if\(!row\|\|!row\.active\)\{/);
  const unknownBranch=login.slice(login.indexOf('if(!row||!row.active){'),login.indexOf('if(Number(row.locked_until)>now)'));
  const passwordBranch=login.slice(login.indexOf('if(!await verifyPassword'),login.indexOf("await db.execute({sql:'UPDATE field_users SET failed_count=0"));
  assert.match(unknownBranch,/registerUnknownLoginFailure\(db,req,now\)/);
  assert.doesNotMatch(passwordBranch,/registerUnknownLoginFailure/);
  assert.match(login,/DELETE FROM field_sessions WHERE expires_at<=\?/);
});

test('login rate storage does not persist raw source addresses',async()=>{
  const schema=await read('lib/schema.mjs'),api=await read('lib/api.mjs');
  const table=schema.match(/CREATE TABLE IF NOT EXISTS field_login_rate_limits[^\n]*/)?.[0]||'';
  assert.doesNotMatch(table,/ip_address|raw_ip|source_ip/i);
  assert.match(api,/const key=digest\('login-unknown:'\+ip\)/);
});
