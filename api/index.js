import {getDb} from '../lib/db.mjs';
import {createApi} from '../lib/api.mjs';
export default async function handler(req,res){
  const origin=process.env.PUBLIC_ORIGIN;
  if(!origin||!origin.startsWith('https://')){res.status(503).json({error:'origin_not_configured'});return}
  return createApi({db:getDb(),origin})(req,res);
}
