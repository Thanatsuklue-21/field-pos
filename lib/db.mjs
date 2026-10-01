import { createClient } from '@libsql/client';
import {SCHEMA} from './schema.mjs';
let cached;
let schemaReady;
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
    schemaReady=(async()=>{for(const sql of SCHEMA)await db.execute(sql);return true})().catch(error=>{schemaReady=undefined;throw error});
  }
  return schemaReady;
}
