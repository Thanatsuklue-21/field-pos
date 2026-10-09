import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';
import * as csv from '../lib/report-csv.mjs';
const source=ts.transpileModule(await readFile(new URL('../app/reports/page.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function render(data){
  const exports={};runInNewContext(source,{exports,require(path){
    if(path==='react')return {useState:initial=>[initial===null?data:initial,()=>{}],useEffect(){}};
    if(path==='react/jsx-runtime')return jsx;
    if(path==='next/link')return {default:({children,...props})=>createElement('a',props,children)};
    if(path==='@/components/auth-gate')return {default:({children})=>children({})};
    if(path==='@/lib/api-client')return {};
    if(path==='@/lib/report-csv.mjs')return csv;
    if(path==='recharts'||path==='lucide-react')return new Proxy({},{get:()=>()=>null});
    throw Error(path);
  }});
  return renderToStaticMarkup(createElement(exports.default));
}
const data={todaySummary:{date:'2026-10-09',orders:10,cups:10,revenue:550,cogs:196,operatingExpenses:80,purchaseSpend:0,grossProfit:354,operatingProfit:274,closed:true,expectedCash:900,countedCash:900,cashVariance:0},todayRevenue:550,totalRevenue:1100,grossProfit:708,grossMargin:64.4,cups:20};
test('frontend renders today 10-cup finances separately from all-time totals',()=>{
  const html=render(data);
  for(const text of ['สรุปวันนี้','2026-10-09','10 บิล','10 แก้ว','274','รายจ่ายดำเนินงาน','1,100','900'])assert.ok(html.includes(text),text);
  assert.ok(html.includes('รายการเมนู CSV'));assert.ok(html.includes('สรุปวันนี้ CSV'));
});
test('frontend does not reveal drawer result before independent close-day counting',()=>{
  const html=render({...data,todaySummary:{...data.todaySummary,closed:false,expectedCash:null,countedCash:null,cashVariance:null}});
  assert.ok(!html.includes('เงินสดคาดหวัง'));assert.ok(html.includes('ยังไม่ปิดวัน'));
});
test('frontend loading state does not display fake zero-valued financial reports',()=>{
  const html=render(null);assert.ok(html.includes('กำลังโหลดรายงาน'));assert.ok(!html.includes('฿0'));assert.ok(!html.includes('Sales CSV'));
});
