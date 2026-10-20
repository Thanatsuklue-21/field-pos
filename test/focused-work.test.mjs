import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
test('work modes show their own navigation and AI is explicitly requested',async()=>{
 const s=await readFile('components/app-shell.tsx','utf8');
 assert.ok(s.includes('currentMode==="front"&&desktopPrimary.map'));
 assert.ok(s.includes('currentMode==="back"&&'));
 assert.ok(s.includes('[aiMounted,setAiMounted]=useState(false)'));
 assert.ok(s.includes('aria-label="เปิดผู้ช่วย FIELD"'));
 assert.ok(s.includes('BACK_OFFICE_GROUPS'));
});
test('closed AI neither polls nor floats over workflow controls',async()=>{
 const s=await readFile('components/ai-supervisor.tsx','utf8');
 assert.ok(s.includes('if(!session||!open)return'));
 assert.ok(!s.includes('aria-label="FIELD AI Supervisor"'));
});
