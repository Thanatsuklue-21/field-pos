import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('split recovery metadata is safe and manager recovery stays server-authoritative',async()=>{
  const domain=await read('lib/pos-api.mjs');
  const api=await read('lib/api.mjs');
  const orders=await read('app/orders/page.tsx');

  assert.match(domain,/mode:s\.mode\|\|'split'/);
  assert.match(domain,/resolutionRequiredAt/);
  assert.match(domain,/resolvedAt/);
  assert.match(domain,/resolvedBy/);

  const resolveStart=api.indexOf("if(path==='/api/pos/split/resolve'");
  assert.ok(resolveStart>0);
  const resolveSegment=api.slice(resolveStart,resolveStart+500);
  assert.match(resolveSegment,/user\.role!=='admin'/);
  assert.match(resolveSegment,/resolveSplitPayment/);

  assert.match(orders,/เจ้าของร้าน · รายการรับเงินค้าง/);
  assert.match(orders,/session\.user\.role==="admin"/);
  assert.match(orders,/recoveryDetail\.mode==="promptpay_full"/);
  assert.match(orders,/!s\.resolvedAt/);
  assert.match(orders,/\/api\/pos\/split\/resolve/);
  assert.match(orders,/\/api\/pos\/split\/pay/);
  assert.match(orders,/allocations=\(s\.remainingQty\|\|\[\]\)/);
  assert.match(orders,/รายการรับเงินนี้ถูกดำเนินการจากอีกเครื่องแล้ว/);
  assert.match(orders,/เจ้าของร้านไม่สามารถเปลี่ยนรายการนี้เป็นเงินสด\/โอน\/บัตร/);
});
