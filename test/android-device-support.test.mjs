import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('unsupported Android browsers get a Thai update instruction instead of a blank screen',async()=>{
  const layout=await read('app/layout.tsx');
  assert.match(layout,/CSS\.supports\("color","color-mix\(in srgb, red, blue\)"\)/);
  assert.match(layout,/อัปเดต <b>Google Chrome<\/b>/);
  assert.match(layout,/Android 7 ขึ้นไป/);
  // Mounted outside <body> so React hydration cannot remove it.
  assert.match(layout,/document.documentElement.appendChild\(d\)/);
  // The guard runs before the app bundle and must stay ES5 (no arrow functions/let/const).
  const guard=layout.slice(layout.indexOf('const LEGACY_BROWSER_GUARD=`')+28,layout.indexOf('`;',layout.indexOf('const LEGACY_BROWSER_GUARD=`')));
  assert.doesNotMatch(guard,/=>|\blet\b|\bconst\b/);
});

test('narrow/large-text header truncates the mode label instead of overlapping the switch',async()=>{
  const shell=await read('components/app-shell.tsx');
  const css=await read('app/globals.css');
  assert.match(shell,/field-mode-label min-w-0 flex-1 overflow-hidden/);
  assert.match(css,/\.field-mode-label > \*\{white-space:nowrap;overflow:hidden;text-overflow:ellipsis\}/);
});

test('disabled checkout and hold actions use the readable disabled palette',async()=>{
  const pos=await read('app/pos/page.tsx');
  const css=await read('app/globals.css');
  assert.equal((pos.match(/onClick=\{holdCurrentBill\} className="field-cart-action /g)||[]).length,2);
  assert.equal((pos.match(/onClick=\{openPayment\} className="field-cart-action /g)||[]).length,2);
  assert.match(css,/\.field-app-root \.field-cart-action:disabled\{\s*background:var\(--field-button-disabled-bg\);\s*color:var\(--field-button-disabled-fg\);/);
});

test('Android matrix QA covers phones, 7/10-inch tablets, large text and low-end CPU',async()=>{
  const qa=await read('scripts/qa-android-matrix.py');
  for(const size of ['320,640','360,640','412,915','600,960','800,1280','1280,800','1024,600'])assert.ok(qa.includes(size),size);
  assert.match(qa,/large-text/);
  assert.match(qa,/setCPUThrottlingRate',\{'rate':6\}/);
});
