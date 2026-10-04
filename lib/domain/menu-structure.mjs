const DEFAULT_PREP_BASES=Object.freeze([
  {id:'MATCHA',label:'MATCHA BASE',enabled:true,ingredientIds:[],batchMode:'SEQUENTIAL'},
  {id:'COFFEE',label:'COFFEE BASE',enabled:true,ingredientIds:[],batchMode:'SEQUENTIAL'},
  {id:'THAI_TEA',label:'THAI TEA BASE',enabled:true,ingredientIds:[],batchMode:'SEQUENTIAL'},
  {id:'GREEN_TEA',label:'GREEN TEA BASE',enabled:true,ingredientIds:[],batchMode:'SEQUENTIAL'},
  {id:'COCOA',label:'COCOA BASE',enabled:true,ingredientIds:[],batchMode:'SEQUENTIAL'},
  {id:'FRUIT',label:'FRUIT BASE',enabled:true,ingredientIds:[],batchMode:'NONE'},
  {id:'SODA',label:'SODA',enabled:true,ingredientIds:[],batchMode:'NONE'},
]);
const BATCH_MODES=new Set(['NONE','SEQUENTIAL','COMBINED']);

const cleanName=v=>String(v||'').trim();
const keyOf=v=>cleanName(v).toLocaleLowerCase('en-US');
const safeId=v=>cleanName(v).toUpperCase().replace(/[^A-Z0-9_-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,60);

export function defaultMenuCategories(doc={}){
  const seen=new Set(),out=[];
  for(const menu of Array.isArray(doc.menu)?doc.menu:[]){
    const name=cleanName(menu?.category)||'OTHER',key=keyOf(name);
    if(seen.has(key))continue;seen.add(key);
    out.push({id:'cat_'+safeId(name),name,enabled:true});
  }
  if(!out.length)out.push({id:'cat_OTHER',name:'OTHER',enabled:true});
  return out;
}

export function getMenuStructure(doc={}){
  const settings=doc.settings&&typeof doc.settings==='object'?doc.settings:{};
  const derived=defaultMenuCategories(doc);
  const storedCategories=Array.isArray(settings.menuCategories)?settings.menuCategories:[];
  const byName=new Map(storedCategories.map((x,i)=>[keyOf(x?.name),{id:cleanName(x?.id)||('cat_'+i),name:cleanName(x?.name)||'OTHER',enabled:x?.enabled!==false}]));
  const categories=[];
  for(const raw of storedCategories){
    const name=cleanName(raw?.name);if(!name)continue;
    categories.push({id:cleanName(raw?.id)||('cat_'+safeId(name)),name,enabled:raw?.enabled!==false});
  }
  for(const row of derived){
    if(!byName.has(keyOf(row.name)))categories.push(row);
  }
  const storedBases=Array.isArray(settings.prepBases)?settings.prepBases:[];
  const baseById=new Map(storedBases.map(x=>[cleanName(x?.id),x]));
  const prepBases=[];
  for(const base of DEFAULT_PREP_BASES){
    const saved=baseById.get(base.id);
    prepBases.push({
      id:base.id,
      label:cleanName(saved?.label)||base.label,
      enabled:saved?.enabled!==false,
      ingredientIds:Array.isArray(saved?.ingredientIds)?saved.ingredientIds.map(String):[],
      batchMode:BATCH_MODES.has(cleanName(saved?.batchMode).toUpperCase())?cleanName(saved.batchMode).toUpperCase():base.batchMode,
    });
  }
  for(const raw of storedBases){
    const id=cleanName(raw?.id);
    if(!id||DEFAULT_PREP_BASES.some(x=>x.id===id))continue;
    prepBases.push({id,label:cleanName(raw?.label)||id,enabled:raw?.enabled!==false,ingredientIds:Array.isArray(raw?.ingredientIds)?raw.ingredientIds.map(String):[],batchMode:BATCH_MODES.has(cleanName(raw?.batchMode).toUpperCase())?cleanName(raw.batchMode).toUpperCase():'SEQUENTIAL'});
  }
  return {categories,prepBases};
}

export function validateMenuStructure({categories,prepBases}={},doc={}){
  if(!Array.isArray(categories)||!Array.isArray(prepBases))throw new Error('invalid_menu_structure');
  if(categories.length<1||categories.length>40||prepBases.length>30)throw new Error('invalid_menu_structure');
  const names=new Set(),ids=new Set(),normalizedCategories=[];
  for(const raw of categories){
    const name=cleanName(raw?.name),id=cleanName(raw?.id)||('cat_'+safeId(name));
    if(name.length<1||name.length>80||!id||names.has(keyOf(name))||ids.has(id))throw new Error('invalid_menu_category');
    names.add(keyOf(name));ids.add(id);normalizedCategories.push({id,name,enabled:raw?.enabled!==false,previousName:cleanName(raw?.previousName)});
  }
  const ingredients=doc.ingredients&&typeof doc.ingredients==='object'?doc.ingredients:{};
  const baseIds=new Set(),normalizedBases=[];
  for(const raw of prepBases){
    const id=safeId(raw?.id),label=cleanName(raw?.label);
    if(!id||label.length<1||label.length>80||baseIds.has(id))throw new Error('invalid_prep_base');
    const ingredientIds=[...new Set((Array.isArray(raw?.ingredientIds)?raw.ingredientIds:[]).map(String))];
    if(ingredientIds.some(x=>!ingredients[x]))throw new Error('prep_base_ingredient_missing');
    const batchMode=cleanName(raw?.batchMode||'SEQUENTIAL').toUpperCase();
    if(!BATCH_MODES.has(batchMode))throw new Error('invalid_prep_batch_mode');
    baseIds.add(id);normalizedBases.push({id,label,enabled:raw?.enabled!==false,ingredientIds,batchMode});
  }
  return {categories:normalizedCategories,prepBases:normalizedBases};
}

export function applyMenuStructure(doc,normalized){
  if(!doc.settings||typeof doc.settings!=='object')doc.settings={};
  for(const row of normalized.categories){
    if(row.previousName&&keyOf(row.previousName)!==keyOf(row.name)){
      for(const menu of Array.isArray(doc.menu)?doc.menu:[])if(keyOf(menu?.category)===keyOf(row.previousName))menu.category=row.name;
    }
  }
  doc.settings.menuCategories=normalized.categories.map(({id,name,enabled})=>({id,name,enabled}));
  doc.settings.prepBases=normalized.prepBases.map(({id,label,enabled,ingredientIds,batchMode})=>({id,label,enabled,ingredientIds,batchMode}));
  return getMenuStructure(doc);
}

export function categoryState(doc,name){
  const structure=getMenuStructure(doc),key=keyOf(name||'OTHER');
  const index=structure.categories.findIndex(x=>keyOf(x.name)===key);
  return index>=0?{...structure.categories[index],rank:index}:{id:'cat_OTHER',name:cleanName(name)||'OTHER',enabled:true,rank:999};
}

export function prepBaseState(doc,id){
  const structure=getMenuStructure(doc),key=cleanName(id);
  const index=structure.prepBases.findIndex(x=>x.id===key);
  return index>=0?{...structure.prepBases[index],rank:index}:null;
}
