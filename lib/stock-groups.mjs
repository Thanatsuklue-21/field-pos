// Display-only grouping of ingredients for the stock page (owner request 2026-11-17).
// Derived from the ingredient id/name; never stored and never affects stock math.
export const STOCK_GROUPS=Object.freeze([
  {key:'tea',label:'ชา · กาแฟ · โกโก้'},
  {key:'dairy',label:'นม · ครีม'},
  {key:'sweet',label:'ไซรัป · ความหวาน'},
  {key:'base',label:'น้ำ · น้ำแข็ง · ผลไม้'},
  {key:'pack',label:'บรรจุภัณฑ์'},
  {key:'other',label:'อื่นๆ'}
]);
const RULES=[
  ['base',/(\bice\b|น้ำแข็ง)/i], // "น้ำแข็งหลอดเล็ก" contains หลอด (straw)
  ['pack',/(cup|lid|straw|bag|sleeve|holder|napkin|แก้ว|ฝา|หลอด|ถุง|กล่อง|ปลอก|ทิชชู|ช้อน)/i],
  ['dairy',/(milk|meiji|cream|creamer|condensed|evap|carnation|นม|ครีม|วิปปิ้ง)/i],
  ['tea',/(tea|matcha|coffee|espresso|bean|cocoa|choco|ชา|มัทฉะ|กาแฟ|โกโก้|ช็อก)/i],
  ['sweet',/(syrup|sugar|honey|caramel|sweet|ไซรัป|น้ำตาล|น้ำผึ้ง|น้ำแดง|คาราเมล|หวาน)/i],
  ['base',/(water|ice|soda|lime|lemon|orange|fruit|น้ำแข็ง|น้ำดื่ม|โซดา|มะนาว|ส้ม|ผลไม้|น้ำเปล่า)/i]
];
export function stockGroupOf(item){
  const text=String(item?.id||'')+' '+String(item?.name||'');
  // Packaging first: "แก้วร้อน" must not fall into tea/coffee by a later keyword.
  for(const [key,re] of RULES)if(re.test(text))return key;
  return 'other';
}
export function needsRestock(item){return !item?.archived&&(Number(item?.qty)<=0||!!item?.lowStock)}
