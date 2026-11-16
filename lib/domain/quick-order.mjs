// Solo-operator quick ordering: one tap adds the shop's default recipe, and
// sweetness is changed in the cart instead of a modal on every drink.

const DEFAULT_LABELS=new Set(['100%','normal','ปกติ','หวานปกติ','standard','']);

export function normalizeVariantLabel(label){
  return String(label??'').trim().toLowerCase().replace(/\s+/g,'');
}

// The variant a plain menu tap should add, or null when the operator must
// choose (e.g. cup sizes, or the default recipe is unavailable right now).
export function quickAddVariant(variants){
  if(!Array.isArray(variants)||!variants.length)return null;
  if(variants.length===1)return variants[0].available===false?null:variants[0];
  const preferred=variants.find(v=>DEFAULT_LABELS.has(normalizeVariantLabel(v?.label)));
  if(!preferred||preferred.available===false)return null;
  return preferred;
}

// Short chip label used inside cart lines.
export function shortVariantLabel(label){
  const v=normalizeVariantLabel(label);
  if(['100%','normal','ปกติ','หวานปกติ'].includes(v))return 'หวานปกติ';
  if(['50%','less','lesssweet','หวานน้อย'].includes(v))return 'หวานน้อย';
  if(['0%','no','nosweet','ไม่หวาน'].includes(v))return 'ไม่หวาน';
  if(v==='25%')return 'หวาน 25%';
  if(v==='75%')return 'หวาน 75%';
  if(v===''||v==='standard')return 'มาตรฐาน';
  return String(label);
}

// Move exactly one cup of a cart line to another variant of the same menu.
// Returns a new items array (input untouched); the moved cup is merged into an
// existing line of that variant or inserted right after the source line.
export function moveOneUnitToVariant(items,key,variantLabel){
  const list=Array.isArray(items)?items:[];
  const source=list.find(i=>i.key===key);
  if(!source||source.variant===variantLabel||!(Number(source.qty)>=1))return list;
  const targetKey=source.id+'::'+variantLabel;
  const hasTarget=list.some(i=>i.key===targetKey);
  const out=[];
  for(const item of list){
    if(item.key===key){
      if(item.qty>1)out.push({...item,qty:item.qty-1});
      if(!hasTarget)out.push({...item,key:targetKey,variant:variantLabel,qty:1});
    }else if(item.key===targetKey){
      out.push({...item,qty:item.qty+1});
    }else out.push(item);
  }
  return out;
}
