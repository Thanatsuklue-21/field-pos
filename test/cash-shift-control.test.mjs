import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('cash shift opens once per business date and freezes opening cash for close day',async()=>{
  const api=await read('lib/api.mjs');
  const start=api.indexOf("if(path==='/api/cash-shift/open'");
  const end=api.indexOf("if(path==='/api/management/dashboard'",start);
  assert.ok(start>0&&end>start);
  const seg=api.slice(start,end);
  assert.match(seg,/cash_shift_already_opened/);
  assert.match(seg,/status:'open',openingCash/);
  assert.match(seg,/const shift=doc\.cashShifts\.find\(x=>x\.date===date&&x\.status==='open'\)/);
  assert.match(seg,/const openingCash=shift\?Number\(shift\.openingCash\)\|\|0:inputOpeningCash/);
  assert.match(seg,/shift\.status='closed'/);
  assert.match(seg,/openingCashSource:shift\?'SHIFT_OPEN':'CLOSE_INPUT_LEGACY'/);
});

test('close day UI records opening float before count and cannot edit it after shift opens',async()=>{
  const ui=await read('app/close/page.tsx');
  assert.match(ui,/OPEN CASH SHIFT/);
  assert.match(ui,/เงินตั้งต้นที่ล็อก/);
  assert.match(ui,/กรุณาเปิดกะและล็อกเงินตั้งต้นก่อนปิดวัน/);
  assert.match(ui,/JSON\.stringify\(\{countedCash:counted\}\)/);
  assert.doesNotMatch(ui,/body:JSON\.stringify\(\{openingCash:opening,countedCash:counted\}\)/);
  assert.match(ui,/Expected Cash = เงินตั้งต้น \+ ยอดขายเงินสด − ค่าใช้จ่ายที่จ่ายสดจากลิ้นชัก/);
});
