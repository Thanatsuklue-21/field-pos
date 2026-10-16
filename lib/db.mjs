import { createClient } from '@libsql/client';
import {SCHEMA} from './schema.mjs';

const SCHEMA_VERSION=1;
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
      // user_version is a durable SQLite/libSQL marker. After the first
      // deployment, cold functions only need one metadata read instead of
      // replaying every CREATE/INDEX statement against Turso.
      const versionResult=await db.execute('PRAGMA user_version');
      const version=Number(versionResult.rows?.[0]?.user_version||0);
      if(version===SCHEMA_VERSION)return true;

      // Keep the additive/idempotent schema path for first install and future
      // version bumps. libSQL batch pipelines the initial DDL in one write.
      if(typeof db.batch==='function'){
        await db.batch(SCHEMA.map(sql=>({sql,args:[]})),'write');
      }else{
        for(const sql of SCHEMA)await db.execute(sql);
      }
      await ensureSchemaMigrations(db);
      await db.execute(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      return true;
    })().catch(error=>{schemaReady=undefined;throw error});
  }
  return schemaReady;
}
