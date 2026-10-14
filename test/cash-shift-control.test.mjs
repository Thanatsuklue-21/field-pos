import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
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

test('close day UI freezes opening float and requires blind reviewed count',async()=>{
  const ui=await read('app/close/page.tsx');
  assert.match(ui,/เปิดร้านวันนี้/);
  assert.match(ui,/เงินตั้งต้นที่ล็อก/);
  assert.match(ui,/กรุณาเปิดร้านและล็อกเงินตั้งต้นก่อนปิดวัน/);
  assert.match(ui,/\/api\/close-day\/review/);
  assert.match(ui,/firstCount:first,secondCount:second/);
  assert.match(ui,/reviewId:review\.id/);
  assert.doesNotMatch(ui,/body:JSON\.stringify\(\{openingCash:opening,countedCash:counted\}\)/);
  assert.match(ui,/เงินสดที่ควรมี = เงินตั้งต้น \+ ยอดขายเงินสด \+ เงินเติมเข้า − ค่าใช้จ่ายเงินสด − เงินนำออก/);
});


test('durable start-day replay precedes business-date and duplicate-open guards',async()=>{
  const api=await read('lib/api.mjs');
  const start=api.indexOf("if(path==='/api/cash-shift/open'");
  const end=api.indexOf("if(path==='/api/cash-shift/movements'",start);
  const block=api.slice(start,end);
  assert.match(block,/replayDurableRequest\(tx,doc,requestKey,context\)/);
  assert.ok(block.indexOf("replayDurableRequest")<block.indexOf("business_date_changed"));
  assert.ok(block.indexOf("replayDurableRequest")<block.indexOf("day_already_closed"));
  assert.ok(block.indexOf("replayDurableRequest")<block.indexOf("cash_shift_already_opened"));
  assert.match(block,/rememberDurableRequestStatement\(doc,requestKey,response,context,now\)/);
  assert.match(block,/requestKey:durableMode\?requestKey:null/);
  assert.match(block,/performedBy:user\.id/);
  assert.match(block,/const durableMode=requestKey\.length>0/);
});

test('Close Day and POS workspace share the same durable start-day recovery contract',async()=>{
  const close=await read('app/close/page.tsx');
  const workspace=await read('components/pos-daily-workspace.tsx');
  for(const source of [close,workspace]){
    assert.match(source,/prepareCashShiftOpenIntent/);
    assert.match(source,/readCashShiftOpenIntent/);
    assert.match(source,/sendCashShiftOpenIntent/);
    assert.match(source,/\/api\/cash-shift\/open/);
  }
  assert.match(close,/ตรวจผลการเปิดร้านเดิม/);
  assert.match(workspace,/เริ่มงานวันนี้/);
  assert.match(workspace,/เปิดร้านวันนี้/);
  assert.match(workspace,/เงินสดตั้งต้น/);
});
