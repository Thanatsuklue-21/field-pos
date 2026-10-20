import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const css=readFileSync('app/globals.css','utf8');
const workspace=readFileSync('components/pos-daily-workspace.tsx','utf8');
function luminance(hex){return hex.match(/[a-f\d]{2}/gi).map(x=>parseInt(x,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0)}
test('FIELD workspace button tokens meet AA including disabled',()=>{
 for(const kind of ['green','gold','disabled']){
  const token=name=>{const match=css.match(new RegExp('--field-button-'+kind+'-'+name+':(#[a-fA-F0-9]{6})'));assert.ok(match,kind+' '+name);return match[1]};
  const a=luminance(token('bg')),b=luminance(token('fg'));
  assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,kind);
 }
 assert.match(css,/button:disabled[^}]*opacity:1/s);
 assert.match(workspace,/field-workspace/);
});
test('stock recommendation explicitly opens actionable guidance even when stock is selected',()=>{
 assert.match(workspace,/if\(target==="stock"\)setStockGuidanceOpen\(true\)/);
 assert.match(workspace,/stockGuidanceOpen&&/);
 assert.match(workspace,/id="workspace-stock-guidance"/);
 assert.match(workspace,/aria-controls=.*workspace-stock-guidance/);
 assert.match(workspace,/href="\/stock"/);
});
