import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync('app/globals.css','utf8');
function luminance(hex){return hex.match(/[a-f\d]{2}/gi).map(x=>parseInt(x,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0)}
test('unavailable menu labels retain AA contrast without fading the whole card',()=>{
 const token=name=>{const match=css.match(new RegExp('--field-menu-unavailable-'+name+':(#[a-fA-F0-9]{6})'));assert.ok(match,name);return match[1]};
 for(const foreground of ['fg','reason']){const a=luminance(token(foreground)),b=luminance(token('bg'));assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,foreground)}
 assert.match(css,/\.field-app-root \.pos-menu-card:disabled\s*\{[^}]*opacity:1/s);
});
