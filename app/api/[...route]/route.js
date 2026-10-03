import {getDb,ensureDbSchema} from "../../../lib/db.mjs";
import {createApi} from "../../../lib/api.mjs";

export const runtime="nodejs";
export const dynamic="force-dynamic";

async function handle(request,{params}){
  const {route=[]}=await params;
  const headers=Object.fromEntries(request.headers.entries());
  let body={},rawBody="";
  if(!["GET","HEAD"].includes(request.method)){
    const raw=await request.text();
    rawBody=raw;
    if(raw){
      try{body=JSON.parse(raw)}catch{return Response.json({error:"invalid_json"},{status:400})}
    }
  }
  const req={method:request.method,headers,query:{route},body,rawBody};
  let status=200,responseHeaders={},chunks=[];
  const res={
    writeHead(code,h={}){status=code;responseHeaders={...responseHeaders,...h};},
    end(chunk=""){if(chunk!==undefined&&chunk!==null)chunks.push(typeof chunk==="string"||chunk instanceof Uint8Array?chunk:String(chunk));},
    status(code){status=code;return this;},
    json(value){responseHeaders["Content-Type"]="application/json; charset=utf-8";chunks=[JSON.stringify(value)];return this;}
  };
  await ensureDbSchema();
  const origin=process.env.PUBLIC_ORIGIN;
  if(!origin||!origin.startsWith("https://"))return Response.json({error:"origin_not_configured"},{status:503});
  await createApi({db:getDb(),origin})(req,res);
  const responseBody=chunks.length===1?chunks[0]:chunks.map(x=>typeof x==="string"?x:new TextDecoder().decode(x)).join("");
  return new Response(responseBody,{status,headers:responseHeaders});
}
export const GET=handle;
export const POST=handle;
export const PATCH=handle;
export const PUT=handle;
export const DELETE=handle;
