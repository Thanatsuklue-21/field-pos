import {randomUUID} from 'node:crypto';
import {getDb,ensureSchemaMigrations} from '../lib/db.mjs';
import {SCHEMA} from '../lib/schema.mjs';
import {hashPassword,validPassword,validUsername} from '../lib/security.mjs';
const db=getDb();
for(const sql of SCHEMA)await db.execute(sql);
await ensureSchemaMigrations(db);
const username=String(process.argv[2]||'admin').toLowerCase();
if(!validUsername(username))throw new Error('Username must be 3–32 ASCII letters, digits, . _ or -');
const count=await db.execute("SELECT COUNT(*) AS n FROM field_users WHERE role='admin'");
if(Number(count.rows[0].n))throw new Error('Admin exists. Use the authenticated Admin API.');
async function prompt(){
  if(process.env.FIELD_ADMIN_PASSWORD)return process.env.FIELD_ADMIN_PASSWORD;
  if(!process.stdin.isTTY)throw new Error('Use an interactive terminal or FIELD_ADMIN_PASSWORD environment variable');
  process.stdout.write('Initial Admin password: ');
  process.stdin.setRawMode(true);process.stdin.resume();
  return new Promise(resolve=>{let value='';const handler=data=>{const c=data.toString();if(c==='\r'||c==='\n'){process.stdin.setRawMode(false);process.stdin.pause();process.stdin.off('data',handler);process.stdout.write('\n');resolve(value)}else if(c==='\u0003')process.exit(130);else if(c==='\u007f')value=value.slice(0,-1);else value+=c};process.stdin.on('data',handler)});
}
const password=await prompt();if(!validPassword(password))throw new Error('Password must have a letter and 10–128 characters');
const now=Date.now();
await db.execute({sql:'INSERT INTO field_users(id,username,password_hash,role,permissions,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',args:[randomUUID(),username,await hashPassword(password),'admin','{}',now,now]});
console.log('Admin created:',username);
