import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
test('admin users UI manages roles without exposing destructive delete',async()=>{const s=await read('app/users/page.tsx');assert.match(s,/\/api\/admin\/users/);assert.match(s,/permissions/);assert.match(s,/RESET PASSWORD/);assert.match(s,/DISABLE/);assert.ok(!s.includes('method:"DELETE"'))});


test('password reset uses guided in-app modal instead of browser prompt',async()=>{const s=await read('app/users/page.tsx');assert.ok(!s.includes('window.prompt'));assert.match(s,/user-reset-password-title/);assert.match(s,/resetPasswordValue.length<10/);assert.match(s,/aria-label="ปิดการรีเซ็ตรหัสผ่าน"/);assert.match(s,/ยืนยันรีเซ็ต/);assert.match(s,/min-h-12/)});
