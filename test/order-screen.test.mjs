import test from 'node:test';
import assert from 'node:assert/strict';

test('order display puts available menus first without changing order within groups or mutating input',async()=>{
 const {availableMenusFirst}=await import('../lib/order-screen.mjs');
 const menus=Object.freeze([Object.freeze({id:'sold-out',available:false}),Object.freeze({id:'b',available:true}),Object.freeze({id:'a',available:true}),Object.freeze({id:'missing',available:false})]);
 const result=availableMenusFirst(menus);
 assert.deepEqual(result.map(x=>x.id),['b','a','sold-out','missing']);
 assert.equal(result[0],menus[1]);assert.equal(menus[0].id,'sold-out');
 assert.deepEqual(availableMenusFirst([]),[]);
 assert.deepEqual(availableMenusFirst(menus.filter(x=>!x.available)).map(x=>x.id),['sold-out','missing']);
});
