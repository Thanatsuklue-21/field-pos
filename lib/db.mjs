import { createClient } from '@libsql/client';
import {SCHEMA} from './schema.mjs';

const SCHEMA_VERSION=1;
const SCHEMA_META_TABLE='field_schema_meta';
let cached;
let schemaReady;

async function readSchemaVersion(db){
  try{
    const result=await db.execute(`SELECT version FROM ${SCHEMA_META_TABLE} WHERE singleton=1`);
    return Number(result.rows?.[0]?.version||0);
  }catch(error){
    const message=String(error?.message||error||'');
    if(new RegExp('no such table:\\s*'+SCHEMA_META_TABLE,'i').test(message))return 0;
    throw error;
  }
}

async function writeSchemaVersion(db){
  await db.execute(`CREATE TABLE IF NOT EXISTS ${SCHEMA_META_TABLE}(singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL,updated_at INTEGER NOT NULL)`);
  await db.execute({
    sql:`INSERT INTO ${SCHEMA_META_TABLE}(singleton,version,updated_at) VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET version=excluded.version,updated_at=excluded.updated_at`,
    args:[SCHEMA_VERSION,Date.now()]
  });
}

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
      // Keep schema versioning in a normal Turso table instead of PRAGMA
      // user_version. Remote libSQL may reject PRAGMA writes even when ordinary
      // reads are healthy, which must never turn every API request into 503.
      const version=await readSchemaVersion(db);
      if(version===SCHEMA_VERSION)return true;
      if(version>SCHEMA_VERSION)throw new Error('schema_version_newer_than_app');

      // Keep the additive/idempotent schema path for first install and future
      // version bumps. libSQL batch pipelines the initial DDL in one write.
      if(typeof db.batch==='function'){
        await db.batch(SCHEMA.map(sql=>({sql,args:[]})),'write');
      }else{
        for(const sql of SCHEMA)await db.execute(sql);
      }
      await ensureSchemaMigrations(db);
      await writeSchemaVersion(db);
      return true;
    })().catch(error=>{schemaReady=undefined;throw error});
  }
  return schemaReady;
}
