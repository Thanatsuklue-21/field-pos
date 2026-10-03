import { createClient } from '@libsql/client';
import {SCHEMA} from './schema.mjs';

let cached;
let schemaReady;

export async function ensureSchemaMigrations(db){
  const info=await db.execute('PRAGMA table_info(field_purchase_records)');
  const columns=new Set((info.rows||[]).map(row=>String(row.name||'')));
  const migrations=[
    ['pack_size','ALTER TABLE field_purchase_records ADD COLUMN pack_size REAL'],
    ['pack_size_unit','ALTER TABLE field_purchase_records ADD COLUMN pack_size_unit TEXT'],
    ['conversion_approximate','ALTER TABLE field_purchase_records ADD COLUMN conversion_approximate INTEGER'],
    ['payment_method',"ALTER TABLE field_purchase_records ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'bank'"],
  ].filter(([name])=>!columns.has(name)).map(([,sql])=>sql);
  if(!migrations.length)return false;
  if(typeof db.batch==='function')await db.batch(migrations.map(sql=>({sql,args:[]})),'write');
  else for(const sql of migrations)await db.execute(sql);
  return true;
}

export function getDb(){
  if(!cached){
    const url=process.env.TURSO_DATABASE_URL,authToken=process.env.TURSO_AUTH_TOKEN;
    if(!url||!authToken)throw new Error('turso_not_configured');
    cached=createClient({url,authToken});
  }
  return cached;
}

export async function ensureDbSchema(){
  if(!schemaReady){
    const db=getDb();
    schemaReady=(async()=>{
      // On a cold Vercel function this runs before the API handler. Sending every
      // CREATE/INDEX statement as a separate Turso round trip made the first tap
      // feel much slower than the actual business transaction. libSQL batch keeps
      // the same additive/idempotent schema contract but pipelines it as one write.
      if(typeof db.batch==='function'){
        await db.batch(SCHEMA.map(sql=>({sql,args:[]})),'write');
      }else{
        for(const sql of SCHEMA)await db.execute(sql);
      }
      await ensureSchemaMigrations(db);
      return true;
    })().catch(error=>{schemaReady=undefined;throw error});
  }
  return schemaReady;
}
