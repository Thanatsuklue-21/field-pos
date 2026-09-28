import { createClient } from '@libsql/client';
let cached;
export function getDb(){
  if(!cached){
    const url=process.env.TURSO_DATABASE_URL,authToken=process.env.TURSO_AUTH_TOKEN;
    if(!url||!authToken)throw new Error('turso_not_configured');
    cached=createClient({url,authToken});
  }
  return cached;
}
