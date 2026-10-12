const ESC=0x1b,GS=0x1d;

const bytes=(...values)=>Uint8Array.from(values.flat());
const concat=parts=>{
  const total=parts.reduce((sum,part)=>sum+part.length,0);
  const out=new Uint8Array(total);
  let offset=0;
  for(const part of parts){out.set(part,offset);offset+=part.length}
  return out;
};

export const escpos={
  initialize:()=>bytes(ESC,0x40),
  alignLeft:()=>bytes(ESC,0x61,0x00),
  alignCenter:()=>bytes(ESC,0x61,0x01),
  bold:(on=true)=>bytes(ESC,0x45,on?0x01:0x00),
  feed:(lines=1)=>bytes(ESC,0x64,Math.max(0,Math.min(255,Math.trunc(Number(lines)||0)))),
  cut:()=>bytes(GS,0x56,0x41,0x00)
};

const money=value=>Number(value||0).toFixed(2);
const paymentLabel=value=>{
  const key=String(value||"").toLowerCase();
  return key==="cash"?"CASH":
    key==="promptpay"?"PROMPTPAY":
    key==="bank"?"BANK TRANSFER":
    key==="card"?"CARD":
    key==="delivery"?"DELIVERY":
    key.toUpperCase()||"-";
};

function encoderGuard(encodeText){
  if(typeof encodeText!=="function")throw new TypeError("escpos_text_encoder_required");
  return text=>{
    const result=encodeText(String(text??""));
    if(!(result instanceof Uint8Array))throw new TypeError("escpos_text_encoder_must_return_uint8array");
    return result;
  };
}

function textLine(encode,text=""){return concat([encode(text),bytes(0x0a)])}
function divider(width){return "-".repeat(Math.max(8,Math.trunc(Number(width)||32)))}
function localTime(value){
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0)return "";
  return new Date(n).toLocaleString("th-TH",{timeZone:"Asia/Bangkok",hour12:false});
}

export function buildEscPosReceipt(sale,{paperWidth=80,encodeText}={}){
  if(!sale||!sale.billNo)throw new TypeError("escpos_receipt_sale_required");
  const encode=encoderGuard(encodeText);
  const chars=Number(paperWidth)===58?32:42;
  const items=Array.isArray(sale.items)?sale.items:[];

  const parts=[
    escpos.initialize(),
    escpos.alignCenter(),
    escpos.bold(true),
    textLine(encode,"FIELD"),
    escpos.bold(false),
    textLine(encode,"BILL "+String(sale.billNo)),
    textLine(encode,"QUEUE "+String(sale.queueNo||"-")),
    sale.time?textLine(encode,localTime(sale.time)):new Uint8Array(),
    textLine(encode,divider(chars)),
    escpos.alignLeft()
  ];

  for(const item of items){
    const qty=Math.max(0,Math.trunc(Number(item.qty)||0));
    const price=Number(item.price)||0;
    parts.push(
      escpos.bold(true),
      textLine(encode,String(item.name||"-")),
      escpos.bold(false)
    );
    if(item.variant)parts.push(textLine(encode,String(item.variant)));
    parts.push(textLine(encode,`${qty} x ${money(price)} = ${money(qty*price)}`));
  }

  parts.push(textLine(encode,divider(chars)));
  if(Number(sale.discountTotal||sale.crmDiscount||0)>0){
    parts.push(textLine(encode,"DISCOUNT -"+money(Number(sale.discountTotal||sale.crmDiscount||0))));
  }
  parts.push(
    escpos.bold(true),
    textLine(encode,"TOTAL "+money(sale.total)),
    escpos.bold(false),
    textLine(encode,"PAYMENT "+paymentLabel(sale.payment))
  );

  if(String(sale.payment||"").toLowerCase()==="cash"){
    parts.push(
      textLine(encode,"RECEIVED "+money(sale.received)),
      textLine(encode,"CHANGE "+money(sale.change))
    );
  }
  if(Number(sale.pointsRedeemed||0)>0)parts.push(textLine(encode,"POINTS USED "+Math.trunc(Number(sale.pointsRedeemed)||0)));
  if(Number(sale.pointsAwarded||0)>0)parts.push(textLine(encode,"POINTS +"+Math.trunc(Number(sale.pointsAwarded)||0)));

  parts.push(
    escpos.alignCenter(),
    textLine(encode,"THANK YOU"),
    escpos.feed(3),
    escpos.cut()
  );
  return concat(parts);
}

export function escPosReceiptCapabilities(){
  return {
    requiresExplicitTextEncoder:true,
    supportsPaperWidths:[58,80],
    transport:"external",
    commands:["initialize","align","bold","feed","cut"]
  };
}
