// Navigation policy mirrors existing API permissions; it never grants server access.
export const ROUTE_ACCESS=Object.freeze({
 '/pos':'order','/queue':'queue','/orders':'order',
 '/dashboard':'report','/close':'report','/expenses':'report','/reports':'report',
 '/stock':'stock','/control':'admin','/products':'admin','/recipes':'admin',
 '/costs':'admin','/customers':'admin','/settlements':'admin','/backup':'admin',
 '/users':'admin','/audit':'admin','/settings':'any'
});
const frontRoutes=['/pos','/queue','/orders'];
export function canAccessRoute(user,path){
 if(!user||user.active===false)return false;
 const route='/'+String(path||'').split('/').filter(Boolean)[0];
 const permission=ROUTE_ACCESS[route];
 if(!permission)return false;
 return permission==='any'||user.role==='admin'||permission!=='admin'&&user.permissions?.[permission]===true;
}
export function workModeForPath(path){return frontRoutes.includes(path)?'front':'back'}
export function defaultWorkRoute(user,mode='front'){
 const paths=mode==='back'?['/dashboard','/stock']:['/pos','/queue','/orders'];
 return paths.find(path=>canAccessRoute(user,path))||null;
}
export const PERMISSION_INFO=Object.freeze({
 order:{label:'รับออเดอร์ / รับเงิน',description:'ขายสินค้า รับชำระเงิน และตรวจบิล'},
 queue:{label:'ทำเครื่องดื่ม / ส่งมอบ',description:'ทำคิว เรียกลูกค้า และส่งมอบ'},
 stock:{label:'รับเข้า / ดูแลสต็อก',description:'รับของเข้า บันทึกของเสีย และส่งผลนับให้เจ้าของร้านอนุมัติ'},
 report:{label:'รายงาน / ปิดยอด',description:'ดูยอดขาย บันทึกรายจ่าย และปิดยอดประจำวัน'}
});
export const STAFF_PRESETS=Object.freeze([
 {id:'cashier',label:'คนขาย',description:'รับออเดอร์และรับเงิน',permissions:{order:true,queue:false,stock:false,report:false}},
 {id:'barista',label:'คนชง',description:'ทำคิวและส่งมอบเครื่องดื่ม',permissions:{order:false,queue:true,stock:false,report:false}},
 {id:'front',label:'หน้าร้านครบ',description:'รับออเดอร์ ทำคิว และส่งมอบ',permissions:{order:true,queue:true,stock:false,report:false}},
 {id:'shift',label:'ผู้ดูแลกะ',description:'งานหน้าร้าน ตรวจสต็อก รายจ่าย และปิดยอด',permissions:{order:true,queue:true,stock:true,report:true}}
]);

export const BACK_OFFICE_GROUPS=Object.freeze([
 {id:'daily',label:'งานประจำวัน',routes:['/stock','/expenses','/close']},
 {id:'money',label:'ยอดขายและรายงาน',routes:['/dashboard','/reports','/costs','/settlements']},
 {id:'setup',label:'ข้อมูลร้านและระบบ',routes:['/products','/recipes','/customers','/control','/backup','/users','/audit','/settings']}
]);
