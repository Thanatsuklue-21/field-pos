"use client";
import {createPortal} from "react-dom";
export type ReceiptSale={billNo:string;queueNo:string;time:number;subtotal?:number;discountTotal?:number;crmDiscount?:number;pointsRedeemed?:number;pointsAwarded?:number;total:number;payment:string;status:string;received?:number;change?:number;items:{name:string;variant:string;qty:number;price:number}[]};
const money=(value:number)=>value.toLocaleString("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2});
export default function SaleReceipt({sale}:{sale:ReceiptSale}){
  return createPortal(<div className="field-receipt">
    <style>{`.field-receipt{display:none}@media print{@page{size:80mm auto;margin:5mm}body> *{display:none!important}body>.field-receipt{display:block!important;width:70mm;font:12px/1.6 sans-serif;color:#000;background:#fff}.field-receipt h1{text-align:center;font-size:22px;margin:0}.field-receipt p{margin:3px 0}.field-receipt table{width:100%;border-collapse:collapse}.field-receipt td{vertical-align:top;padding:4px 0}.field-receipt td:last-child{text-align:right}.field-receipt footer{border-top:1px dashed #000;padding-top:8px;text-align:center}}`}</style>
    <h1>FIELD</h1><p style={{textAlign:"center"}}>ใบเสร็จรับเงิน</p>
    <p>{sale.billNo}</p><p>คิว {sale.queueNo}</p>
    <p>{new Date(sale.time).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})}</p>
    {sale.status!=="paid"&&<p>สถานะ: {sale.status==="void"?"ยกเลิก":sale.status==="refunded"?"คืนเงิน":sale.status}</p>}
    <table><tbody>{sale.items.map((item,index)=><tr key={index}><td>{item.name}<br/>{item.variant} × {item.qty}</td><td>{money(item.price*item.qty)}</td></tr>)}</tbody></table>
    {Number(sale.discountTotal||0)>0&&<><p style={{borderTop:"1px dashed #000"}}>ยอดก่อนส่วนลด ฿{money(Number(sale.subtotal??sale.total))}</p><p>ส่วนลดสมาชิก −฿{money(Number(sale.discountTotal||0))}</p>{Number(sale.pointsRedeemed||0)>0&&<p>ใช้แต้ม {sale.pointsRedeemed} แต้ม</p>}</>}
    <p style={{borderTop:Number(sale.discountTotal||0)>0?"none":"1px dashed #000",fontWeight:700}}>ยอดสุทธิ ฿{money(sale.total)}</p>
    {Number(sale.pointsAwarded||0)>0&&<p>แต้มที่ได้รับ +{sale.pointsAwarded}</p>}
    <p>ชำระ: {sale.payment==="cash"?"เงินสด":sale.payment==="promptpay"?"PromptPay":sale.payment==="split"?"แบ่งชำระ":sale.payment}</p>
    {sale.payment==="cash"&&<><p>รับเงิน ฿{money(sale.received??sale.total)}</p><p>เงินทอน ฿{money(sale.change??0)}</p></>}
    <footer>ขอบคุณที่อุดหนุน FIELD</footer>
  </div>,document.body);
}
