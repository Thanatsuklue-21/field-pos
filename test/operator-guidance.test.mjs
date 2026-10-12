import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('operator coach is embedded globally and auto-teaches the first device',async()=>{
  const shell=await read('components/app-shell.tsx');
  const coach=await read('components/operator-coach.tsx');
  assert.match(shell,/OperatorCoach/);
  assert.match(coach,/field-operator-coach-v1/);
  assert.match(coach,/localStorage\.getItem\(KEY\)!=="seen"/);
  assert.match(coach,/ใช้เป็นใน 1 นาที/);
  assert.match(coach,/FIELD SAFE FLOW · 60 SEC/);
});

test('operator coach teaches recognition-first guarded POS and FIFO production',async()=>{
  const coach=await read('components/operator-coach.tsx');
  assert.match(coach,/ทวนชื่อเมนู จำนวน และยอดกับลูกค้า/);
  assert.match(coach,/QR ต้องรอระบบยืนยัน/);
  assert.match(coach,/หยิบบัตรเลขที่ระบบแสดงให้ลูกค้า/);
  assert.match(coach,/ห้ามเลือกงานเอง/);
  assert.match(coach,/ทำบัตรแรกและงานที่กรอบสีทองชี้เท่านั้น/);
  assert.match(coach,/ลูกค้ารับของจริงแล้วจึงกด/);
  assert.match(coach,/ชงเสีย \/ ทำใหม่/);
});

test('coach controls are large enough for mobile operation',async()=>{
  const coach=await read('components/operator-coach.tsx');
  assert.ok((coach.match(/min-h-11/g)||[]).length>=1);
  assert.ok((coach.match(/min-h-12/g)||[]).length>=2);
});
