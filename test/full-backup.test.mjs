import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {buildFullBackup,validateFullBackup} from '../lib/full-backup.mjs';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const fixture=()=>buildFullBackup({stateRow:{revision:7,updated_at:99,document:JSON.stringify({dataVersion:'v9',menu:[{id:'m1'}],sales:[{id:'s1'}],ingredients:{i1:{qty:1}}})},tables:{stockTransactions:[{id:'st1'}],purchaseRecords:[{id:'p1',stock_transaction_id:'st1',package_qty:2,package_unit:'ขวด',pack_size:750,pack_size_unit:'ml',conversion_approximate:1,payment_method:'cash'}],costSnapshots:[{id:'c1',sale_id:'s1'}],recipeVersions:[{id:'r1',menu_id:'m1'}],costHistory:[{id:'h1',purchase_record_id:'p1'}],menuImages:[{menu_id:'m1',mime_type:'image/webp',data_url:'data:image/webp;base64,AA=='}]}});

test('full backup contains state, accounting ledgers and menu photos with exact counts',()=>{const b=fixture(),v=validateFullBackup(b);assert.equal(v.revision,7);assert.deepEqual(v.recordCounts,{fieldState:1,stockTransactions:1,purchaseRecords:1,costSnapshots:1,recipeVersions:1,costHistory:1,posRequests:0,menuImages:1})});
test('full backup rejects count tampering and broken references',()=>{const b=fixture();b.recordCounts.costHistory=2;assert.throws(()=>validateFullBackup(b),/backup_count_mismatch/);const c=fixture();c.tables.costHistory[0].purchase_record_id='missing';assert.throws(()=>validateFullBackup(c),/backup_reference_cost_purchase/)});
test('full backup rejects duplicate ledger ids before destructive restore',()=>{const b=fixture();b.tables.stockTransactions.push({...b.tables.stockTransactions[0]});b.recordCounts.stockTransactions=2;assert.throws(()=>validateFullBackup(b),/invalid_backup_ids:stockTransactions/)});
test('backup preserves durable POS request keys and accepts legacy v1 files',()=>{const b=fixture();b.tables.posRequests=[{request_key:'sale-request',response:JSON.stringify({ok:true,orderId:'o1'}),created_at:10}];b.recordCounts.posRequests=1;assert.equal(validateFullBackup(b).tables.posRequests.length,1);const old=fixture();old.schemaVersion=1;delete old.tables.posRequests;delete old.recordCounts.posRequests;assert.deepEqual(validateFullBackup(old).tables.posRequests,[])});
test('backup rejects menu photos that point at a missing menu',()=>{const b=fixture();b.tables.menuImages[0].menu_id='missing';assert.throws(()=>validateFullBackup(b),/backup_reference_menu_image/)});

test('backup v5 preserves purchase payment method and restore columns include it',async()=>{
  const b=fixture(),v=validateFullBackup(b),api=await read('lib/api.mjs');
  assert.equal(v.schemaVersion,5);
  assert.equal(v.tables.purchaseRecords[0].payment_method,'cash');
  assert.match(api,/purchaseRecords:\[[^\]]*'payment_method'/);
});

test('legacy v4 purchase backup defaults missing payment method to bank',()=>{
  const old=fixture();old.schemaVersion=4;delete old.tables.purchaseRecords[0].payment_method;
  const restored=validateFullBackup(old);
  assert.equal(restored.schemaVersion,5);
  assert.equal(restored.tables.purchaseRecords[0].payment_method,'bank');
});

test('backup v5 preserves package evidence and accepts legacy v3 without menu photos',()=>{const b=fixture(),v=validateFullBackup(b);assert.equal(v.tables.purchaseRecords[0].pack_size,750);assert.equal(v.tables.purchaseRecords[0].pack_size_unit,'ml');const old=fixture();old.schemaVersion=3;delete old.tables.menuImages;delete old.recordCounts.menuImages;delete old.tables.purchaseRecords[0].payment_method;const restored=validateFullBackup(old);assert.equal(restored.schemaVersion,5);assert.deepEqual(restored.tables.menuImages,[]);assert.equal(restored.tables.purchaseRecords[0].payment_method,'bank')});
test('backup v5 rejects invalid purchase payment method',()=>{const b=fixture();b.tables.purchaseRecords[0].payment_method='crypto';assert.throws(()=>validateFullBackup(b),/invalid_backup_purchase_payment_method/)});
