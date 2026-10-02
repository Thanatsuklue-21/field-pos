import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMenuImageUpload} from '../lib/domain/menu-image.mjs';

test('menu image accepts a compact JPEG data URL and returns decoded bytes',()=>{
  const out=normalizeMenuImageUpload({dataUrl:'data:image/jpeg;base64,/9j/2Q=='});
  assert.equal(out.mimeType,'image/jpeg');
  assert.deepEqual([...out.bytes],[255,216,255,217]);
});

test('menu image rejects unsupported types and oversized payloads',()=>{
  assert.throws(()=>normalizeMenuImageUpload({dataUrl:'data:image/svg+xml;base64,PHN2Zy8+'}),/invalid_menu_image/);
  const huge='data:image/webp;base64,'+Buffer.alloc(180001).toString('base64');
  assert.throws(()=>normalizeMenuImageUpload({dataUrl:huge}),/menu_image_too_large/);
});

test('menu image is stored outside field_state and has upload/read endpoints',async()=>{
  const {readFile}=await import('node:fs/promises');
  const schema=await readFile(new URL('../lib/schema.mjs',import.meta.url),'utf8');
  const api=await readFile(new URL('../lib/api.mjs',import.meta.url),'utf8');
  assert.match(schema,/field_menu_images/);
  assert.ok(api.includes("path.match(/^\\/api\\/admin\\/products\\/([^/]+)\\/image$/)"));
  assert.ok(api.includes("path.match(/^\\/api\\/menu-images\\/([^/]+)$/)"));
  assert.match(api,/INSERT INTO field_menu_images/);
  assert.match(api,/\['menuImages','posRequests'/);
  assert.match(api,/,'menuImages'\]\)await insertBackupRows/);
});
