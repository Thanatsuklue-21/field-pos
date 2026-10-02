const TABLES=Object.freeze({
  stockTransactions:'field_stock_transactions',
  purchaseRecords:'field_purchase_records',
  costSnapshots:'field_cost_snapshots',
  recipeVersions:'field_recipe_versions',
  costHistory:'field_cost_history',
  posRequests:'field_pos_requests',
  menuImages:'field_menu_images'
});
export const FULL_BACKUP_SCHEMA_VERSION=4;
export const FULL_BACKUP_TABLES=TABLES;
const array=value=>Array.isArray(value)?value:[];
const ids=(rows,key='id')=>new Set(rows.map(x=>String(x?.[key]||'')).filter(Boolean));
const requireUniqueIds=(rows,key)=>{const idKey=key==='posRequests'?'request_key':key==='menuImages'?'menu_id':'id';const values=rows.map(x=>String(x?.[idKey]||''));if(values.some(id=>!id)||new Set(values).size!==values.length)throw new Error('invalid_backup_ids:'+key)};

export function buildFullBackup({stateRow,tables,createdAt=new Date().toISOString()}={}){
  if(!stateRow)throw new Error('backup_state_required');
  const document=typeof stateRow.document==='string'?JSON.parse(stateRow.document):structuredClone(stateRow.document||{});
  const normalized=Object.fromEntries(Object.keys(TABLES).map(key=>[key,array(tables?.[key]).map(x=>({...x}))]));
  return {schemaVersion:FULL_BACKUP_SCHEMA_VERSION,dataVersion:String(document.dataVersion||'unknown'),createdAt,revision:Number(stateRow.revision)||0,fieldState:{revision:Number(stateRow.revision)||0,document,updatedAt:Number(stateRow.updated_at)||0},recordCounts:{fieldState:1,...Object.fromEntries(Object.entries(normalized).map(([k,v])=>[k,v.length]))},tables:normalized};
}

export function validateFullBackup(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||![1,2,3,FULL_BACKUP_SCHEMA_VERSION].includes(Number(value.schemaVersion)))throw new Error('invalid_backup_schema');
  if(!value.fieldState||typeof value.fieldState!=='object'||!value.fieldState.document||typeof value.fieldState.document!=='object')throw new Error('invalid_backup_state');
  if(Number(value.recordCounts?.fieldState)!==1)throw new Error('backup_count_mismatch:fieldState');
  const tables={};for(const key of Object.keys(TABLES)){if((key==='posRequests'&&Number(value.schemaVersion)===1)||(key==='menuImages'&&Number(value.schemaVersion)<4)){tables[key]=[];continue}if(!Array.isArray(value.tables?.[key]))throw new Error('invalid_backup_table:'+key);tables[key]=value.tables[key].map(x=>({...x}))}
  const expected=value.recordCounts||{};for(const [key,rows] of Object.entries(tables)){const legacy=(key==='posRequests'&&Number(value.schemaVersion)===1)||(key==='menuImages'&&Number(value.schemaVersion)<4);if(!legacy&&Number(expected[key])!==rows.length)throw new Error('backup_count_mismatch:'+key);requireUniqueIds(rows,key)}
  for(const request of tables.posRequests){try{const response=JSON.parse(request.response);if(!response||typeof response!=='object'||Array.isArray(response))throw new Error()}catch{throw new Error('invalid_backup_request_response')}}
  const stockIds=ids(tables.stockTransactions),purchaseIds=ids(tables.purchaseRecords),menuIds=ids(array(value.fieldState.document.menu));
  const saleIds=ids(array(value.fieldState.document.sales));
  if(tables.purchaseRecords.some(x=>!stockIds.has(String(x.stock_transaction_id||''))))throw new Error('backup_reference_purchase_stock');
  if(tables.costHistory.some(x=>x.purchase_record_id&&!purchaseIds.has(String(x.purchase_record_id))))throw new Error('backup_reference_cost_purchase');
  if(tables.costSnapshots.some(x=>!saleIds.has(String(x.sale_id||''))))throw new Error('backup_reference_snapshot_sale');
  if(tables.recipeVersions.some(x=>!menuIds.has(String(x.menu_id||''))))throw new Error('backup_reference_recipe_menu');
  if(tables.menuImages.some(x=>!menuIds.has(String(x.menu_id||''))))throw new Error('backup_reference_menu_image');
  return {schemaVersion:FULL_BACKUP_SCHEMA_VERSION,dataVersion:String(value.dataVersion||'unknown'),createdAt:String(value.createdAt||''),revision:Number(value.revision)||0,fieldState:{revision:Number(value.fieldState.revision)||0,document:structuredClone(value.fieldState.document),updatedAt:Number(value.fieldState.updatedAt)||0},recordCounts:{fieldState:1,...Object.fromEntries(Object.entries(tables).map(([k,v])=>[k,v.length]))},tables};
}
