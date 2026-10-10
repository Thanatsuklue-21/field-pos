export function inspectPaymentRecoveryRaw({promptRaw=null,cashRaw=null}={}){
  const check=(kind,raw)=>{
    if(raw===null||raw===undefined||raw==="")return null;
    let parsed;
    try{parsed=JSON.parse(raw)}catch{return {ok:false,kind,reason:"malformed_json"}}
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return {ok:false,kind,reason:"invalid_shape"};
    if(!Number.isFinite(Number(parsed.createdAt))||Number(parsed.createdAt)<=0)return {ok:false,kind,reason:"invalid_created_at"};
    if(kind==="promptpay"){
      if(typeof parsed.requestKey!=="string"||!parsed.requestKey||!Array.isArray(parsed.cart))return {ok:false,kind,reason:"invalid_shape"};
    }else{
      if(!parsed.body||typeof parsed.body!=="object"||Array.isArray(parsed.body)||typeof parsed.body.requestKey!=="string"||!parsed.body.requestKey||!Array.isArray(parsed.body.cart))return {ok:false,kind,reason:"invalid_shape"};
    }
    return null;
  };
  return check("promptpay",promptRaw)||check("cash",cashRaw)||{ok:true};
}
