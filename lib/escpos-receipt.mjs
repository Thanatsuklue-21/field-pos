const ESC=0x1b,GS=0x1d;

function bytes(...values){return Uint8Array.from(values)}
function concat(parts){
  const size=parts.reduce((sum,p)=>sum+p.length,0),out=new Uint8Array(size);
  let offset=0;for(const part of parts){out.set(part,offset);offset+=part.length}
  return out;
}
function textEncoder(value){return new TextEncoder().encode(String(value??""))}
function money(value){return Number(value||0).toLocaleString("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2})}
function paymentLabel(method){
  return method==="cash"?"เงินสด":method==="promptpay"?"PromptPay":method==="bank"?"โอนธนาคาร":method==="card"?"บัตร":method==="delivery"||method==="other"?"เดลิเวอรี":method==="split"?"แบ่งชำระ":String(method||"");
}
function receiptLines(sale){
  const lines=[
    "FIELD",
    "ใบเสร็จรับเงิน",
    String(sale.billNo||""),
    "คิว "+String(sale.queueNo||""),
    new Date(Number(sale.time)||Date.now()).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"}),
    "--------------------------------"
  ];
  for(const item of sale.items||[]){
    lines.push(String(item.name||""));
    const variant=String(item.variant||"").trim();
    lines.push((variant?variant+" · ":"")+"x"+Number(item.qty||0)+"  "+money(Number(item.price||0)*Number(item.qty||0)));
  }
  lines.push("--------------------------------");
  if(Number(sale.discountTotal||0)>0){
    lines.push("ยอดก่อนส่วนลด "+money(Number(sale.subtotal??sale.total)));
    lines.push("ส่วนลด -"+money(sale.discountTotal));
  }
  lines.push("ยอดสุทธิ "+money(sale.total));
  lines.push("ชำระ "+paymentLabel(sale.payment));
  if(sale.payment==="cash"){
    lines.push("รับเงิน "+money(sale.received??sale.total));
    lines.push("เงินทอน "+money(sale.change??0));
  }
  lines.push("ขอบคุณที่อุดหนุน FIELD");
  return lines;
}

/**
 * Build transport-agnostic ESC/POS bytes.
 * encodeText is injectable because Thai code pages differ by printer model.
 * The default UTF-8 encoder is suitable only for printers/bridges that explicitly support UTF-8.
 */
export function buildEscPosReceipt(sale,{paperWidth=80,encodeText=textEncoder}={}){
  if(!sale||!sale.billNo)throw new Error("receipt_bill_required");
  if(![58,80].includes(Number(paperWidth)))throw new Error("receipt_paper_width_invalid");
  const lines=receiptLines(sale),parts=[
    bytes(ESC,0x40),
    bytes(ESC,0x61,0x01),
    bytes(ESC,0x45,0x01),
    encodeText(lines[0]+"\n"),
    bytes(ESC,0x45,0x00),
    encodeText(lines[1]+"\n"),
    bytes(ESC,0x61,0x00),
  ];
  for(const line of lines.slice(2))parts.push(encodeText(line+"\n"));
  parts.push(encodeText("\n\n"));
  parts.push(bytes(GS,0x56,0x41,0x00));
  return concat(parts);
}

export function receiptEscPosCapabilities(){
  return {
    paperWidths:[58,80],
    requiresPrinterSpecificThaiEncoding:true,
    transports:["usb","bluetooth","lan-bridge"]
  };
}
