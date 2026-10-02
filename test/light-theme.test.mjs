import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('global theme defaults to light FIELD surfaces',()=>{
  const css=read('app/globals.css');
  assert.match(css,/--bg:\s*#f5f5f7/i);
  assert.match(css,/--surface:\s*#ffffff/i);
  assert.match(css,/--text-primary:\s*#1d1d1f/i);
  assert.doesNotMatch(css,/--bg:\s*#090909/i);
});

test('app shell no longer uses dark primary surfaces',()=>{
  const shell=read('components/app-shell.tsx');
  assert.doesNotMatch(shell,/bg-\[#090909\]/);
  assert.doesNotMatch(shell,/bg-\[#0e0e0e\]/);
  assert.match(shell,/bg-\[#f5f5f7\]/i);
  assert.match(shell,/bg-white/);
});

test('primary FIELD pages do not regress to legacy dark UI tokens',()=>{
  const files=[
    'components/auth-gate.tsx',
    'app/dashboard/page.tsx',
    'app/pos/page.tsx',
    'app/queue/page.tsx',
    'app/orders/page.tsx',
    'app/stock/page.tsx',
    'app/costs/page.tsx',
    'app/products/page.tsx',
    'app/recipes/page.tsx',
    'app/customers/page.tsx',
    'app/expenses/page.tsx',
    'app/reports/page.tsx',
    'app/close/page.tsx',
    'app/backup/page.tsx',
    'app/users/page.tsx',
    'app/audit/page.tsx',
    'app/settings/page.tsx',
  ];
  const banned=[
    /#090909/i,
    /#0e0e0e/i,
    /bg-\[#181818\]/i,
    /bg-\[#151515\]/i,
    /bg-\[#111\]/i,
    /bg-black\/25/,
    /bg-black\/30/,
    /bg-black\/40/,
    /border-white\//,
    /text-neutral-/,
  ];
  for(const file of files){
    const source=read(file);
    for(const pattern of banned){
      assert.doesNotMatch(source,pattern,file+' contains legacy dark token '+pattern);
    }
  }
});

test('reduced motion support is present',()=>{
  assert.match(read('app/globals.css'),/prefers-reduced-motion:\s*reduce/);
});
